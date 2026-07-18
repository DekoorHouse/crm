' build-13569.vbs — DH13569: Lampara de corazones ESPECIAL (pareja + 2 hijas).
' Base: Plantilla Corazones para Claude (tabloide). Roberto/Laishaa en el infinito,
' fecha 19-Julio-2024 abajo, y Katarhin (corazon frontal-centro) + Iris (corazon derecho)
' centradas con silueta blanca de 2.8 mm (regla Chris 2026-07-17).
' Coordenadas de corazones ajustables via argumentos: [kx ky ix iy] (default 103.2 330 156.5 337)
Option Explicit

Const TPL = "C:\Users\chris\Documents\Corel\Plantilla Corazones para Claude.cdr"
Const PH_N1 = "Romario"
Const PH_N2 = "Romina"
Const PH_FE = "13-Agosto-1992"
Const MAX_W_NOMBRE = 52
Const MAX_W_FECHA = 50
Const MAX_W_CORAZON = 48     ' mm max para nombre sobre corazon
Const HEART_SIZE = 46        ' pt (receta DH13517)
Const SIL_MM = 2.8           ' silueta blanca
Const FONTNAME = "Rows of Sunflowers"
Const ALINEACION_CENTRO = 3

Dim N1, N2, FECHA, HIJA1, HIJA2
N1 = "Roberto" : N2 = "Laishaa" : FECHA = "19-Julio-2024"
HIJA1 = "Katarhin" : HIJA2 = "Iris"

Dim kx, ky, ix, iy, a
kx = 103.2 : ky = 330 : ix = 156.5 : iy = 337
Set a = WScript.Arguments.Unnamed
If a.Count >= 4 Then
    kx = CDbl(a(0)) : ky = CDbl(a(1)) : ix = CDbl(a(2)) : iy = CDbl(a(3))
End If

Dim fso, shell, outDir, base, cdrPath, svgPath, pngUp, pngMir
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
outDir = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\SVG-Corte"
If Not fso.FolderExists(outDir) Then fso.CreateFolder outDir
base = "DH13569-4corazones"
cdrPath = outDir & "\" & base & ".cdr"
svgPath = outDir & "\" & base & ".svg"
pngUp  = outDir & "\" & base & "-derecho.png"
pngMir = outDir & "\" & base & ".png"

If Not fso.FileExists(TPL) Then WScript.Echo "ERROR: no existe " & TPL : WScript.Quit 1
fso.CopyFile TPL, cdrPath, True

Dim corel, doc
Set corel = CreateObject("CorelDRAW.Application")
corel.Visible = True
Set doc = corel.OpenDocument(cdrPath)
doc.Unit = 3 ' mm

' 1) Pareja + fecha (conservando centros de la plantilla)
ReplaceByContent doc, PH_N1, N1, MAX_W_NOMBRE
ReplaceByContent doc, PH_N2, N2, MAX_W_NOMBRE
ReplaceByContent doc, PH_FE, FECHA, MAX_W_FECHA

' 2) Nombres de las hijas sobre corazones (silueta blanca detras + texto negro)
AddHeartName doc, HIJA1, kx, ky
AddHeartName doc, HIJA2, ix, iy

' 3) Guardar el .cdr con textos editables (al derecho)
On Error Resume Next
doc.Save
On Error GoTo 0

' 4) Textos a curvas
Dim s, textos(), nt, i
nt = 0
ReDim textos(doc.ActivePage.Shapes.Count)
For Each s In doc.ActivePage.Shapes
    If s.Type = 6 Then Set textos(nt) = s : nt = nt + 1
Next
For i = 0 To nt - 1
    textos(i).ConvertToCurves
Next

' 5) PNG al derecho (revision de centrado)
doc.Export pngUp, CLng(802), CLng(1), Nothing, Nothing

' 6) Orientacion de produccion (rotar -90 + espejo vertical + arriba-izquierda)
Dim g
Set g = Nothing
On Error Resume Next
Set g = doc.ActivePage.Shapes.All.Group
On Error GoTo 0
If g Is Nothing Then
    doc.ActivePage.SelectShapesFromRectangle -10, -10, doc.ActivePage.SizeWidth + 10, doc.ActivePage.SizeHeight + 10, False
    Set g = corel.ActiveSelection.Group
