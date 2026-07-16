' Lanzador oculto del svg-corte-worker para el Programador de tareas de Windows
' (evita que parpadee una ventana de consola cada 15 min; CorelDRAW si se muestra al generar).
Dim shell, nodeExe, workerJs
Set shell = CreateObject("Wscript.Shell")
nodeExe = "C:\Program Files\nodejs\node.exe"
workerJs = "C:\Users\chris\Documents\crm\scripts\svg-corte-worker.js"
shell.Run """" & nodeExe & """ """ & workerJs & """", 0, False
