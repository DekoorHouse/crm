# Comprobantes y formularios

Las imágenes/PDF entrantes se registran en `payment_receipts` antes de confirmar su
guardado al webhook. El procesador arranca con el servidor y recupera pendientes
cada 30 segundos, independientemente del navegador y de `botActive`.

- Un único pedido elegible permite vincular automáticamente. Si hay varios, el
  operador debe seleccionar el número exacto. Al activar la IA o registrar un
  pedido se recuperan los adjuntos recientes que todavía no tenían una entrada.
- La fecha se compara con la recepción del comprobante, no con la ejecución de
  la IA. No se valida sólo porque exista una foto ni por un comando del modelo.
- Se exigen importe, fecha, destino admitido, moneda, folio y operación realizada.
  Una imagen ilegible, un total excedido o una cancelación de origen desconocido
  requieren revisión. Sólo una cancelación de cobranza puede reactivarse sola.
- `payment_receipt_keys` evita sumar nuevamente una imagen o folio registrado en
  este flujo, incluso para otro pedido. No es un cotejo bancario ni un registro
  retroactivo de todos los comprobantes anteriores al despliegue.
- `paymentReceivedCents` acumula abonos. Sólo al cubrir el total se guarda
  `comprobanteValidadoAt` y se crea la obligación de enviar el formulario en el
  mismo commit. Los pagos OXXO acreditados por el webhook usan el mismo registro.
- `shippingFormStatus` es independiente: pending → sending → sent. El sello se
  escribe después del ID confirmado por el canal y del mensaje guardado en el
  chat. Un rechazo definitivo reintenta; un timeout ambiguo o un reinicio durante
  el envío se deriva a revisión, sin volver a enviar a ciegas.
- Fuera de la ventana del canal, el formulario queda visible y espera un nuevo
  mensaje del cliente. No se envía una plantilla ni se fuerza esa ventana.

El tablero Pendientes expone revisión de comprobantes, pagos en cancelados y
pagados sin formulario. La revisión permite validar el importe real, descartar
un comprobante o seleccionar su pedido. Para un envío ambiguo, el operador puede
confirmar que ya llegó o autorizar un reenvío después de revisar el chat.

No hay una migración masiva automática de pagos históricos. Para recuperar un
contacto se usa `discoverReceipts(contactId, { orderId })`; no aprueba sus pagos.
Las colas se conservan en Firestore al reiniciar o volver a una versión anterior.

Verificación: `node node_modules/jest/bin/jest.js tests/paymentWorkflow.test.js --runInBand`.
La suite usa Firestore y canales simulados; no transmite mensajes ni accede a
Firebase de producción.
