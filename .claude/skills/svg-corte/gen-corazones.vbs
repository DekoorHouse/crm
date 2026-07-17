' gen-corazones.vbs — Genera el archivo de corte de "Plantilla Corazones para Claude" (4 corazones + infinito)
' reemplazando los textos de ejemplo Romario/Romina/13-Agosto-1992 por los datos del pedido.
' Uso: cscript //nologo gen-corazones.vbs [/file:base] [/mirror] [/png] [/svg] [/save] [/close] "Nombre1" "Nombre2" "Fecha"
'   Nombre1 = lobulo izquierdo, Nombre2 = lobulo derecho, Fecha = abajo centrada.
'   /mirror  aplica orientacion de produccion (rotar -90 + espejo vertical); sin esto queda AL DERECHO.
'   /png     exporta PNG (para revision visual)
'   /svg     exporta SVG (para laser)
'   /save    guarda el .cdr de trabajo (textos ya convertidos a curvas)
'   /close   cierra el doc de trabajo al terminar
Option Explicit

Const TPL = "C:\Users\chris\Documents\Corel\Plantilla Corazones para Claude.cdr"
Const PH_N1 = "Romario"
Const PH_N2 = "Romina"
Const PH_FE = "13-Agosto-1992"
Const MAX_W_NOMBRE = 52     ' mm — margen antes de reducir (Romario mide ~46mm)
Const MAX_W_FECHA = 50      ' mm — (13-Agosto-1992 mide ~37mm)
Const ALINEACION_CENTRO = 3 ' cdrCenterAlignment

Dim args, fileBase, extraText, extraSize
Set args = WScript.Arguments.Unnamed
If args.Count <> 3 And args.Count <> 4 Then
    WScript.Echo "Uso: cscript //nologo gen-corazones.vbs [/file:base] [/mirror] [/png] [/svg] [/save] [/close] [/extrasize:18] ""Nombre1"" ""Nombre2"" ""Fecha"" [""TextoAdicional""]"
    WScript.Quit 1
End If
extraText = ""
If args.Count = 4 Then extraText = args(3)
fileBase = ""
extraSize = 18   ' pt — tamano del texto adicional bajo la fecha (default)
On Error Resume Next
fileBase = WScript.Arguments.Named("file")
If WScript.Arguments.Named.Exists("extrasize") Then extraSize = CDbl(WScript.Arguments.Named("extrasize"))
On Error GoTo 0

Dim fso, shell, outDir, base, stamp, cdrPath, svgPath, pngPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
If Not fso.FileExists(TPL) Then WScript.Echo "ERROR: no existe la plantilla " & TPL : WScript.Quit 1
outDir = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\SVG-Corte"
If Not fso.FolderExists(outDir) Then fso.CreateFolder outDir
If fileBase <> "" Then
    base = Slug(fileBase)
Else
    stamp = Year(Now) & Pad2(Month(Now)) & Pad2(Day(Now)) & "-" & Pad2(Hour(Now)) & Pad2(Minute(Now)) & Pad2(Second(Now))
    base = "corazones-" & Slug(args(0)) & "-" & Slug(args(1)) & "-" & stamp
End If
cdrPath = outDir & "\" & base & ".cdr"
svgPath = outDir & "\" & base & ".svg"
pngPath = outDir & "\" & base & ".png"

' Copia de trabajo (la plantilla original nunca se toca)
fso.CopyFile TPL, cdrPath, True

Dim corel, doc
On Error Resume Next
Set corel = CreateObject("CorelDRAW.Application")
On Error GoTo 0
If IsEmpty(corel) Or (Not IsObject(corel)) Then Set corel = Nothing
If corel Is Nothing Then WScript.Echo "ERROR: no pude abrir CorelDRAW por COM." : WScript.Quit 1
corel.Visible = True
Set doc = corel.OpenDocument(cdrPath)
doc.Unit = 3 ' mm

' Reemplazar los textos de ejemplo por los del pedido (conservando centro y tamano base)
ReplaceByContent doc, PH_N1, args(0), MAX_W_NOMBRE
ReplaceByContent doc, PH_N2, args(1), MAX_W_NOMBRE
ReplaceByContent doc, PH_FE, args(2), MAX_W_FECHA

