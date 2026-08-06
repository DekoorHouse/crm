' gen-personaje.vbs — Hoja de lamparas de PERSONAJE (Spiderman / T-Rex) desde plantilla, con
' el nombre grabado, y exporta SVG para laser.
'
' Uso: cscript //nologo gen-personaje.vbs /tpl:spiderman|rex [/label:DH14300-DH14301]
'                                          [/file:base-sin-extension] [/close] [/preview]
'                                          "Nombre1" ["Nombre2"]
'   1 nombre  -> se graba solo la lampara de arriba; la de abajo se BORRA (media hoja)
'   2 nombres -> hoja completa: Nombre1 arriba, Nombre2 abajo
'   /label:   opcional, se antepone al nombre del archivo (trazabilidad, ej. numeros DH)
'   /file:    opcional, nombre base EXACTO de los archivos de salida (sin extension)
'   /close:   cierra el documento al terminar (worker automatico)
'   /max:NN   opcional, sobreescribe el largo maximo del nombre en mm (ver constantes abajo)
'   /preview: ademas del SVG exporta un PNG AL DERECHO (legible) para ensenarselo a Chris/cliente
'
' DIFERENCIAS CONTRA infinito.vbs (importantes):
'   1) La plantilla YA VIENE en orientacion de produccion (girada -90 + espejo vertical). Por eso
'      aqui NO se rota ni se refleja al final: se exporta tal cual. Si se rotara, saldria al reves.
'   2) Como el texto esta girado 90 grados, el LARGO del nombre crece en VERTICAL: el limite se
'      mide sobre SizeHeight, no sobre SizeWidth (al reves que en la infinito).
'   3) Las dos lamparas usan el MISMO placeholder literal "Xxxxx", asi que no se pueden distinguir
'      por texto: se identifican por POSICION (se ordenan de arriba hacia abajo).
'   4) El tamano base de letra NO esta hardcodeado: se lee del propio placeholder (spiderman 80.3pt,
'      rex 92.9pt), asi la misma rutina sirve para ambas plantillas y para las que vengan.
'
' NOMBRES A 2 RENGLONES: el token \n (o un salto real) parte el nombre en renglones apilados y
'   centrados, reduciendo la letra al 68% (misma proporcion que la infinito: 44.8/65.2).
'
' Hoja de 350x330 mm. Colores: corte = rojo, grabado = negro (texto), figura = azul.
' Imprime al final: "OK <ruta-svg>", "CDR <ruta-cdr>" y, con /preview, "PNG <ruta-png>"
Option Explicit

' Largo maximo del nombre (en mm) medido sobre el ALTO, porque el texto va girado. Pasado ese
' largo se reduce la letra. El tope es DISTINTO en cada plantilla porque el hueco libre depende
' de donde queda la figura: en el spiderman el brazo sube y aprieta el nombre por un lado, y el
' aro por el otro; en el rex el hueco de arriba-izquierda es mas amplio.
' Medido con pruebas: spiderman "Santiago" (67 mm) ya rozaba el aro; rex "Emiliano" (77 mm) igual.
' Se dejan ~5 mm de aire respecto a ese punto de roce.
Const MAX_LARGO_SPIDERMAN = 62
Const MAX_LARGO_REX = 72
Const RATIO_2L = 0.687        ' proporcion de letra para nombres a 2 renglones (44.8/65.2 de infinito)
Const ALINEACION_CENTRO = 3   ' cdrCenterAlignment
' Interlineado de renglones apilados, en % de altura de caracter. OJO: NO es el 60% de la infinito.
' Con 60 los renglones se enciman (medido con DH14344 "Dylan/Javier": la "y" de Dylan chocaba con la
' "J" de Javier). En los mockups de personaje los renglones van bien separados, asi que se usa 100,
' que es lo que reproduce el acomodo que vio el cliente.
Const INTERLINEADO_2L = 100

Dim args, nArgs, label, fileBase, tplName, quierePreview, maxLargo, maxArg
Set args = WScript.Arguments.Unnamed
nArgs = args.Count
label = "" : fileBase = "" : tplName = "" : maxArg = ""
On Error Resume Next
label = WScript.Arguments.Named("label")
fileBase = WScript.Arguments.Named("file")
tplName = WScript.Arguments.Named("tpl")
maxArg = WScript.Arguments.Named("max")
On Error GoTo 0
quierePreview = WScript.Arguments.Named.Exists("preview")

tplName = LCase(Trim(tplName))
If tplName = "" Then tplName = "spiderman"
If tplName <> "spiderman" And tplName <> "rex" Then
    WScript.Echo "ERROR: /tpl: debe ser spiderman o rex (llego: " & tplName & ")"
    WScript.Quit 1
