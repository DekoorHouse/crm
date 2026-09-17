# Corte automático en el servidor

`svgCutScheduler` se inicia con los demás schedulers en Render (`ENABLE_SCHEDULERS` permite el override habitual) y revisa la cola cada dos minutos. Los modelos automáticos son corazones/infinito, Spiderman y T-Rex. `svgAuto.js` conserva las reglas de elegibilidad, pagos, correcciones y pedidos especiales. El trabajo pesado se ejecuta en un worker thread; no bloquea las peticiones del CRM.

Los SVG de corte, SVG legibles y PNG quedan en Firebase Storage. Los SVG finales se suben a la misma carpeta de Drive mediante el Apps Script existente. Los pedidos guardan sus enlaces y `svgCorteBy=server-svg-v1`. No se genera CDR; los SVG contienen curvas, por lo que no requieren la fuente al importar al software del láser.

## Activación

Las rutas `/api/svg-corte/*` usan el middleware habitual de autenticación del CRM.

1. Desplegar y comprobar `GET /api/svg-corte/status`. `POST /preview` permite probar `{model, lamps}` sin escribir pedidos ni subir archivos.
2. Consultar `GET /queue` para revisar la selección sin efectos.
3. `POST /activate` con `{"engine":"server-svg-v1"}` desactiva `autoGenerate` del worker anterior y configura una hora de transición. Si se verificó que su tarea está detenida, agregar `"legacyWorkerStopped":true` permite comenzar de inmediato. La preferencia previa queda en `serverAutoGenerate`; `personajeAutoCut` y `videoAutoCut` se conservan.
4. Confirmar `lastFinishedAt`, `lastResult` y los trabajos en `/status`. `POST /pause` detiene al servidor sin reactivar Corel. No encender ambos motores como rollback; revisar primero los trabajos activos o inciertos.

Las solicitudes nuevas del botón «Diseñar con IA» se guardan en `svgServerRequest`, mostrando el mismo estado en el CRM. Las solicitudes antiguas `iaForce` no se consumen simultáneamente desde dos máquinas; `/status` las enumera para terminar o migrar explícitamente las pendientes. Los diseños especiales hechos a mano siguen siendo manuales. El comando local conserva únicamente la subida de especiales ya aprobados y guardados en esa computadora mediante `svg-corte-approved-local.js`; no genera lámparas con Corel.

## Recuperación

Un candado transaccional de Firestore permite una sola instancia. Los pedidos y el trabajo de `svg_cut_jobs` se reclaman en la misma transacción. Se generan todas las hojas de un pedido antes de subir la primera. Las marcas de terminado solo se escriben cuando todas las subidas están confirmadas. Cada pedido registra exclusivamente sus propias hojas.

Antes del POST a Drive se registra `uploading`. Si hay timeout, respuesta inválida o reinicio en ese punto, el trabajo pasa a `needs_review` y los pedidos quedan visibles para revisión (`designForce` y `svgCorteReviewRequired`), sin marcarse terminados y sin repetir la subida. El operador debe buscar el nombre exacto del archivo del trabajo en Drive y resolver los archivos presentes/faltantes antes de quitar el bloqueo. Las subidas confirmadas se reutilizan si falla la escritura final de Firestore. Cambiar un pedido o su mockup invalida el plan previo.

Los fallos de geometría afectan solo al nombre que no cabe. Después de tres intentos, el pedido pasa a revisión manual. Los errores de infraestructura conservan el trabajo durable para continuar en la siguiente ejecución. No se mandan mensajes a clientes desde este motor.

## Validación

`npx jest tests/svgCutQueue.test.js tests/svgCutWorker.test.js tests/svgRenderer.test.js tests/svgCutRoutes.test.js --runInBand`

GitHub Actions repite estas pruebas en Linux con Node 22. Las comparaciones son digitales; no operan el láser.