' Texto adicional (ej. "aniversario no. 27") CENTRADO justo debajo de la fecha.
' La plantilla no lo trae: lo creo como texto artistico nuevo, misma fuente/negro que la fecha.
If extraText <> "" Then
    Dim sf, dCx, dBottom, dFont, dLayer
    dCx = Null : dBottom = Null : dFont = "Rows of Sunflowers"
    Set dLayer = Nothing
    For Each sf In doc.ActivePage.Shapes
        If sf.Type = 6 Then
            If StrComp(Trim(Replace(Replace(sf.Text.Story.Text, vbCr, ""), vbLf, "")), Trim(args(2)), vbTextCompare) = 0 Then
                dCx = sf.CenterX : dBottom = sf.BottomY
                On Error Resume Next
                dFont = sf.Text.Story.Font
                Set dLayer = sf.Layer
                On Error GoTo 0
                Exit For
            End If
        End If
    Next
    If IsNull(dCx) Then WScript.Echo "ERROR: no ubique la fecha para anclar el texto adicional." : WScript.Quit 1
    If dLayer Is Nothing Then Set dLayer = doc.ActiveLayer
    Dim tx, gap
    gap = 2.5   ' mm entre la fecha y el texto adicional
    Set tx = dLayer.CreateArtisticText(dCx, dBottom - 6, Replace(extraText, "\n", vbCr))
    tx.Text.Story.Font = dFont
    tx.Text.Story.Size = extraSize
    On Error Resume Next
    tx.Text.Story.Alignment = ALINEACION_CENTRO
    tx.Fill.UniformColor.RGBAssign 0, 0, 0
    tx.Outline.SetNoOutline
    On Error GoTo 0
    ' Auto-reducir si es muy ancho (el corte da margen, pero por si acaso)
    If tx.SizeWidth > 70 Then
        tx.Text.Story.Size = extraSize * 70 / tx.SizeWidth
    End If
    tx.CenterX = dCx
    tx.CenterY = dBottom - gap - tx.SizeHeight / 2
End If

' Guardar el .cdr con textos aun editables (por si quieren retocar) ANTES de curvas
If WScript.Arguments.Named.Exists("save") Then
    On Error Resume Next
    doc.Save
    On Error GoTo 0
End If

' Convertir textos a curvas (el SVG no depende de la fuente instalada)
Dim s, textos(), nt, i
nt = 0
ReDim textos(doc.ActivePage.Shapes.Count)
For Each s In doc.ActivePage.Shapes
    If s.Type = 6 Then Set textos(nt) = s : nt = nt + 1
Next
For i = 0 To nt - 1
    textos(i).ConvertToCurves
Next

' Orientacion de produccion opcional (rotar -90 + espejo vertical + realinear arriba-izquierda)
If WScript.Arguments.Named.Exists("mirror") Then
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
    g.Flip 2 ' cdrFlipVertical
    g.PositionX = 0
    g.PositionY = doc.ActivePage.SizeHeight
    g.Ungroup
End If

' Exportar PNG (revision) y/o SVG (laser)
If WScript.Arguments.Named.Exists("png") Then
    doc.Export pngPath, CLng(802), CLng(1), Nothing, Nothing
End If
If WScript.Arguments.Named.Exists("svg") Then
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
End If

doc.Dirty = False
If WScript.Arguments.Named.Exists("close") Then doc.Close

WScript.Echo "CDR " & cdrPath
If WScript.Arguments.Named.Exists("png") Then WScript.Echo "PNG " & pngPath
If WScript.Arguments.Named.Exists("svg") Then WScript.Echo "OK " & svgPath

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
    If Not found Then WScript.Echo "ERROR: no encontre el texto de ejemplo '" & phText & "' en la plantilla (¿guardaste los cambios en Corel?)." : WScript.Quit 1
End Sub

Function Slug(t)
    Dim i, c, r
    r = ""
    For i = 1 To Len(t)
        c = Mid(t, i, 1)
        If InStr("\/:*?""<>| ", c) > 0 Then c = "-"
        r = r & c
    Next
    Slug = r
End Function

Function Pad2(n)
    Pad2 = Right("0" & n, 2)
End Function