End If
If tplName = "rex" Then maxLargo = MAX_LARGO_REX Else maxLargo = MAX_LARGO_SPIDERMAN
' OJO: si no se paso /max:, Named("max") devuelve Empty y IsNumeric(Empty) es TRUE (Empty vale 0),
' asi que hay que descartar el vacio ANTES de convertir o maxLargo se va a 0 y la letra queda en 0pt.
If maxArg <> "" And IsNumeric(maxArg) Then maxLargo = CDbl(maxArg)   ' /max:NN para ajustar a mano
If nArgs <> 1 And nArgs <> 2 Then
    WScript.Echo "Uso: cscript //nologo gen-personaje.vbs /tpl:spiderman|rex ""Nombre1"" [""Nombre2""]"
    WScript.Quit 1
End If

Dim fso, shell, skillDir, tplPath, outDir, base, stamp, cdrPath, svgPath, pngPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
skillDir = fso.GetParentFolderName(WScript.ScriptFullName)
tplPath = skillDir & "\plantillas\plantilla-" & tplName & "-2.cdr"
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
    base = tplName & "-" & Slug(args(0))
    If nArgs = 2 Then base = base & "-" & Slug(args(1))
    If label <> "" Then base = Slug(label) & "-" & base
    base = base & "-" & stamp
End If
cdrPath = outDir & "\" & base & ".cdr"
svgPath = outDir & "\" & base & ".svg"
pngPath = outDir & "\" & base & ".png"

Dim corel, doc, od
On Error Resume Next
Set corel = CreateObject("CorelDRAW.Application")
On Error GoTo 0
If IsEmpty(corel) Or (Not IsObject(corel)) Then Set corel = Nothing
If corel Is Nothing Then
    WScript.Echo "ERROR: no pude abrir CorelDRAW por COM. Esta instalado?"
    WScript.Quit 1
End If
corel.Visible = True

' Cerrar cualquier doc ya abierto con esta ruta (una corrida previa bloquearia el CopyFile)
On Error Resume Next
For Each od In corel.Documents
    If StrComp(od.FullFileName, cdrPath, vbTextCompare) = 0 Then od.Dirty = False : od.Close
Next
On Error GoTo 0

fso.CopyFile tplPath, cdrPath, True
Set doc = corel.OpenDocument(cdrPath)
doc.Unit = 3 ' mm

' --- Localizar los placeholders "Xxxxx" (van DENTRO de grupos anidados) y ordenarlos de arriba
'     hacia abajo, porque los dos dicen lo mismo y solo la posicion los distingue.
Dim phs(), nph, s
nph = 0
ReDim phs(20)
RecolectarPlaceholders doc.ActivePage.Shapes, phs, nph
If nph < nArgs Then
    WScript.Echo "ERROR: la plantilla tiene " & nph & " placeholder(s) ""Xxxxx"" y pedi " & nArgs & " nombre(s)"
    WScript.Quit 1
End If
OrdenarPorYDesc phs, nph   ' [0] = lampara de ARRIBA

GrabarNombre phs(0), args(0)
If nArgs = 2 Then
    GrabarNombre phs(1), args(1)
Else
    ' Media hoja: se borra la lampara sobrante para no cortar una pieza en blanco.
    BorrarLampara phs(1)
End If

' Guardar el .cdr con los textos aun editables (por si hay que retocar a mano)
On Error Resume Next
doc.Save
On Error GoTo 0

' Texto a curvas para que el SVG no dependa de tener instalada "Rows of Sunflowers"
ConvertirTextosACurvas doc.ActivePage.Shapes

' OJO: aqui NO se rota ni se refleja. La plantilla ya esta en orientacion de produccion
' (figura acostada, nombre vertical y espejeado). Rotarla la sacaria de escuadra.

Dim filterId, exported, exportErr
exported = False : exportErr = ""
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

' PNG "al derecho": se deshace la orientacion de produccion (espejo + giro) SOLO para poder
' leer el nombre en la revision. El SVG que va al laser queda intacto.
If quierePreview Then
    Dim g
    Set g = Nothing
    On Error Resume Next
    Set g = doc.ActivePage.Shapes.All.Group
    On Error GoTo 0
    If Not (g Is Nothing) Then
        g.Flip 2 ' cdrFlipVertical — quita el espejo
        g.Rotate 90
        g.PositionX = 0
        g.PositionY = doc.ActivePage.SizeHeight
    End If
    If fso.FileExists(pngPath) Then fso.DeleteFile pngPath, True
    On Error Resume Next
    doc.Export pngPath, CLng(802), CLng(1), Nothing, Nothing
    On Error GoTo 0
    If fso.FileExists(pngPath) Then WScript.Echo "PNG " & pngPath
End If

