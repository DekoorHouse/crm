# Piloto: preview del diseño + cobro inmediato (en lugar de "foto del trabajo terminado")

**Estado:** IMPLEMENTADO con el switch APAGADO (dom 19-jul-2026 en la noche). Nada cambia en
producción hasta encenderlo: `crm_settings/piloto_preview` → `{ enabled: true }`. Para apagar
(rollback): `enabled: false`. Corte de resultados: `node scripts/piloto-preview-corte.js`.
Piezas: server/orders/pilotoPreview.js (helper/textos), whatsappHandler (sellado A/B + RI
variante), services (nota de venta), createOrderCore (herencia), mockupsRoutes (+/cuatrop en
send-context, sello previewEnviadoAt en claim-payment, A-primero en /pending), mockupAutoScheduler
(sello mockupListoAt), cobranzaScheduler (nota A + salto cobro-1 <6h), badge ⚡ en sección Mockup.
Quick replies /tttp y /cuatrop creadas en Firestore.
**Dueño:** Alex. **Implementa:** Claude (este documento es el brief completo).

## La tesis (con evidencia medida, no intuición)

Hoy el cliente registra su pedido y espera **~8 horas** (mediana; 75% hasta 14.4 h) a que un humano
revise y mande el mockup presentado como "foto de tu lámpara terminada". Cuando por fin la ve,
**paga en 1.3 horas** (mediana): 38% en menos de 1 h, 66% en menos de 4 h. Además, el 82% de los
que pagan siguen activos en el chat después del registro. Conclusión medida el 19-jul sobre los
pagados de la campaña 4ads: **el dinero ya está listo al registrar; la espera es nuestra, no del cliente.**

Cambio: en cuanto se registra el pedido, generar el mockup (ya se auto-genera: `mockupAutoScheduler`
corre cada 10 min pero NO envía), pasarlo por una revisión humana EXPRESS y mandarlo al cliente como
**vista previa** con el cobro en el mismo mensaje. Meta: capturar el pago en la misma sesión de chat.

**Métrica de éxito:** tasa de pago a 7 días del grupo piloto vs control (línea base madura: 39%).
Secundarias: tiempo registro→pago, % pagados en <4 h, tasa de cancelación.

## Decisiones ya tomadas (por Alex, 19-jul)

1. **Alcance:** SOLO lámparas de corazones estándar (2 nombres + fecha). Quedan FUERA: personalizaciones
   especiales, canal anticipo ($300), pedidos de 5+ piezas, otros productos. Esos siguen el flujo actual.
2. **Revisión:** EXPRESS manual, SIN alertas (decidido 19-jul) — Alex revisa y aprueba los mockups del
   grupo A él mismo durante las pruebas, checando el CRM periódicamente. Meta: **< 1 hora** desde el
   registro; los sellos `previewListoAt`/`previewEnviadoAt` miden el SLA real logrado. Los pedidos A se
   distinguen visualmente en el CRM para encontrarlos al instante (ver "Distinción visual" abajo).
3. **Medición:** A/B 50/50 — pero por CONVERSACIÓN, no por pedido (corregido el 19-jul con observación
   de Alex: el encuadre "pagas al ver la foto terminada" nace desde la RI y los atajos de la conversación;
   partir en el registro dejaría al grupo A con una promesa y otra entrega). Asignación por paridad del
   ÚLTIMO DÍGITO DEL TELÉFONO del contacto (par = A, non = B) al entrar la conversación a un departamento
   elegible: estable, determinista, ~50/50 y auditable. El grupo se sella en el CONTACTO y el pedido lo
   hereda. El grupo A vive la narrativa del preview DESDE la conversación (ver piezas abajo); el B no
   cambia en nada. Bonus: así el experimento mide el MODELO completo ("apruebas tu diseño y pagas" vs
   "pagas al ver tu foto terminada") de conversación a pago — que es la métrica de negocio real.
4. **Cobro:** preview + cobro JUNTOS en el mismo momento. Encuadre: *"Así va a quedar la tuya — apruébala
   y con tu pago hoy mismo entra a producción"* + datos de pago. (Base: la quick reply `previa` existente.)

## El flujo nuevo (grupo A) vs el actual

**Actual (grupo B, control):** registro → cola "Sin estatus" → diseño/mockup → revisión → equipo manda
"foto de tu pedido terminado" + /cuatro (mediana 8 h) → cliente paga → Fabricar.

**Piloto (grupo A):** registro → mockup auto-generado (minutos) → **alerta al revisor** → revisor aprueba
(SLA < 1 h) → **envío automático al aprobar**: imagen + mensaje de preview con datos de pago → cliente
aprueba/paga (Andrea maneja la conversación; el comprobante sigue el flujo normal de /comprobante, que
ya funciona en etapa de venta con pedido registrado vía `paymentPhaseActive`) → Fabricar.

Si el cliente pide un CAMBIO al ver el preview: Andrea confirma el dato corregido → el pedido regresa a
cola de mockup para regenerar → nuevo ciclo de revisión express → nuevo preview. (MVP: la regeneración
puede ser manual; lo importante es que el estado quede visible.)

