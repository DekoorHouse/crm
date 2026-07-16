' draw-square.vbs — Abre CorelDRAW, dibuja un cuadrado de N cm y lo exporta como SVG.
' Uso: cscript //nologo draw-square.vbs <cm>   (ej. cscript //nologo draw-square.vbs 10  |  10.5 tambien vale)
' Imprime al final: "OK <ruta-del-svg>"
'
' Notas de compatibilidad (verificado en CorelDRAW 2021 / v23):
' - Document.Export exige LOS 5 argumentos; los "opcionales" no se rellenan solos via COM tardio.
' - cdrSVG = 1345 en v23 (en versiones viejas era 811; se intentan ambos).
' - cdrCentimeter = 4, pero se verifica con ConvertUnits por si cambia entre versiones.
Option Explicit

Dim sizeStr, sizeCm, decSep
If WScript.Arguments.Count < 1 Then
    WScript.Echo "Uso: cscript //nologo draw-square.vbs <cm>"
    WScript.Quit 1
End If

' Aceptar "10", "10.5" o "10,5" sin importar la configuracion regional
decSep = Mid(CStr(1.5), 2, 1)
sizeStr = WScript.Arguments(0)
sizeCm = CDbl(Replace(Replace(sizeStr, ".", decSep), ",", decSep))
If sizeCm <= 0 Or sizeCm > 300 Then
    WScript.Echo "ERROR: medida invalida (" & sizeStr & " cm); debe ser entre 0 y 300"
    WScript.Quit 1
End If

Dim fso, shell, outDir, stamp, svgPath, cmLabel
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
outDir = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\SVG-Corte"
If Not fso.FolderExists(outDir) Then fso.CreateFolder outDir

stamp = Year(Now) & Pad2(Month(Now)) & Pad2(Day(Now)) & "-" & Pad2(Hour(Now)) & Pad2(Minute(Now)) & Pad2(Second(Now))
cmLabel = Replace(CStr(sizeCm), decSep, "p")
svgPath = outDir & "\cuadrado-" & cmLabel & "cm-" & stamp & ".svg"

' Conectar con CorelDRAW (si ya esta abierto, Corel reusa la instancia)
Dim corel
On Error Resume Next
Set corel = CreateObject("CorelDRAW.Application")
On Error GoTo 0
If IsEmpty(corel) Or (Not IsObject(corel)) Then Set corel = Nothing
If corel Is Nothing Then
    WScript.Echo "ERROR: no pude abrir CorelDRAW por COM (CorelDRAW.Application). Esta instalado?"
    WScript.Quit 1
End If
corel.Visible = True

' Identificar el valor del enum cdrUnit para centimetros sin depender de constantes:
' ConvertUnits(1, cm, pulgada=1) debe dar ~0.3937. (En v23 es 4.)
Dim u, r, cmUnit
cmUnit = -1
For u = 0 To 80
    r = -999
    On Error Resume Next
    r = corel.ConvertUnits(1, u, 1)
    On Error GoTo 0
    If r <> -999 Then
        If Abs(r - 0.3937007874) < 0.0005 Then
            cmUnit = u
            Exit For
        End If
    End If
Next
If cmUnit = -1 Then
    WScript.Echo "ERROR: no pude identificar la unidad 'centimetros' en CorelDRAW"
    WScript.Quit 1
End If

' Documento nuevo con unidades en cm; la pagina se ajusta al tamano exacto del
' cuadrado para que el SVG (viewBox) mida justo N x N cm — lo esperado en corte.
Dim doc, page, shape
Set doc = corel.CreateDocument()
doc.Unit = cmUnit
Set page = doc.ActivePage
page.SizeWidth = sizeCm
page.SizeHeight = sizeCm
Set shape = doc.ActiveLayer.CreateRectangle2(0, 0, sizeCm, sizeCm)

' Exportar como SVG (pagina actual). Filtro 1345 = cdrSVG en v23; 811 en versiones viejas.
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

' El documento se queda abierto en CorelDRAW a proposito, para que el usuario lo vea
WScript.Echo "Cuadrado: " & sizeCm & " x " & sizeCm & " cm | shape: " & shape.SizeWidth & " x " & shape.SizeHeight & " (unidades doc)"
WScript.Echo "OK " & svgPath

Function Pad2(n)
    Pad2 = Right("0" & n, 2)
End Function