doc.Dirty = False
If WScript.Arguments.Named.Exists("close") Then doc.Close
WScript.Echo "OK " & svgPath
WScript.Echo "CDR " & cdrPath

' ---------------------------------------------------------------------------

' Recorre la pagina entrando a los grupos y junta las formas de texto que dicen "Xxxxx".
Sub RecolectarPlaceholders(coleccion, phs, nph)
    Dim sh, t
    For Each sh In coleccion
        If sh.Type = 7 Then
            RecolectarPlaceholders sh.Shapes, phs, nph
        ElseIf sh.Type = 6 Then
            t = Trim(Replace(Replace(sh.Text.Story.Text, vbCr, ""), vbLf, ""))
            If StrComp(t, "Xxxxx", vbTextCompare) = 0 Then
                Set phs(nph) = sh
                nph = nph + 1
            End If
        End If
    Next
End Sub

Sub OrdenarPorYDesc(phs, nph)
    Dim i, j, tmp
    For i = 0 To nph - 2
        For j = 0 To nph - 2 - i
            If phs(j).CenterY < phs(j + 1).CenterY Then
                Set tmp = phs(j) : Set phs(j) = phs(j + 1) : Set phs(j + 1) = tmp
            End If
        Next
    Next
End Sub

' Escribe el nombre encima del placeholder conservando su centro y su tamano de letra original.
' El limite de largo se mide sobre el ALTO porque el texto va girado 90 grados.
Sub GrabarNombre(s, valor)
    Dim cx, cy, valor2, multilinea, talla, largo
    valor2 = Replace(valor, "\n", vbCr)
    valor2 = Replace(valor2, vbCrLf, vbCr)
    valor2 = Replace(valor2, vbLf, vbCr)
    valor2 = NormalizarNombre(valor2)
    multilinea = (InStr(valor2, vbCr) > 0)

    talla = s.Text.Story.Size          ' tamano base de la propia plantilla
    If multilinea Then talla = talla * RATIO_2L

    cx = s.CenterX : cy = s.CenterY
    s.Text.Story.Text = valor2
    s.Text.Story.Size = talla
    If multilinea Then
        On Error Resume Next
        s.Text.Story.Alignment = ALINEACION_CENTRO
        On Error GoTo 0
        s.Text.Story.LineSpacing = INTERLINEADO_2L
    End If
    s.CenterX = cx : s.CenterY = cy
    largo = s.SizeHeight
    If largo > maxLargo Then
        s.Text.Story.Size = talla * maxLargo / largo
        s.CenterX = cx : s.CenterY = cy
    End If
End Sub

' Borra la lampara entera a la que pertenece un placeholder (para las medias hojas de 1 nombre).
Sub BorrarLampara(s)
    Dim padre, abuelo
    Set padre = Nothing
    On Error Resume Next
    Set padre = s.ParentGroup
    On Error GoTo 0
    If padre Is Nothing Then
        s.Delete
    Else
        ' El texto cuelga del grupo-lampara; ese grupo es el que hay que borrar completo.
        padre.Delete
    End If
End Sub

Sub ConvertirTextosACurvas(coleccion)
    Dim sh, lista(), n, i
    n = 0
    ReDim lista(coleccion.Count + 1)
    For Each sh In coleccion
        Set lista(n) = sh
        n = n + 1
    Next
    For i = 0 To n - 1
        If lista(i).Type = 7 Then
            ConvertirTextosACurvas lista(i).Shapes
        ElseIf lista(i).Type = 6 Then
            lista(i).ConvertToCurves
        End If
    Next
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

' Inicial mayuscula por palabra + espacio tras punto pegado a letra ("L.Angel" -> "L. Angel").
' Misma regla que infinito.vbs y server/mockups/nameLayout.js.
Function NormalizarNombre(txt)
    Dim i, c, nx, tmp, out, upNext
    tmp = ""
    For i = 1 To Len(txt)
        c = Mid(txt, i, 1)
        tmp = tmp & c
        If c = "." Then
            nx = Mid(txt, i + 1, 1)
            If nx <> "" And nx <> " " And nx <> vbCr And nx <> vbLf And nx <> vbTab Then tmp = tmp & " "
        End If
    Next
    out = ""
    upNext = True
    For i = 1 To Len(tmp)
        c = Mid(tmp, i, 1)
        If c = " " Or c = "." Or c = "-" Or c = "'" Or c = vbCr Or c = vbLf Or c = vbTab Then
            out = out & c
            upNext = True
        Else
            If upNext Then out = out & UCase(c) Else out = out & LCase(c)
            upNext = False
        End If
    Next
    NormalizarNombre = out
End Function

Function Pad2(n)
    Pad2 = Right("0" & n, 2)
End Function
