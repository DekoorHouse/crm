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
   Nombres de UNA linea; si piden dos renglones (ej. "Lourdes & Pedro") avisar que va en una
   linea o ajustar a mano despues en el .cdr.
2. Ejecutar (3 argumentos = hoja de 1 lampara; 6 = hoja de 2):

       cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\infinito.vbs" "Nombre1" "Nombre2" "Fecha1" ["Nombre3" "Nombre4" "Fecha2"]

   Hace: copia la plantilla a `Documents\SVG-Corte\infinito-<nombres>-<fecha>.cdr`, la abre,
   reemplaza los placeholders conservando el centro de cada texto, auto-reduce nombres largos
   (base 65.2pt, ancho max 52 mm; fechas 25.3pt, max 55 mm), guarda el .cdr (textos editables),
   convierte textos a curvas y exporta el SVG. Exito = lineas `OK <svg>` y `CDR <cdr>`.
3. **Verificacion visual** (recomendado): exportar PNG del doc abierto con
   `doc.Export ruta, CLng(802), CLng(1), Nothing, Nothing` (cdrPNG=802) y mirarlo con Read:
   nombres centrados en los aros, fecha centrada, nada encimado.
4. Subir el SVG a Drive y reportar con el link.

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
- **NUNCA recorrer todo el documento de produccion del usuario (799+ shapes) leyendo
  colores/fills**: eso tumbo CorelDRAW una vez (se pierde trabajo no guardado). Leer solo
  region/indices acotados y propiedades baratas (pos/tam/texto).
- El documento de produccion del usuario ("Plantillas Corazones.cdr") es intocable: no
  guardarlo, no cerrarlo, no mutarle shapes. Trabajar siempre en copias.
- Corel reusa la instancia abierta con `CreateObject`; cerrar docs de trabajo sin prompt:
  `doc.Dirty = False : doc.Close`.
- Si Corel no esta abierto y algo falla al conectar: pedir al usuario abrirlo y reintentar.
