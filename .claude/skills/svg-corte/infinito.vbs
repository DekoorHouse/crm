' infinito.vbs — Genera la hoja de lampara(s) infinito desde plantilla y exporta SVG para laser.
' Uso: cscript //nologo infinito.vbs "Nombre1" "Nombre2" "Fecha1" ["Nombre3" "Nombre4" "Fecha2"]
'   3 argumentos -> plantilla de 1 lampara | 6 argumentos -> plantilla de 2 lamparas
' Imprime al final: "OK <ruta-svg>" y "CDR <ruta-cdr>"
'
' La hoja es de 350x330 mm con todo alineado arriba-izquierda (ya viene asi en la plantilla).
' Colores: corte = rojo, grabado = negro (textos), azul = infinito/corazones/marco (igual que produccion).
Option Explicit

Const BASE_NOMBRE = 65.2  ' pt — tamano estandar de nombres en produccion
Const MAX_W_NOMBRE = 52   ' mm — ancho maximo para caber en el aro del infinito
Const BASE_FECHA = 25.3   ' pt
Const MAX_W_FECHA = 55    ' mm

Dim args, nArgs
Set args = WScript.Arguments
nArgs = args.Count
If nArgs <> 3 And nArgs <> 6 Then
    WScript.Echo "Uso: cscript //nologo infinito.vbs ""Nombre1"" ""Nombre2"" ""Fecha1"" [""Nombre3"" ""Nombre4"" ""Fecha2""]"
    WScript.Quit 1
End If

Dim fso, shell, skillDir, tplPath, outDir, base, stamp, cdrPath, svgPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
skillDir = fso.GetParentFolderName(WScript.ScriptFullName)
If nArgs = 6 Then
    tplPath = skillDir & "\plantillas\plantilla-infinito-2.cdr"
Else
    tplPath = skillDir & "\plantillas\plantilla-infinito-1.cdr"
End If
If Not fso.FileExists(tplPath) Then
    WScript.Echo "ERROR: no existe la plantilla " & tplPath
    WScript.Quit 1
End If

outDir = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\SVG-Corte"
If Not fso.FolderExists(outDir) Then fso.CreateFolder outDir

stamp = Year(Now) & Pad2(Month(Now)) & Pad2(Day(Now)) & "-" & Pad2(Hour(Now)) & Pad2(Minute(Now)) & Pad2(Second(Now))
base = "infinito-" & Slug(args(0)) & "-" & Slug(args(1))
If nArgs = 6 Then base = base & "-" & Slug(args(3)) & "-" & Slug(args(4))
base = base & "-" & stamp
cdrPath = outDir & "\" & base & ".cdr"
svgPath = outDir & "\" & base & ".svg"

' Trabajar SIEMPRE sobre una copia de la plantilla (la plantilla original nunca se toca)
fso.CopyFile tplPath, cdrPath, True

Dim corel, doc
On Error Resume Next
Set corel = CreateObject("CorelDRAW.Application")
On Error GoTo 0
If IsEmpty(corel) Or (Not IsObject(corel)) Then Set corel = Nothing
If corel Is Nothing Then
    WScript.Echo "ERROR: no pude abrir CorelDRAW por COM. Esta instalado?"
    WScript.Quit 1
End If
corel.Visible = True
Set doc = corel.OpenDocument(cdrPath)
doc.Unit = 3 ' mm

' Reemplazar placeholders (conservando el centro de cada texto y auto-ajustando el ancho)
ReplaceText doc, "NOMBRE1", args(0), BASE_NOMBRE, MAX_W_NOMBRE
ReplaceText doc, "NOMBRE2", args(1), BASE_NOMBRE, MAX_W_NOMBRE
ReplaceText doc, "FECHA1", args(2), BASE_FECHA, MAX_W_FECHA
If nArgs = 6 Then
    ReplaceText doc, "NOMBRE3", args(3), BASE_NOMBRE, MAX_W_NOMBRE
    ReplaceText doc, "NOMBRE4", args(4), BASE_NOMBRE, MAX_W_NOMBRE
    ReplaceText doc, "FECHA2", args(5), BASE_FECHA, MAX_W_FECHA
End If

' Guardar el .cdr de trabajo con los textos aun editables (por si quieren retocar a mano)
On Error Resume Next
doc.Save
On Error GoTo 0

' Convertir textos a curvas para que el SVG no dependa de tener la fuente instalada
Dim s, textos(), nt, i
nt = 0
ReDim textos(doc.ActivePage.Shapes.Count)
For Each s In doc.ActivePage.Shapes
    If s.Type = 6 Then
        Set textos(nt) = s
        nt = nt + 1
    End If
Next
For i = 0 To nt - 1
    textos(i).ConvertToCurves
Next

' Exportar SVG (pagina actual). 1345 = cdrSVG en Corel v23; 811 en versiones viejas.
Dim filterId, exported, exportErr
exported = False
exportErr = ""
For Each filterId In Array(1345, 811)
    On Error Resume Next
    Err.Clear
    doc.Export svgPath, CLng(filterId), CLng(1), Nothing, Nothing
    If Err.Number = 0 And fso.FileExists(svgPath) Then
        exported = True
    Else
        exportErr = exportErr & "[filtro " & filterId & ": " & Err.Description & "] "
    End If
    On Error GoTo 0
    If exported Then Exit For
Next
If Not exported Then
    WScript.Echo "ERROR: fallo la exportacion a SVG. " & exportErr
    WScript.Quit 1
End If

Dim ts, raw
Set ts = fso.OpenTextFile(svgPath, 1)
raw = ts.ReadAll
ts.Close
If InStr(raw, "<svg") = 0 Then
    WScript.Echo "ERROR: el archivo exportado no parece un SVG valido: " & svgPath
    WScript.Quit 1
End If

' El doc queda abierto para revision visual; Dirty=False para que cerrar no pregunte
' (el .cdr guardado conserva los textos editables; lo abierto ya esta en curvas)
doc.Dirty = False
WScript.Echo "OK " & svgPath
WScript.Echo "CDR " & cdrPath

Sub ReplaceText(doc, ph, valor, baseSize, maxW)
    Dim s, t, cx, cy, w, found
    found = False
    For Each s In doc.ActivePage.Shapes
        If s.Type = 6 Then
            t = Trim(Replace(Replace(s.Text.Story.Text, vbCr, ""), vbLf, ""))
            If StrComp(t, ph, vbTextCompare) = 0 Then
                cx = s.CenterX : cy = s.CenterY
                s.Text.Story.Text = valor
                s.Text.Story.Size = baseSize
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
    If Not found Then
        WScript.Echo "ERROR: no encontre el placeholder " & ph & " en la plantilla"
        WScript.Quit 1
    End If
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
