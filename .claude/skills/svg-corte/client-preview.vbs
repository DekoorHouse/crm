' client-preview.vbs — Vista de APROBACION para el cliente: diseno al derecho (sin girar ni
' espejear), centrado con margen blanco. Trabaja sobre COPIA; no toca el .cdr de produccion.
' Uso: cscript //nologo client-preview.vbs "<ruta.cdr>" "<salida.png>"
Option Explicit
Dim corel, doc, fso, s, g, args
Set fso = CreateObject("Scripting.FileSystemObject")
Set args = WScript.Arguments
If args.Count < 2 Then WScript.Echo "Uso: client-preview.vbs <cdr> <png>" : WScript.Quit 1

Dim srcCdr, pngPath, tmpCdr, margin
srcCdr = args(0)
pngPath = args(1)
tmpCdr = fso.GetSpecialFolder(2) & "\_clientpreview_" & fso.GetTempName() & ".cdr"
margin = 18 ' mm

If Not fso.FileExists(srcCdr) Then WScript.Echo "ERROR: no existe " & srcCdr : WScript.Quit 1
fso.CopyFile srcCdr, tmpCdr, True

Set corel = CreateObject("CorelDRAW.Application")
Set doc = corel.OpenDocument(tmpCdr)
doc.Unit = 3

Set g = doc.ActivePage.Shapes.All.Group
Dim w, h
w = g.SizeWidth : h = g.SizeHeight
doc.ActivePage.SizeWidth = w + 2 * margin
doc.ActivePage.SizeHeight = h + 2 * margin
g.CenterX = doc.ActivePage.SizeWidth / 2
g.CenterY = doc.ActivePage.SizeHeight / 2
g.Ungroup

If fso.FileExists(pngPath) Then fso.DeleteFile pngPath, True
doc.Export pngPath, CLng(802), CLng(1), Nothing, Nothing
doc.Dirty = False
doc.Close
On Error Resume Next
fso.DeleteFile tmpCdr, True
On Error GoTo 0
If fso.FileExists(pngPath) Then WScript.Echo "OK " & pngPath Else WScript.Echo "ERROR: no se creo el PNG"