## Cambios técnicos (mapa para la sesión de implementación)

- **Switch y config:** `crm_settings/piloto_preview` → `{ enabled, revisores: [tels], horarioRevision }`.
  Apagado = todo sigue igual (rollback instantáneo).
- **Asignación A/B (nivel CONVERSACIÓN):** cuando un contacto entra/está en un departamento elegible
  (corazones estándar) y el piloto está encendido, sellar `contact.pilotoPreview: 'A' | 'B'` por paridad
  del último dígito de su teléfono (par = A, non = B). Sellar UNA sola vez (si ya tiene grupo, no se
  cambia). Al registrar su pedido, el pedido hereda el grupo. Pedidos no elegibles (especial, anticipo,
  5+ piezas) salen del piloto aunque el contacto tenga grupo.
- **Narrativa del grupo A durante la CONVERSACIÓN** (el B no se toca):
  1. **RI variante:** la línea "📸 Pagas al ver la foto del trabajo terminado antes de enviar" cambia a
     "📸 Te mandamos el diseño EXACTO de tu lámpara para que lo apruebes — pagas ya que lo veas y te
     encante". Implementación: en el webhook, al elegir el mensaje del ad, usar la variante si el
     teléfono es par (mensajes-ads con campo alterno o reemplazo de línea).
  2. **Atajo /tttp** (variante de /ttt para el grupo A): en lugar de "Mañana te enviaremos la foto de tu
     pedido personalizado…", decir "En cuanto confirmes tu pedido, EN MINUTOS te mandamos el diseño de
     cómo va a quedar para que lo apruebes y realices tu pago ✨ El ENVÍO ES GRATIS por DHL…". Se crea
     como quick reply nueva.
  3. **Nota de prompt para Andrea (solo contactos A):** inyectar en el contexto dinámico (como las notas
     de cobertura/fecha ya existentes): "PILOTO PREVIEW: a este cliente NO le hables de 'foto del trabajo
     terminado'. El flujo con él es: al confirmar su pedido le mandamos en minutos el DISEÑO exacto de su
     lámpara; lo aprueba, paga y entra a producción hoy mismo. Usa /tttp en lugar de /ttt.". Nada más
     cambia en el prompt global (el caché de contexto no se invalida: la nota va en la parte dinámica).
- **Generación:** ya existe (`server/mockups/mockupAutoScheduler.js`, cada 10 min, "SOLO genera, no envía").
  Revisar si se puede disparar la generación inmediata al registrar (en vez de esperar el ciclo de 10 min).
- **Distinción visual (sin alertas):** los pedidos del grupo A se marcan para saltar a la vista en las
  pantallas que Alex ya usa: badge "⚡ Preview" en la fila del pedido (mismo patrón que el resaltado 🤖
  de los pedidos registrados por IA) en la lista de Pedidos Y en la cola de Mockups; los A se ordenan
  HASTA ARRIBA de la cola de diseño; si sale barato, un filtro "solo piloto ⚡". Guardar `previewListoAt`
  cuando el mockup quede generado (con eso se mide cuánto tardó Alex en revisarlo).
- **Aprobación express:** usar el gesto que YA existe en la página de Mockups para aprobar/enviar
  (confirmar el flujo actual de esa página al implementar). Al aprobar un pedido A → envío automático
  del mensaje de preview+cobro (en vez del envío manual de foto de hoy).
- **Envío:** imagen del mockup + mensaje de preview+cobro (texto abajo) al contacto. Sellar en el pedido
  `previewEnviadoAt` (⚠️ hoy NO se guarda ninguna fecha de foto — este sello además arregla ese hueco de
  medición) y cambiar estatus a **"Foto enviada"** para que la cobranza automática lo tome igual que hoy.
- **Mensaje (borrador, ajustar con Alex):**
  > ¡Mira cómo va a quedar la tuya! 😍 Esta es la *vista previa de tu lámpara* con tus nombres y tu fecha 👇
  > Apruébala y con tu pago *hoy mismo entra a producción* 🚀
  > 💳 Transferencia BBVA — Christian Morales — Tarjeta *4152 3145 7069 0670* · CLABE *012190015409632629*
  > ¿La dejamos así o le ajustamos algo? (Si prefieres OXXO, dime y te paso la referencia)
- **Prompt de Andrea (ajuste mínimo):** en venta con pedido registrado, si el cliente responde al preview:
  aceptación → cobrar/validar comprobante como siempre; cambio → confirmar el dato exacto y avisar al
  equipo (definir comando; evaluar reutilizar el flujo de corrección). NO re-ofrecer el preview repetido.
- **Medición:** script tipo `scripts/checkpoint-campana-4ads.js` que compare A vs B en TRES niveles:
  (1) conversación→registro (¿el encuadre preview cierra igual, más o menos?), (2) registro→pago (tasa
  a 3/7 días, mediana de horas, % < 4 h), y (3) el neto conversación→pago con $ por conversación — la
  métrica que decide. Con ~350-500 conversaciones/día de la campaña (~175-250 por grupo) y ~35-40
  registros/día, en 1-2 semanas hay muestra para detectar diferencias de ±2 puntos en cierre y ±10 en pago.

