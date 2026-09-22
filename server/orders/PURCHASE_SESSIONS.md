# Compras independientes en un chat

El webhook abre una sesión cuando un cliente con un pedido pagado/enviado pide claramente otra lámpara o pedido. Las consultas de guía, garantía y reposición no abren compras. Las solicitudes ambiguas producen una pregunta de aclaración antes de registrar o cobrar.

`contacts_whatsapp.activePurchaseSessionId` y `activePurchaseStartedAt` identifican la compra activa. El inicio usa la fecha del mensaje del cliente para conservar sus primeros datos y anticipos. Los mensajes entrantes y las respuestas de IA se etiquetan; el historial físico permanece intacto. Cada nueva sesión guarda el mensaje de origen y los pedidos anteriores en `purchase_sessions`.

Los pedidos y comprobantes heredan `purchaseSessionId`. El extractor de registro y el contexto conversacional filtran por la compra activa; los pagos anteriores no se heredan. Una referencia explícita DH permite consultar el pedido correspondiente sin cambiar la sesión activa. No se migran ni reinterpretan automáticamente los chats históricos.

La detección es conservadora y textual. Una compra aún sin DH continúa en la misma sesión; no se crea otra por repetir la solicitud. Los comprobantes siguen sujetos a los índices globales contra duplicados y a revisión cuando su relación con el pedido es incierta.
