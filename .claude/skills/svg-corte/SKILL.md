---
name: svg-corte
description: >
  Dibuja un cuadrado en CorelDRAW en la compu del usuario (medida en cm), lo exporta como SVG
  real desde Corel y lo sube a la carpeta "SVG Corte" de su Google Drive. Usar siempre que el
  usuario pida un cuadrado para corte, un "SVG de corte", dibujar/exportar algo en CorelDRAW,
  o subir un SVG a la carpeta SVG Corte — aunque solo diga "hazme un cuadrado de 15" sin
  mencionar Corel ni Drive.
---

# svg-corte: cuadrado en CorelDRAW → SVG → Drive

Flujo verificado en esta máquina con CorelDRAW 2021 (v23). Son 4 pasos; complétalos todos
en orden sin pedir confirmación entre pasos. El script clave vive junto a esta skill:
`draw-square.vbs`.

## 1. Preguntar la medida

- Si el usuario ya dio la medida (p. ej. "/svg-corte 15" o "un cuadrado de 20"), úsala
  directamente; se asume en **centímetros**.
- Si no la dio, pregúntala con AskUserQuestion — "¿De qué medida quieres el cuadrado?" —
  con opciones "5 cm", "10 cm", "15 cm" y "20 cm" (la opción "Other" que agrega el
  componente le permite teclear cualquier otra medida).
- Si responde en mm o pulgadas, conviértelo a cm antes de seguir: el script solo recibe cm.
  Acepta decimales ("12.5").

## 2. Dibujar y exportar en CorelDRAW

Ejecuta (con la ruta absoluta del .vbs de esta skill):

    cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\draw-square.vbs" <medida>

Qué hace: abre CorelDRAW visible (si ya está abierto, Corel reusa la instancia), crea un
documento nuevo con la página del tamaño EXACTO del cuadrado (así el viewBox del SVG mide
justo N×N cm, que es lo que esperan los programas de corte), dibuja el cuadrado y exporta.

- Éxito = la última línea impresa es `OK <ruta>`. El SVG queda en
  `Documents\SVG-Corte\cuadrado-<N>cm-<fecha>.svg`.
- El documento se queda abierto en Corel a propósito, para que el usuario lo vea. No lo cierres.
- **Verifica** leyendo el SVG exportado: `width`/`height` deben ser `<N×10>mm`
  (10 cm → `width="100mm"`) y el `<rect>` debe medir el viewBox completo. Un desfase de
  décimas en x/y del rect es normal (redondeo del contorno de Corel).

## 3. Subir a Drive (carpeta "SVG Corte")

- Carga las tools del conector de Google Drive con ToolSearch:
  `select:mcp__836b681d-6968-4263-8cf2-2ce2531b12a6__create_file,mcp__836b681d-6968-4263-8cf2-2ce2531b12a6__search_files`
  (si ese prefijo ya no existe, búscalas por keywords: "drive create_file search_files").
- La carpeta "SVG Corte" tiene id `1FhMAUghuLI7u58hPJbV8ZWk9hJ5JOG4b`. Si create_file
  falla con ese parentId (carpeta movida/borrada), re-búscala con search_files:
  `title = 'SVG Corte' and mimeType = 'application/vnd.google-apps.folder'`.
- Sube con create_file: `title` = nombre del archivo local, `parentId` = id de la carpeta,
  `contentMimeType` = `image/svg+xml`, `disableConversionToGoogleType` = true,
  `textContent` = contenido EXACTO del SVG (léelo del disco; no lo reescribas de memoria).

## 4. Reporte al usuario

Un solo mensaje final con: la medida, la ruta local del SVG y el `viewUrl` que regresa
create_file como link clickeable de Drive.

## Problemas conocidos (no re-descubrirlos)

- **"No coinciden los tipos" al exportar**: `Document.Export` vía COM tardío exige los 5
  argumentos (path, filtro, rango, Nothing, Nothing); no acepta omitir los "opcionales".
  El script ya lo hace así — no lo "simplifiques".
- **"Se ha especificado un ID de filtro no válido"**: el filtro SVG es **1345** en Corel v23
  (los foros viejos dicen 811, que era de versiones anteriores; el script intenta ambos).
  Si algún día cambia la versión de Corel, volcar el enum `cdrFilter` de la typelib
  (`HKCR\CorelDRAW.Application\CurVer` → CLSID → TypeLib → CorelDRAW.tlb) y ajustar.
- **No abre CorelDRAW**: pedir al usuario que lo abra a mano una vez y reintentar. Verificar
  el ProgID con `Test-Path 'Registry::HKEY_CLASSES_ROOT\CorelDRAW.Application'`.
- **Si Corel no exporta de plano**: como último recurso genera tú el SVG (un `<rect>` de
  N cm con `width`/`height` en mm es trivial) para no dejar al usuario sin archivo, y avísale
  claramente que salió de un fallback y no de CorelDRAW.
