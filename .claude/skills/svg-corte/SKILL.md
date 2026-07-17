---
name: svg-corte
description: >
  Genera archivos SVG de corte/grabado laser en CorelDRAW y los sube a la carpeta "SVG Corte"
  de Google Drive. Dos modos: (1) cuadrado simple de N cm; (2) lampara infinito personalizada
  (dos nombres + fecha por pedido, 1 o 2 pedidos por hoja de 350x330 mm). Usar siempre que el
  usuario pida un cuadrado de corte, una lampara/plantilla infinito, "archivo para laser",
  poner nombres y fecha a una lampara, o dibujar/exportar algo en CorelDRAW y subirlo a Drive —
  aunque solo diga "hazme la de Juan y Maria del 14-Febrero-2026".
---

# svg-corte: archivos de corte laser en CorelDRAW → SVG → Drive

Skill verificada en esta maquina con CorelDRAW 2021 (v23). Convenciones del negocio:
**corte = linea roja, grabado = negro, azul = infinito/corazones/marco** (tercera pasada).
Las hojas de lamparas son de **350x330 mm** con todo alineado **arriba-izquierda**.
Scripts junto a esta skill: `draw-square.vbs`, `infinito.vbs`, `upload-drive.js`,
plantillas en `plantillas/`.

## Modo 1: cuadrado simple

1. Medida en **cm** (si no la dieron, preguntar con AskUserQuestion: 5/10/15/20 cm; "Other"
   permite otra). Acepta decimales. Si responden en mm o pulgadas, convertir a cm.
