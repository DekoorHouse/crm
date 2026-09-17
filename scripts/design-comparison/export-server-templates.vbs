' One-time export of production assets. Not used by the server at runtime.
Option Explicit
Dim fso, app, root, dest, rows, spacing
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetAbsolutePathName(".")
If Not fso.FolderExists(root & "\output") Then fso.CreateFolder root & "\output"
If Not fso.FolderExists(root & "\output\svg-server-comparison") Then fso.CreateFolder root & "\output\svg-server-comparison"
dest = root & "\server\design\templates"
If Not fso.FolderExists(dest) Then fso.CreateFolder dest
Set app = CreateObject("CorelDRAW.Application")
Set rows = fso.CreateTextFile(dest & "\layout.tsv", True)
Set spacing = fso.CreateTextFile(dest & "\line-spacing.tsv", True)
spacing.WriteLine "model" & vbTab & "advancePerEm"
rows.WriteLine "variantKey" & vbTab & "slot" & vbTab & "field" & vbTab & "cxMm" & vbTab & "cyMm" & vbTab & "fontPt" & vbTab & "font"
ExportTemplate "infinito", 1
ExportTemplate "infinito", 2
ExportTemplate "spiderman", 1
ExportTemplate "spiderman", 2
ExportTemplate "rex", 1
ExportTemplate "rex", 2
rows.Close
spacing.Close
WScript.Echo "Server templates exported"

Function Num(v)
    Num = Replace(CStr(v), ",", ".")
End Function
Sub Collect(shapes, texts, count)
    Dim s
    For Each s In shapes
        If s.Type = 7 Then
            Collect s.Shapes, texts, count
        ElseIf s.Type = 6 Then
            Set texts(count) = s: count = count + 1
        End If
    Next
End Sub
Sub ExportTemplate(model, pieces)
    Dim source, variantKey, doc, tmp, texts(100), n, i, g, swap, field, slot, s
    variantKey = model & "-" & pieces
    If model = "infinito" Then source = "plantilla-" & variantKey & ".cdr" Else source = "plantilla-" & model & "-2.cdr"
    tmp = root & "\output\svg-server-comparison\export-" & variantKey & ".cdr"
    fso.CopyFile root & "\.claude\skills\svg-corte\plantillas\" & source, tmp, True
    Set doc = app.OpenDocument(tmp)
    doc.Unit = 3
    n = 0: Collect doc.ActivePage.Shapes, texts, n
    If model <> "infinito" Then
        If n <> 2 Then Err.Raise 1001, , "Expected two character placeholders"
        If texts(0).CenterY < texts(1).CenterY Then
            Set swap = texts(0): Set texts(0) = texts(1): Set texts(1) = swap
        End If
        texts(0).Name = "slot0": texts(1).Name = "slot1"
        If pieces = 1 Then texts(1).ParentGroup.Delete
        Set g = doc.ActivePage.Shapes.All.Group
        g.Flip 2: g.Rotate 90
        g.PositionX = 0: g.PositionY = doc.ActivePage.SizeHeight
        g.Ungroup
        n = 0: Collect doc.ActivePage.Shapes, texts, n
    End If
    For i = 0 To n - 1
        Set s = texts(i)
        If model = "infinito" Then
            field = Trim(Replace(Replace(s.Text.Story.Text, vbCr, ""), vbLf, ""))
            Select Case field
                Case "NOMBRE1": slot = 0: field = "nombre1"
                Case "NOMBRE2": slot = 0: field = "nombre2"
                Case "FECHA1": slot = 0: field = "fecha"
                Case "NOMBRE3": slot = 1: field = "nombre1"
                Case "NOMBRE4": slot = 1: field = "nombre2"
                Case "FECHA2": slot = 1: field = "fecha"
                Case Else: Err.Raise 1002, , "Unexpected placeholder " & field
            End Select
        Else
            slot = CInt(Right(s.Name, 1)): field = "nombre"
        End If
        rows.WriteLine variantKey & vbTab & slot & vbTab & field & vbTab & Num(s.CenterX) & vbTab & Num(doc.ActivePage.SizeHeight-s.CenterY) & vbTab & Num(s.Text.Story.Size) & vbTab & s.Text.Story.Font
    Next
    ' Record actual Corel multiline baselines for calibration, using a scratch document.
    If pieces = 1 Then
        Set s = texts(0)
        s.Text.Story.Text = "Jose" & vbCr & "Miguel"
        s.Text.Story.Size = 44.8
        s.Text.Story.Alignment = 3
        If model = "infinito" Then s.Text.Story.LineSpacing = 60 Else s.Text.Story.LineSpacing = 100
        spacing.WriteLine model & vbTab & Num(s.Text.Story.Baselines.BoundingBox.Height / (44.8 * 25.4 / 72))
        doc.Export root & "\output\svg-server-comparison\" & model & "-multiline-editable.svg", CLng(1345), CLng(1), Nothing, Nothing
    End If
    For i = 0 To n - 1
        texts(i).Delete
    Next
    doc.Export dest & "\" & variantKey & "-natural.svg", CLng(1345), CLng(1), Nothing, Nothing
    If model = "infinito" Then
        Set g = doc.ActivePage.Shapes.All.Group
        g.Rotate -90: g.Flip 2
        g.PositionX = 0: g.PositionY = doc.ActivePage.SizeHeight
        g.Ungroup
        doc.Export dest & "\" & variantKey & "-cut.svg", CLng(1345), CLng(1), Nothing, Nothing
    End If
    doc.Dirty = False: doc.Close
    ' Character production geometry comes directly from the original CDR, without inverse roundtrip.
    If model <> "infinito" Then
        fso.CopyFile root & "\.claude\skills\svg-corte\plantillas\" & source, tmp, True
        Set doc = app.OpenDocument(tmp): doc.Unit = 3
        n = 0: Collect doc.ActivePage.Shapes, texts, n
        If texts(0).CenterY < texts(1).CenterY Then
            Set swap = texts(0): Set texts(0) = texts(1): Set texts(1) = swap
        End If
        If pieces = 1 Then texts(1).ParentGroup.Delete
        n = 0: Collect doc.ActivePage.Shapes, texts, n
        For i = 0 To n-1
            texts(i).Delete
        Next
        doc.Export dest & "\" & variantKey & "-cut.svg", CLng(1345), CLng(1), Nothing, Nothing
        doc.Dirty = False: doc.Close
    End If
    fso.DeleteFile tmp
    WScript.Echo variantKey
End Sub
