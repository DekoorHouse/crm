# Dekoor Editor V2

Editor vectorial nuevo, disponible en `/editor-v2/` desde el servidor Express existente (`npm start`). No requiere compilación ni dependencias nuevas. El editor anterior continúa en `/editor/`.

## Primera etapa

- Documento en milímetros, tamaño de página editable; SVG con dimensiones físicas.
- Rectángulos, elipses y texto Arial. Selección individual, movimiento y redimensionado de figuras; Shift mantiene proporciones al redimensionar.
- Propiedades numéricas, relleno, contorno, duplicación y eliminación.
- Orden de objetos, visibilidad y bloqueo.
- Historial de 100 cambios; cada arrastre es una sola operación. Escape cancela el gesto.
- Zoom y desplazamiento independientes del documento.
- Borrador automático local, descarga/apertura de proyectos `.dekoor` (JSON validado) y exportación SVG.

El borrador pertenece al navegador/origen, no a una cuenta del CRM. No se conecta a pedidos ni servicios privados. No usar este borrador como única copia: descargar el proyecto para conservarlo. Abrir/Nuevo se puede deshacer durante la sesión.

## Estructura

- `model.mjs`: documento, validación, historial y serialización SVG, sin acceso al DOM.
- `app.mjs`: eventos, herramientas, vista SVG, paneles y almacenamiento local.
- `style.css` e `index.html`: interfaz independiente, sin CDN.
- `../../tests/editorV2.test.mjs`: ejecutar desde la raíz con `node --test tests/editorV2.test.mjs`.

## Próximas etapas según el uso solicitado

1. Corte láser: líneas y curvas Bézier, nodos, selección múltiple, grupos, alineación, operaciones booleanas, importar SVG y convertir texto a curvas.
2. Impresión Xerox: imágenes, tamaño final, márgenes/sangrado y PDF; definir modelo de impresora, papel y flujo de color antes de implementar perfiles.
3. Grabado raster: imágenes, escala de grises, contraste, tramado y exportación a DPI configurables; definir el software/controlador láser de destino.

Esta base aún no importa CDR/SVG, no genera PDF ni raster y no convierte texto a curvas. El SVG actual conserva texto editable en Arial y fondo transparente; objetos fuera de página pueden quedar recortados al abrirlo en otros programas. Antes de fabricar hay que validar el SVG en el software de destino, sus unidades y la interpretación de contornos.
