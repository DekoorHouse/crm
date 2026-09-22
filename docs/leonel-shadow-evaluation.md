# Evaluación de Leonel con contexto de producción

El hook de `generateChatCompletion` se activa exclusivamente en la llamada del bot de `services.js`. Captura el JSON final enviado a OpenRouter después de traducir los turnos y adjuntar multimedia y caché. Las llamadas de clasificadores, simuladores y procesos auxiliares no participan.

La respuesta del modelo de producción continúa por el flujo habitual. En una tarea desacoplada se guarda su petición/respuesta y se consulta Gemini 3.8 Flash y Gemini 3.1 Flash Lite. Se preservan todos los parámetros; solo cambia `model`. No hay reconstrucción posterior del pedido o pago. Los archivos embebidos se conservan exactamente como llegaron al proveedor: no se promete evaluar archivos que el propio adaptador de producción haya omitido.

Las respuestas candidatas nunca regresan al flujo de producción. El módulo solo conoce Firestore de evaluación, almacenamiento cifrado y el endpoint de OpenRouter; no importa servicios de mensajería, pedidos, pagos ni despachadores de comandos. `/registrar`, `/comprobante`, etc. se registran como propuestas, jamás se ejecutan. Tampoco se cambia el proveedor/modelo del chat.

## Alcance de la comparación

- Objetivo: 200 casos de muestreo general y 100 casos enriquecidos por pagos, multimedia, cambios o varios productos. Se reportan separados.
- Selección determinista mediante HMAC del contacto y mensaje. Probabilidad general 10%; entre los restantes, los difíciles tienen 35%. Una sola participación por contacto y corrida, deduplicada en transacción entre instancias.
- Máximo 50 casos al día (día de México), siete días, US$15 adicionales. Puede terminar con menos de 300 si no hay tráfico suficiente, falla un proveedor, vence el plazo o no alcanza el presupuesto.
- Solo una comparación en vuelo por proceso. No hay cola sin límite; se contabilizan descartes por ocupación, cuota, tamaño/configuración no soportada y fallas. La muestra es operativa, no aleatoria perfecta: puede excluir picos de tráfico.
- El baseline es la salida REAL del proveedor, incluidos intentos, uso y duración, no una regeneración. No incluye todavía la expansión final de atajos, filtros posteriores ni confirmación de entrega de WhatsApp; comparar propuestas no equivale a medir ventas, calidad de comprobantes validada por un humano o acciones ejecutadas.
- Cualquier cambio de instrucciones o modelo durante la corrida queda reflejado en cada petición, sin asumir un prompt único.

## Activación y operación

Desde la shell autenticada del servidor, en la raíz del repo:

```sh
node --test tests/shadowEvaluation.node-test.cjs
node scripts/leonel-shadow.js start leonel-live-20260921
node scripts/leonel-shadow.js status
node scripts/leonel-shadow.js stop
node scripts/leonel-shadow.js export leonel-live-20260921 /tmp/leonel-review-private
```

`start` verifica los modelos y tarifas actuales, proveedor activo, credenciales y cifrado. Crea `crm_settings/ai_shadow_evaluation` y `ai_shadow_runs/<id>` atómicamente. Rechaza ids existentes y otra corrida activa; nunca reinicia el contador de gasto. No se necesita redeploy para detener la corrida. El interruptor se revisa nuevamente en la reserva y antes de cada candidato. Una solicitud que ya está en vuelo puede terminar después del stop.

Por defecto, el hook solo opera en Render; local requiere `AI_SHADOW_ENABLED=true`. `AI_SHADOW_ENABLED=false` lo apaga por entorno. Sin corrida válida en Firestore no se almacenan conversaciones ni se hacen llamadas candidatas.

El script `status` separa métricas por cohorte/modelo. `complete` requiere texto no vacío y `finish_reason=stop`; HTTP 200 no basta. Los costos faltantes se muestran como desconocidos, nunca cero. El reporte incluye `stalledCases` si una captura permanece reservada más de 15 minutos y contadores de descartes. Un reinicio no repite automáticamente solicitudes cuyo cobro se desconoce.

## Presupuesto

Antes de llamar a los candidatos se reserva en una transacción compartida el costo conservador de ambos modelos. Usa tarifas vigentes (incluidos escalones), bytes como cota conservadora de tokens, entrada sin descuento de caché, salida máxima, dos intentos y margen adicional. Archivos base64 cuentan en la cota. Se omiten peticiones mayores de 12 MiB y límites de salida superiores a 4096; no se recorta ni modifica el prompt para hacer caber una prueba.

Se liquida el costo real reportado después de cada caso. Si falta el costo de cualquier intento se conserva la reserva de ese modelo. Un crash deja la reserva intacta: no se devuelve dinero contablemente suponiendo que no hubo cobro. El límite es un control conservador de admisión, no una garantía de facturación del proveedor. El consumo real del bot de producción se informa aparte y no se carga al presupuesto adicional.

## Datos privados y retención

Las reglas históricas del bucket permiten lecturas públicas. Por ello **nunca se guarda el JSON sin cifrar**: se comprime y cifra con AES-256-GCM, vinculando el contenido a la ruta mediante AAD. No se crean enlaces de descarga ni tokens Firebase.

La clave es `AI_SHADOW_ENCRYPTION_KEY` (64 caracteres hex) si existe, o se deriva con separación de dominio del secreto de servicio de Firebase ya presente en Render. No se guarda la clave en Firestore, Storage ni logs. Rotar ese secreto durante la corrida requiere conservar de forma segura la clave anterior para leer sus capturas.

Firestore contiene solo contadores, ids HMAC y métricas sin texto de clientes. Las peticiones/respuestas, ids originales y archivos están dentro del blob cifrado `ai-shadow-private/<run>/<case>.bin`. Se eliminan los blobs tras 14 días mediante mantenimiento horario; requiere que el servicio continúe ejecutándose. Se conserva el registro de métricas sin contenido. El mantenimiento recorre también corridas anteriores/detenidas, hasta 25 por pasada; exportaciones privadas creadas manualmente deben gestionarse por separado.

La exportación genera `blinded.private.json` con entradas y respuestas A/B/C en orden permutado, sin identidad del modelo ni costo; `answer-key.private.json` guarda la correspondencia. Incluye una plantilla de revisión por pregunta contestada, hechos fundamentados, pagos/acciones, instrucciones y concisión. Las exportaciones contienen datos privados y no deben guardarse en Git ni compartirse públicamente. La revisión humana de comprobantes y saldos debe usar evidencia capturada en ese momento, no estados actuales del CRM.

## Verificación

```sh
node --test tests/shadowEvaluation.node-test.cjs
node --check server/ai/shadowEvaluationCore.js
node --check server/ai/shadowEvaluation.js
node --check server/ai/openaiProvider.js
node --check scripts/leonel-shadow.js
```

Las pruebas cubren cifrado/autenticación, fidelidad del payload con imágenes, rechazo de herramientas, límites y reservas concurrentes, kill-switch fresco, deduplicación, costos desconocidos, respuestas filtradas, reintentos y aislamiento de la respuesta real ante fallas de la captura.