End If
g.Rotate -90
g.Flip 2
g.PositionX = 0
g.PositionY = doc.ActivePage.SizeHeight
g.Ungroup

' 7) Exportar PNG espejeado + SVG laser
doc.Export pngMir, CLng(802), CLng(1), Nothing, Nothing
Dim filterId, exported, exportErr
exported = False : exportErr = ""
For Each filterId In Array(1345, 811)
    On Error Resume Next
    Err.Clear
    doc.Export svgPath, CLng(filterId), CLng(1), Nothing, Nothing
    If Err.Number = 0 And fso.FileExists(svgPath) Then exported = True Else exportErr = exportErr & "[f" & filterId & ":" & Err.Description & "]"
    On Error GoTo 0
    If exported Then Exit For
Next
If Not exported Then WScript.Echo "ERROR: fallo export SVG. " & exportErr : WScript.Quit 1

doc.Dirty = False
doc.Close

WScript.Echo "CDR " & cdrPath
WScript.Echo "PNGUP " & pngUp
WScript.Echo "PNGMIR " & pngMir
WScript.Echo "OK " & svgPath

' ---- subs ----
Sub AddHeartName(doc, nombre, cx, cy)
    Dim sil, tx, w, sz
    sz = HEART_SIZE
    ' silueta blanca (atras): mismo texto con outline blanco grueso
    Set sil = doc.ActiveLayer.CreateArtisticText(cx, cy, nombre)
    sil.Text.Story.Font = FONTNAME
    sil.Text.Story.Size = sz
    On Error Resume Next
    sil.Text.Story.Alignment = ALINEACION_CENTRO
    On Error GoTo 0
    sil.Fill.UniformColor.RGBAssign 255, 255, 255
    On Error Resume Next
    sil.Outline.Type = 1            ' cdrOutline (crea el contorno si no existe)
    sil.Outline.Width = SIL_MM      ' en unidades del doc (mm)
    sil.Outline.Color.RGBAssign 255, 255, 255
    sil.Outline.LineJoin = 1        ' redondeado (sin picos en fuente script)
    sil.Outline.BehindFill = False
    On Error GoTo 0
    WScript.Echo "SIL '" & nombre & "' outlineW=" & sil.Outline.Width
    ' texto negro (encima)
    Set tx = doc.ActiveLayer.CreateArtisticText(cx, cy, nombre)
    tx.Text.Story.Font = FONTNAME
    tx.Text.Story.Size = sz
    On Error Resume Next
    tx.Text.Story.Alignment = ALINEACION_CENTRO
    On Error GoTo 0
    tx.Fill.UniformColor.RGBAssign 0, 0, 0
    tx.Outline.SetNoOutline
    ' auto-reducir si no cabe
    w = tx.SizeWidth
    If w > MAX_W_CORAZON Then
        sz = sz * MAX_W_CORAZON / w
        sil.Text.Story.Size = sz
        tx.Text.Story.Size = sz
    End If
    sil.CenterX = cx : sil.CenterY = cy
    tx.CenterX = cx : tx.CenterY = cy
End Sub

Sub ReplaceByContent(doc, phText, valor, maxW)
    Dim s, t, cx, cy, w, found, valor2, multilinea, baseSize
    valor2 = Replace(valor, "\n", vbCr)
    multilinea = (InStr(valor2, vbCr) > 0)
    found = False
    For Each s In doc.ActivePage.Shapes
        If s.Type = 6 Then
            t = Trim(Replace(Replace(s.Text.Story.Text, vbCr, ""), vbLf, ""))
            If StrComp(t, phText, vbTextCompare) = 0 Then
                cx = s.CenterX : cy = s.CenterY
                baseSize = s.Text.Story.Size
                s.Text.Story.Text = valor2
                s.Text.Story.Size = baseSize
                If multilinea Then
                    On Error Resume Next
                    s.Text.Story.Alignment = ALINEACION_CENTRO
                    On Error GoTo 0
                End If
                s.CenterX = cx : s.CenterY = cy
                w = s.SizeWidth
                If w > maxW Then
                    s.Text.Story.Size = baseSize * maxW / w
                    s.CenterX = cx : s.CenterY = cy
                End If
                found = True
                Exit For
            End If
        End If
    Next
    If Not found Then WScript.Echo "ERROR: no encontre '" & phText & "' en la plantilla." : WScript.Quit 1
End Sub
