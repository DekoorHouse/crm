' infinito.vbs — Genera la hoja de lampara(s) infinito desde plantilla y exporta SVG para laser.
' Uso: cscript //nologo infinito.vbs [/label:DH13492-DH13495] [/file:base-sin-extension] "Nombre1" "Nombre2" "Fecha1" ["Nombre3" "Nombre4" "Fecha2"]
'   3 argumentos -> plantilla de 1 lampara | 6 argumentos -> plantilla de 2 lamparas
'   /label: opcional, se antepone al nombre del archivo (trazabilidad, ej. numeros DH)
'   /file:  opcional, nombre base EXACTO de los archivos de salida (sin extension). Lo usa el
'           svg-worker para conocer las rutas sin parsear stdout (evita lios de codepage con acentos).
'   /close: opcional, cierra el documento al terminar (para el worker automatico; sin esto el
'           doc queda abierto en Corel para revision visual del operador).
' NOMBRES A 2 RENGLONES: el token literal \n dentro de un valor lo parte en renglones apilados
'   y centrados (ej. "Rosa\nMaría"), a 44.8pt como los disenos manuales de produccion, con
'   interlineado de 60% de altura de caracter (regla de Chris, 2026-07-18). Asi se
'   reproduce EXACTAMENTE el layout que el cliente aprobo en su mockup.
' Imprime al final: "OK <ruta-svg>" y "CDR <ruta-cdr>"
'
' La hoja es de 350x330 mm con todo alineado arriba-izquierda (ya viene asi en la plantilla).
' Colores: corte = rojo, grabado = negro (textos), azul = infinito/corazones/marco (igual que produccion).
Option Explicit

Const BASE_NOMBRE = 65.2    ' pt — tamano estandar de nombres en produccion (1 renglon)
Const BASE_NOMBRE_2L = 44.8 ' pt — nombres a 2 renglones (mismo tamano que produccion manual)
Const MAX_W_NOMBRE = 52     ' mm — ancho maximo para caber en el aro del infinito
Const BASE_FECHA = 25.3     ' pt
Const MAX_W_FECHA = 55      ' mm
Const ALINEACION_CENTRO = 3 ' cdrCenterAlignment (para textos de varios renglones)
Const INTERLINEADO_2L = 60  ' % altura caracter — interlineado de renglones apilados (Chris, 2026-07-18)

Dim args, nArgs, label, fileBase
Set args = WScript.Arguments.Unnamed
nArgs = args.Count
label = ""
fileBase = ""
On Error Resume Next
label = WScript.Arguments.Named("label")
fileBase = WScript.Arguments.Named("file")
On Error GoTo 0
If nArgs <> 3 And nArgs <> 6 Then
    WScript.Echo "Uso: cscript //nologo infinito.vbs [/label:DHxxxx] ""Nombre1"" ""Nombre2"" ""Fecha1"" [""Nombre3"" ""Nombre4"" ""Fecha2""]"
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

If fileBase <> "" Then
    base = Slug(fileBase)
Else
    stamp = Year(Now) & Pad2(Month(Now)) & Pad2(Day(Now)) & "-" & Pad2(Hour(Now)) & Pad2(Minute(Now)) & Pad2(Second(Now))
    base = "infinito-" & Slug(args(0)) & "-" & Slug(args(1))
    If nArgs = 6 Then base = base & "-" & Slug(args(3)) & "-" & Slug(args(4))
    If label <> "" Then base = Slug(label) & "-" & base
    base = base & "-" & stamp
End If
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
ReplaceText doc, "NOMBRE1", args(0), BASE_NOMBRE, BASE_NOMBRE_2L, MAX_W_NOMBRE
ReplaceText doc, "NOMBRE2", args(1), BASE_NOMBRE, BASE_NOMBRE_2L, MAX_W_NOMBRE
ReplaceText doc, "FECHA1", args(2), BASE_FECHA, BASE_FECHA, MAX_W_FECHA
If nArgs = 6 Then
    ReplaceText doc, "NOMBRE3", args(3), BASE_NOMBRE, BASE_NOMBRE_2L, MAX_W_NOMBRE
    ReplaceText doc, "NOMBRE4", args(4), BASE_NOMBRE, BASE_NOMBRE_2L, MAX_W_NOMBRE
    ReplaceText doc, "FECHA2", args(5), BASE_FECHA, BASE_FECHA, MAX_W_FECHA
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

' Orientacion de produccion: rotar -90 (horario) + reflejar verticalmente (el grabado se
' hace ESPEJEADO porque el laser graba por la parte de atras), y realinear arriba-izquierda.
' Esto solo se aplica al SVG; el .cdr ya guardado queda en orientacion natural y editable.
Dim g, sr2
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
' (el .cdr guardado conserva los textos editables; lo abierto ya esta en curvas).
' Con /close (worker automatico) se cierra para no acumular documentos en Corel.
doc.Dirty = False
If WScript.Arguments.Named.Exists("close") Then doc.Close
WScript.Echo "OK " & svgPath
WScript.Echo "CDR " & cdrPath

Sub ReplaceText(doc, ph, valor, baseSize, base2L, maxW)
    Dim s, t, cx, cy, w, found, valor2, multilinea, talla
    ' El token literal \n parte el texto en renglones apilados (vbCr)
    valor2 = Replace(valor, "\n", vbCr)
    multilinea = (InStr(valor2, vbCr) > 0)
    If multilinea Then talla = base2L Else talla = baseSize
    found = False
    For Each s In doc.ActivePage.Shapes
        If s.Type = 6 Then
            t = Trim(Replace(Replace(s.Text.Story.Text, vbCr, ""), vbLf, ""))
            If StrComp(t, ph, vbTextCompare) = 0 Then
                cx = s.CenterX : cy = s.CenterY
                s.Text.Story.Text = valor2
                s.Text.Story.Size = talla
                If multilinea Then
                    On Error Resume Next
                    s.Text.Story.Alignment = ALINEACION_CENTRO
                    On Error GoTo 0
                    ' Interlineado compacto (60% altura caracter) — asignacion directa y SIN
                    ' On Error: si la propiedad fallara, mejor enterarse que salir con el default
                    s.Text.Story.LineSpacing = INTERLINEADO_2L
                End If
                s.CenterX = cx : s.CenterY = cy
                w = s.SizeWidth
                If w > maxW Then
                    s.Text.Story.Size = talla * maxW / w
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
