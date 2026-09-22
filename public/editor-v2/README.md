# Dekoor Editor V2

Editor vectorial nuevo, disponible en `/editor-v2/` desde el servidor Express existente (`npm start`). No requiere compilación ni dependencias nuevas. El editor anterior continúa en `/editor/`.

## Primera etapa

- Documento interno en milímetros, selector de milímetros/pulgadas para mostrar y editar medidas. Cambiar unidades o el tamaño de página conserva el zoom y la vista; SVG con dimensiones físicas.
- Rectángulos, elipses, texto Arial e imágenes PNG/JPEG/WebP pegadas con Ctrl+V (hasta 10 MB por imagen; conserva los píxeles originales).
- Spline cúbica interpolada: clic para cada punto, Enter/doble clic para terminar, Escape para cancelar y Retroceso para quitar el último punto. Máximo 500 puntos. Se guarda como puntos normalizados y se exporta como curvas Bézier SVG; permite mover, redimensionar y cambiar contorno. Doble clic en una spline edita sus nodos: arrastrarlos los mueve (con ajuste a otras figuras), Shift o un área seleccionan varios, las flechas los desplazan 1 mm (Shift: 10 mm), doble clic en la curva añade un nodo y doble clic en un nodo o Supr lo elimina (mínimo dos). Esc o clic en una zona vacía termina la edición. Con tres puntos o más, un clic en el primero cierra la curva: la unión queda suave, toma el relleno elegido y se exporta como trazo cerrado (`Z`); al editar sus nodos conserva al menos tres.
- Selección individual o por área de objetos completamente contenidos; movimiento, duplicación, eliminación y contorno en conjunto. Los ocultos/bloqueados no se seleccionan por área. Ocho controles exteriores de tamaño para una figura: esquinas proporcionales y laterales en un solo eje. Con varios objetos, un recuadro punteado rodea los que se pueden escalar y sus ocho controles los escalan juntos, conservando su distribución; el texto no se deforma: cambia de tamaño con las esquinas y con los laterales solo se reubica. Arrastrar desde las referencias geométricas mueve el objeto sin escalarlo.
- Referencias visuales al pasar el mouse: centro, nodos, puntos medios y borde; no aplican ajuste magnético. Ctrl+Inicio lleva al frente y Ctrl+Fin al fondo conservando el orden relativo de la selección.
- Propiedades numéricas, relleno, contorno, duplicación y eliminación.
- Orden de objetos, visibilidad y bloqueo.
- Historial de 100 cambios; cada arrastre es una sola operación. Escape cancela el gesto.
- Zoom y desplazamiento independientes del documento.
- Borrador automático local, descarga/apertura de proyectos `.dekoor` (JSON validado) y exportación SVG.
- Paleta RGB horizontal: clic izquierdo cambia el relleno y clic derecho cambia el contorno. Sin color elimina el relleno o el contorno según el botón utilizado. Si el contorno tenía grosor cero, se activa con Muy fina (0.0762 mm). Propiedades de ancho y alto.
- Guardado y carga manual en Firebase con la cuenta del CRM, más guardar como copia. Colección `editor_v2_projects`, compartida entre usuarios autenticados conforme a las reglas existentes. No mezcla formatos con `editor_files` del editor anterior.

El borrador pertenece al navegador/origen. «Guardar proyecto» (Ctrl+S) guarda en Firebase; «Abrir» (Ctrl+O) muestra los últimos 100 proyectos. La ventana incluye descarga e importación local. Los cambios no se envían automáticamente a Firebase: el indicador diferencia el proyecto guardado de los cambios pendientes. Abrir/Nuevo se puede deshacer durante la sesión.

Al guardar un proyecto «Sin título» se pide un nombre antes de continuar. Firestore almacena JSON validado (hasta 850 KB) con metadatos, fecha del servidor y revisión. Las imágenes se suben a Firebase Storage en `editor-v2/images/{uid}/{hash}` y se recuperan como datos embebidos al abrir, para incluirlas en descargas y SVG. Las transacciones rechazan sobrescrituras si otra sesión modificó el documento; en ese caso se puede abrir la versión actual o guardar como copia. Las lecturas de la lista/proyecto requieren conexión al servidor. Se usan las reglas existentes de Firestore/Storage. El SDK se carga al abrir Firebase; el editor local puede funcionar sin ese servicio. No se convierten archivos del editor anterior.