2. Ejecutar:

       cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\draw-square.vbs" <medida>

   Exito = ultima linea `OK <ruta>`. Crea el SVG en `Documents\SVG-Corte\` con la pagina del
   tamano exacto del cuadrado; el doc queda abierto en Corel a proposito.
3. Verificar leyendo el SVG: `width`/`height` = `<N×10>mm`.
4. Subirlo a Drive (ver "Subida a Drive") y reportar medida + ruta local + link.

## Modo 2: lampara infinito (nombres + fecha)

Producto: lampara con globos de corazon (corte rojo), simbolo infinito con dos nombres
grabados (negro) y fecha abajo. **Lo normal son 2 pedidos por hoja** (cada cliente pide 1
lampara y se juntan 2 en una hoja); solo va 1 cuando ya no hay mas pedidos que disenar.

1. **Datos**: por cada pedido: nombre izquierdo, nombre derecho y fecha (texto libre, se graba
   tal cual: "30-Julio-2025", "Forever", etc.). Si el usuario no dio los datos completos,
   preguntarlos en el chat en un solo mensaje (son texto libre, no usar AskUserQuestion).
   **Nombres a 2 renglones**: pasar el token literal `\n` dentro del valor (ej. "Rosa\nMaría")
   — sale apilado y centrado a 44.8pt como los disenos manuales. La regla de negocio de cuando
   partir un nombre vive en `server/mockups/nameLayout.js` (misma que usan los mockups).
2. Ejecutar (3 argumentos = hoja de 1 lampara; 6 = hoja de 2):

       cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\infinito.vbs" "Nombre1" "Nombre2" "Fecha1" ["Nombre3" "Nombre4" "Fecha2"]

   Hace: copia la plantilla a `Documents\SVG-Corte\infinito-<nombres>-<fecha>.cdr`, la abre,
   reemplaza los placeholders conservando el centro de cada texto, auto-reduce nombres largos
   (base 65.2pt, ancho max 52 mm; fechas 25.3pt, max 55 mm), guarda el .cdr (textos editables,
   orientacion natural), convierte textos a curvas, aplica la **orientacion de produccion**
   (rotar -90 + reflejar verticalmente + realinear arriba-izquierda — el grabado va ESPEJEADO
   porque el laser graba por la parte de atras; regla dada por el usuario 2026-07-16) y
   exporta el SVG. Exito = lineas `OK <svg>` y `CDR <cdr>`.
3. **Verificacion visual** (recomendado): exportar PNG del doc abierto con
   `doc.Export ruta, CLng(802), CLng(1), Nothing, Nothing` (cdrPNG=802) y mirarlo con Read.
   Lo esperado en el SVG/PNG final: diseno VERTICAL pegado arriba-izquierda, textos EN ESPEJO
   (ilegibles al derecho), globos hacia la derecha, bases a la izquierda; con 2 pedidos el
   orden de arriba a abajo es nombre4, nombre3, nombre2, nombre1. Nada encimado.
4. Subir el SVG a Drive y reportar con el link.

## Modo 3: lampara de 4 corazones ("Plantilla Corazones para Claude")

Diseno mas nuevo de "Lampara de corazones": **4 corazones 3D con malla** (grabado) + simbolo de
infinito con los **2 nombres** y la **fecha**, en hoja **tabloide 279x431 mm (1 pieza)**. La
plantilla vive en `C:\Users\chris\Documents\Corel\Plantilla Corazones para Claude.cdr` (la mantiene
Chris; DEBE conservar sus 3 textos de ejemplo **"Romario" / "Romina" / "13-Agosto-1992"**, que
funcionan como placeholders detectados por CONTENIDO). No confundir con "Plantillas Corazones.cdr"
(doc de produccion intocable).

1. **Datos**: nombre izquierdo, nombre derecho, fecha y — opcional — un **texto adicional** (p. ej.
   el campo "Especial" del pedido, tipo "Aniversario No. 27") que va CENTRADO **debajo de la fecha**.
2. Ejecutar:

       cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\gen-corazones.vbs" /file:DHxxxx /mirror /svg /png /save "Nombre1" "Nombre2" "Fecha" ["TextoAdicional"]

   Copia la plantilla, reemplaza los 3 textos por contenido conservando el centro (auto-reduce si el
   nombre pasa de 52 mm o la fecha de 50 mm), crea el texto adicional bajo la fecha (~18 pt),
   convierte a curvas y con **/mirror** aplica la orientacion de produccion (rotar -90 + espejo
   vertical; el grabado va ESPEJEADO porque el laser graba por atras). Flags: `/svg` (SVG laser),
   `/png` (revision), `/save` (.cdr editable al derecho), `/close` (cierra el doc),
   `/extrasize:N` (pt del texto adicional, default 18).
3. Verificar el PNG (diseno EN ESPEJO, nada encimado) y subir el SVG a Drive (ver abajo).

Receta por si hay que recolocar a mano: nombre izq. centro **(72.0, 274.2) mm 62.4 pt**; nombre der.
**(152.9, 274.2) 62.4 pt**; fecha **(112.3, 247.4) 23.5 pt**; todo negro, fuente **Rows of Sunflowers**;
diseno centrado en X≈112.3. (Verificado end-to-end con DH13523 el 2026-07-17.)

## Modo 4: imagen para GRABADO RASTER (foto del cliente -> WaveSpeed)

Cuando el cliente pide **grabar una imagen/foto** (una foto de pareja, mascota, etc.). Convierte la
foto en una imagen lista para **grabado laser raster**: **rellenos blancos, fondo negro, degradado en
trama (halftone) y alto detalle**. Usa **WaveSpeed (GPT Image 2 Edit)**; la llave vive SOLO en Render,
por eso la skill llama al endpoint del servidor, no directo.

    node "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\gen-grabado.js" --img "<foto.jpg | http...>" [--corazon] [--extra "..."] [--out "<ruta.png>"] [--res 1k|2k] [--aspect 1:1|2:3|3:2]

- `--img` foto de entrada (ruta local -> se sube sola, o URL publica).
- `--corazon` cuando el grabado va en el **modelo de corazones**: le manda a WaveSpeed la silueta
  `referencias/corazon-forma.png` para que el grabado salga **con forma de corazon** (todo lo de fuera
  del corazon queda negro). Sin la bandera sale en el encuadre normal de la foto.
- `--extra "..."` instrucciones extra al modelo; `--out` ruta del PNG (default `Documents\SVG-Corte\grabado-<stamp>.png`).

Flujo interno: sube la(s) imagen(es) a URL publica (`POST /api/mockups/upload-image`) -> `POST
/api/mockups/engrave-submit {imageUrl, shapeImageUrl?}` (arma el prompt de grabado y manda a WaveSpeed)
-> `GET /api/mockups/generate-status/:jobId` hasta terminar -> baja el resultado y lo guarda como PNG.
Exito = ultima linea `OK <ruta-png>`. El prompt de grabado vive en el servidor
(`server/mockups/mockupsRoutes.js`, `ENGRAVE_PROMPT_BASE` / `ENGRAVE_PROMPT_SHAPE`). El PNG resultante
va DENTRO de la lampara con el pipeline de Corel (como el panda/toronja) y luego a Drive. **Convencion
de color**: si el laser necesita lo contrario (negro sobre blanco), invertir el PNG (sharp `.negate()`).

## Subida a Drive (carpeta "SVG Corte", id `1FhMAUghuLI7u58hPJbV8ZWk9hJ5JOG4b`)

**Via principal** (rapida, sin costo de contexto; setup YA HECHO el 2026-07-16):

    node "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\upload-drive.js" "<ruta-del-svg>"

Imprime JSON `{ok:true, id, name, webViewLink}` — usar ese webViewLink en el reporte.
Funciona via un Google Apps Script del usuario (URL y secreto en `drive-webapp.json`;
codigo de referencia en `apps-script-uploader.gs`). Los archivos quedan como propiedad de
dekoorhouse.work@gmail.com. NOTA: la cuenta de servicio del repo NO sirve para esto —
Google ya no da cuota de Drive a service accounts en cuentas personales.

Si algun dia responde HTML/login o "secreto invalido": el usuario debe re-desplegar el
Apps Script (script.google.com → su proyecto "SVG Corte Uploader" → Implementar → Nueva
implementacion → App web → Ejecutar como: Yo → Acceso: **Cualquier persona**, la opcion
SIN "que tenga una Cuenta de Google") y pasar la nueva URL /exec para `drive-webapp.json`.

**Fallback** (sin setup; usarlo solo con archivos chicos, cuesta muchos tokens con SVGs
grandes): tools del conector Google Drive via ToolSearch
(`select:mcp__836b681d-6968-4263-8cf2-2ce2531b12a6__create_file,mcp__836b681d-6968-4263-8cf2-2ce2531b12a6__search_files`);
`create_file` con `title`, `parentId` = id de arriba, `contentMimeType` = `image/svg+xml`,
`disableConversionToGoogleType` = true, `textContent` = contenido exacto del SVG. Si el
parentId fallara, re-buscar la carpeta: `title = 'SVG Corte' and mimeType = 'application/vnd.google-apps.folder'`.

## Automatización (worker local) — ACTIVO (cada 15 min; confirmado 2026-07-17)

`scripts/svg-corte-worker.js` (repo crm) hace el Modo 2 SOLO: pedidos 'Fabricar' con mockup
aprobado → hoja de 2 → Corel → Drive → estatus "Diseñado por IA". **Fidelidad con el mockup**:
usa `mockup_previews.previews[].layout` (renglones leidos por vision de la imagen que el
cliente aprobo) como fuente de verdad de los textos; sin eso, los fields (que ya traen `\n`
si la regla de renglones decidio 2 lineas). **CANDADO anti-re-corte** (commit a779b46d): salta
pedidos con `guiaEnvio.guia` u `ocultoDeEnvios` (ya fabricados/enviados) y los que ya tienen
`svgCorteAt`/`disenoListoAt` — MISMA regla que Pendientes de Diseño (`designPending.js`). Sin ese
candado el worker re-cortó 9 pedidos ya enviados el 2026-07-16 (corrida de las ~5pm). Para pausar:
`svg_corte_config/settings.autoGenerate = false`. Para (re)crear la tarea programada:
`cmd /c 'schtasks /Create /F /TN "CRM SVG Corte Worker" /SC MINUTE /MO 15 /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\Users\chris\Documents\crm\scripts\svg-corte-worker.js\""'`
(node DIRECTO: WSH no lanza procesos bajo el Programador). Log en
`Documents\SVG-Corte\worker.log`. Flags: `--dry` (solo lista), `--force`, `--max N`.

## Plantillas (`plantillas/`)

- `plantilla-infinito-2.cdr`: hoja 350x330 con DOS lamparas y placeholders
  `NOMBRE1/NOMBRE2/FECHA1` (izquierda) y `NOMBRE3/NOMBRE4/FECHA2` (derecha).
- `plantilla-infinito-1.cdr`: solo la lampara izquierda (mismo marco azul 324x200).
- Extraidas del archivo de produccion "Plantillas Corazones.cdr" (2026-07-16), alineadas a la
  esquina superior izquierda. `infinito.vbs` NUNCA las modifica (trabaja sobre copia).
- Si el diseno base cambia, re-extraer con el mismo procedimiento: seleccionar la region con
  `Page.SelectShapesFromRectangle`, copiar, pegar en doc nuevo 350x330, alinear, poner
  placeholders, `SaveAs`.

## Gotchas de CorelDRAW por COM (no re-descubrirlos)

- Usar **VBScript/cscript**, no PowerShell (PS no convierte los enums de la typelib).
- `Document.Export` exige los **5 argumentos**: `path, filtro, rango, Nothing, Nothing`.
  Filtros v23: **cdrSVG=1345** (811 en versiones viejas), **cdrPNG=802**. Unidad mm = 3.
  Los enums reales salen de `Programs64\TypeLibs\CorelDRAW.tlb`.
- `SelectShapesFromRectangle` vive en **Page** (no en Document); retorna la seleccion en
  `corel.ActiveSelection`.
- Un ShapeRange NO se indexa en VBS (`sr(i)` truena); iterar `For Each s In page.Shapes`.
- `ShapeRange.Group` SI regresa el grupo (usar con Set), pero `Shape.Ungroup` NO regresa
  objeto en v23 — llamarlo como instruccion simple, sin `Set`.
- El stdout de cscript sale en codepage OEM: NO parsear rutas con acentos desde un proceso
  padre (llegan mojibake). Dictar el nombre de salida con `/file:` (ASCII) como hace el worker.
- **NUNCA recorrer todo el documento de produccion del usuario (799+ shapes) leyendo
  colores/fills**: eso tumbo CorelDRAW una vez (se pierde trabajo no guardado). Leer solo
  region/indices acotados y propiedades baratas (pos/tam/texto).
- El documento de produccion del usuario ("Plantillas Corazones.cdr") es intocable: no
  guardarlo, no cerrarlo, no mutarle shapes. Trabajar siempre en copias.
- Corel reusa la instancia abierta con `CreateObject`; cerrar docs de trabajo sin prompt:
  `doc.Dirty = False : doc.Close`.
- Si Corel no esta abierto y algo falla al conectar: pedir al usuario abrirlo y reintentar.