## Guardrails

- Solo conversaciones/pedidos NUEVOS a partir del arranque (no tocar nada en vuelo; contactos con
  conversación previa al arranque quedan fuera del sellado para no mezclar narrativas).
- **Riesgo a vigilar #1:** que el encuadre "pagas al aprobar tu diseño" cierre MENOS ventas que "pagas
  al ver tu foto terminada" (promesa menos contundente contra la desconfianza). Por eso se mide el
  cierre por grupo desde el día 1 — si A cierra >2 puntos abajo sostenido, se revisa el copy de la RI/tttp
  antes de concluir nada del pago.
- **Riesgo a vigilar #2:** que el grupo B se contamine — el equipo, al ver las alertas del A, podría
  apurar (o descuidar) los B. El corte diario compara el tiempo registro→foto del B contra su histórico
  (~8 h): si se mueve mucho, el control se ensució.
- Exclusiones duras: especiales, canal anticipo, 5+ piezas, Messenger/IG si el envío de imagen difiere
  (validar), clientes con `botActive: false`.
- Fuera de horario de revisión (definir, ej. 10 pm-8 am): el mockup espera y la alerta sale a primera
  hora — el SLA se mide igual y ese subgrupo se puede analizar aparte.
- **Cobranza del grupo A: misma secuencia, otro lenguaje** (corregido 19-jul con observación de Alex).
  Los A se quedan en el ciclo normal (cobros días 0-2-5-9, cancelación día 10) para que la comparación
  sea justa y la limpieza del día 10 siga funcionando — pero sus mensajes NO pueden decir "tu pedido ya
  está terminado / ya te enviamos la foto" (a ellos se les mandó el DISEÑO y su lámpara aún no se
  fabrica). Implementación: en `cobranzaScheduler`, si el contacto es grupo A, anexar a las
  instrucciones (junto al `buildAttemptContext`) una nota: "PILOTO PREVIEW: a este cliente se le envió
  el DISEÑO de su lámpara para aprobarlo, NO la foto del producto terminado (aún no se fabrica). Cobra
  con ese encuadre: su diseño está listo y apartado; al pagar, entra a producción HOY. NUNCA digas que
  su lámpara ya está terminada o esperándolo." La escalada de intensidad (recordatorio → última llamada)
  se conserva igual.
  ⚠️ Caso especial: las plantillas cobro1-4 de ventana de 24h CERRADA son texto fijo aprobado por Meta.
  Al implementar, revisar su texto: si hablan de "pedido terminado", los A con ventana cerrada SE SALTAN
  la plantilla ese día (se reintenta cuando la ventana abra; si el piloto gana, se crean variantes
  aprobadas). Registrar cuántas veces pasa para saber si distorsiona.
- Vigilar que la cobranza no se sienta acoso en los A: el cobro 1 vespertino puede quedar muy pegado al
  preview — saltar el cobro 1 si `previewEnviadoAt` fue hace < 6 h (propuesto: sí).
- Si el cliente reporta error en el preview: se corrige y se re-envía sin fricción (es pre-pago, ventaja
  del modelo). Si algo sale mal en general: `enabled: false` y todo vuelve al flujo actual.

## Fases

1. **F1 — Código** (1 sesión): switch + A/B + alerta + aprobación→envío + sellos de tiempo + exclusiones.
2. **F2 — Prompt** (misma sesión): ajuste mínimo a instrucciones de Andrea + probar en simulador.
3. **F3 — Arranque**: encender con Alex mirando; primeras 24 h con revisión reforzada.
4. **F4 — Lectura**: a los 7 días primer corte A vs B; a los 14, decisión (adoptar 100%, ajustar o apagar).

## Pendientes de decidir con Alex al implementar

- Texto final del mensaje de preview+cobro (borrador arriba).
- ¿Saltar el cobro automático 1 si el preview salió hace < 6 h? (propuesto: sí)
- Confirmar el gesto de aprobar/enviar de la página de Mockups (se reutiliza el existente).

Resueltos: revisión manual por Alex sin alertas (19-jul); distinción por badge ⚡ + orden prioritario.

## Contexto de origen (por si esta sesión no tiene el historial)

Números medidos el 19-jul-2026 sobre pedidos pagados de la campaña "Ventas 1407//Corazones//4ads//"
(scripts en la sesión de ese día): t1 nuestra = 8 h mediana; t2 cliente = 1.3 h mediana; 38% paga < 1 h
tras ver la foto; 66% < 4 h; tasa de pago madura 39%; los 31+ pagados no necesitaron ningún cobro
automático. La "foto del trabajo terminado" actual ES un mockup — este piloto solo lo dice de frente
y lo entrega 8 horas antes. Relacionado: memoria `project-campana-4ads` (escalera de presupuesto:
este piloto es prerequisito para pasar de $10k/día) y `project-upsell-llaveros`.
