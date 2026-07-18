# Prompts de Andrea (espejo versionado)

Los prompts **viven en Firestore** y se editan desde la UI del CRM (Entrenamiento IA, /cobranza) o con `scripts/prompt-tool.js`. Esta carpeta es un **espejo** en el repo para poder leerlos, revisarlos y versionarlos; **no se lee en runtime** — el bot siempre usa Firestore.

| Archivo | Firestore | Se usa cuando |
|---|---|---|
| `bot.md` | `crm_settings/bot` → `instructions` | Etapa 1 (venta), si no hay prompt por anuncio ni por departamento |
| `departamentos/<nombre>--<id>.md` | `ai_department_prompts/<id>` → `prompt` | Etapa 1, contacto asignado a ese departamento |
| `anuncios/<adId>.md` | `ai_ad_prompts` (campo `adId`) → `prompt` | Etapa 1, contacto llegó por ese anuncio (máxima prioridad) |
| `postventa.md` | `crm_settings/postventa` → `instructions` | Etapa 2 (post-venta: cobro, comprobantes, entrega) |
| `cobranza.md` | `crm_settings/bot_cobranza` → `instructions` | Cobranza automática (`server/cobranza/`) |
| `registro-pedidos-catalogo.md` | `crm_settings/ai_order_registration` → `catalogText` | Catálogo que se inyecta a la regla de cierre/registro cuando `enabled` |
| `conocimiento.md` | `ai_knowledge_base` (compilado) | Solo lectura: base de conocimiento tal como la ve Andrea |
| `respuestas-rapidas.md` | `quick_replies` (compilado) | Solo lectura: atajos del equipo tal como los ve Andrea |

Prioridad del prompt en etapa de venta: **anuncio → departamento → bot general** (`processMessagesWithAI` en `server/services.js`).

## Refrescar el espejo (bajar de Firestore)

```
node scripts/prompt-tool.js export
```

y commitear lo que cambie. Requiere credenciales admin: `serviceAccountKey.json` en la raíz del repo (gitignoreado) o la env `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Editar un prompt (subir a Firestore)

```
node scripts/prompt-tool.js set bot prompts/bot.md
```

`set` respalda el valor anterior en la colección `prompt_backups` y actualiza este espejo automáticamente. Targets: `bot | postventa | cobranza | catalogo | dept:<id> | ad:<adId>` (el `<id>` del departamento está en el nombre del archivo).

**Ojo:** si alguien edita un prompt en la UI del CRM, este espejo queda desfasado hasta el próximo `export`. Ante la duda, la fuente de verdad es Firestore. `conocimiento.md` y `respuestas-rapidas.md` son solo de lectura (se editan en la UI).

## Textos fijos que se anexan por código (no están en esta carpeta)

- Reglas y protocolos globales (cierre de pedido, [SPLIT], /cancelado, comprobante, datos de envío): `buildStaticContext` en `server/services.js`
- Prompt default de post-venta (si `postventa.md` está vacío): `DEFAULT_POSTVENTA_INSTRUCTIONS` en `server/services.js`
- Contexto por número de intento de cobro (1º–4º): `buildAttemptContext` en `server/cobranza/cobranzaScheduler.js`
- Regla de validación y registro automático de pedidos: `buildRegistrationRule` en `server/orders/aiOrderRegistration.js`
