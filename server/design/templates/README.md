# Plantillas del motor SVG

Las seis variantes (infinito, Spiderman y T-Rex; una o dos piezas) conservan la geometría de las plantillas Corel del taller en `.claude/skills/svg-corte/plantillas`.

`*-natural.svg` sirve para medir separación y mostrar una vista legible; `*-cut.svg` conserva las líneas originales en orientación de producción. El servidor dibuja los textos con la fuente incluida en el repositorio, los convierte a curvas y les aplica la matriz calibrada de `manifest.json`: giro y reflexión para grabar por detrás. Página de 350 × 330 mm, corte rojo, figura azul y texto negro. No usa fuentes del sistema, Corel, COM ni comandos de Windows.

`layout.tsv` y `line-spacing.tsv` registran los centros, tamaños e interlineado medidos en Corel. El interlineado de infinito es 60% y el de personajes 100%. La huella de la fuente se verifica en los tests. Para regenerar estos datos de referencia solamente, se usa `scripts/design-comparison/export-server-templates.vbs` en una máquina con Corel y después `build-server-manifest.js`. La producción no ejecuta esos scripts.

Las pruebas comparan los SVG finales con exportaciones reales aprobadas de Corel y rechazan texto sin la orientación final. Los nombres que no caben con separación suficiente se envían a revisión; no se fuerzan dentro del contorno.