## Estructura

- `model.mjs`: documento, validación, historial y serialización SVG, sin acceso al DOM.
- `app.mjs`: eventos, herramientas, vista SVG, paneles y almacenamiento local.
- `geometry.mjs`: ocho controles y geometría de redimensionado, sin DOM.
- `spline.mjs`: segmentos cúbicos, evaluación de curvas y límites exactos.
- `cloud.mjs`: autenticación Firebase, consultas y guardado con control de revisión.
- `style.css` e `index.html`: interfaz independiente, sin CDN.
- `../../tests/editorV2.test.mjs`: ejecutar desde la raíz con `node --test tests/editorV2.test.mjs`.
- `../../tests/editorV2Geometry.test.mjs`: invariantes de proporción y anclaje de los ocho controles.

## Próximas etapas según el uso solicitado

1. Corte láser: líneas y curvas Bézier, nodos, selección múltiple, grupos, alineación, operaciones booleanas, importar SVG y convertir texto a curvas.
2. Impresión Xerox: imágenes, tamaño final, márgenes/sangrado y PDF; definir modelo de impresora, papel y flujo de color antes de implementar perfiles.
3. Grabado raster: imágenes, escala de grises, contraste, tramado y exportación a DPI configurables; definir el software/controlador láser de destino.

Esta base aún no importa CDR/SVG, no genera PDF ni archivos raster y no convierte texto a curvas. El SVG actual conserva texto editable en Arial y fondo transparente; objetos fuera de página pueden quedar recortados al abrirlo en otros programas. Antes de fabricar hay que validar el SVG en el software de destino, sus unidades y la interpretación de contornos.

Exportación: el botón Exportar y Ctrl+E abren el selector SVG/PDF. PDF conserva el tamaño físico y orientación de la página, las figuras vectoriales y las imágenes; omite objetos ocultos y controles del editor. Texto editable con Helvetica (sustitución de Arial). PDF RGB, sin conversión CMYK ni perfil PDF/X. Las dependencias locales se cargan al elegir PDF; ver vendor/README.md.

PowerClip: clic derecho en rectángulo/elipse → Convertir en PowerClip vacío. Para añadir contenido, clic derecho sobre los objetos → Colocar dentro de PowerClip y clic en el contenedor. Conserva la posición original; usa la barra flotante Extraer / Ajustar dentro / Rellenar para acomodarlo. Los ajustes centran el contenido y mantienen su proporción respecto de sus límites rectangulares; el contenedor recorta el sobrante. Se conserva en proyectos, Firebase, SVG y PDF. Esta etapa no admite contenedores anidados.

Grosor: los objetos nuevos usan Muy fina (0.0762 mm). Al seleccionar aparece el menú de grosores; los valores personalizados siguen disponibles en Propiedades. Zoom máximo: 10 000%. Los PowerClip muestran una marca PC solo en el editor. Al arrastrar contenido sobre un contenedor válido se resalta y muestra el aviso de inserción; soltar lo incorpora en un único paso deshacible. Si el PowerClip ya tiene contenido, hay que mantener W al soltar; sin W solo se marca con línea punteada y el aviso «Mantén W…», y el objeto se mueve normalmente.

Ajustes de imagen: al seleccionar una imagen, Propiedades muestra Desaturar (0 a 100), Contraste y Brillo (−100 a +100) y Nitidez (0 a 100). Se guardan como parámetros junto a la imagen original, así que se pueden cambiar o restablecer en cualquier momento; al soltar un control se guarda un paso que se puede deshacer. El editor muestra los píxeles procesados (`imageAdjust.mjs`) y la exportación SVG/PDF incrusta la imagen ajustada a resolución completa, en su formato original.