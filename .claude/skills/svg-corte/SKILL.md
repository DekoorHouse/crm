---
name: svg-corte
description: >
  Genera archivos SVG de corte/grabado laser en CorelDRAW y los sube a la carpeta "SVG Corte"
  de Google Drive. Modos: lampara infinito personalizada (dos nombres + fecha por pedido, 1 o 2
  pedidos por hoja de 350x330 mm), lampara de 4 corazones (tabloide), imagen para grabado raster
  (foto del cliente -> Gemini) y lamparas de PERSONAJE con un solo nombre (Spiderman, T-Rex).
  Usar siempre que el usuario pida una lampara/plantilla infinito, una lampara de Spiderman o T-Rex,
  "archivo para laser", poner nombres y fecha a una lampara, convertir una foto en imagen de grabado,
  o dibujar/exportar algo en CorelDRAW y subirlo a Drive — aunque solo diga "hazme la de Juan y Maria
  del 14-Febrero-2026" o "la de Spiderman de Santiago".
---

# svg-corte: archivos de corte laser en CorelDRAW → SVG → Drive

Skill verificada en esta maquina con CorelDRAW 2021 (v23). Convenciones del negocio:
**corte = linea roja, grabado = negro, azul = infinito/corazones/marco** (tercera pasada).
Las hojas de lamparas son de **350x330 mm** con todo alineado **arriba-izquierda**.
**Textos apilados (salto de linea): interlineado = 60% de altura de caracter** (Chris,
2026-07-18; en Corel es Parrafo → interlineado en "% altura caracter").
**NOMBRES: inicial mayuscula SIEMPRE + espacio tras punto** (Chris, 2026-07-24, a raiz de DH13875
"jesús" y DH13913 "L.Angel"): aunque el cliente escriba en minuscula o pegue el texto tras un punto,
cada nombre se graba con inicial mayuscula en cada palabra y con un espacio tras el punto
("jesús"→"Jesús", "L.Angel"→"L. Angel"). La fecha NO se toca. Regla canonica en
`server/mockups/nameLayout.js` (`titleCaseName`), COMPARTIDA por el mockup y el corte
(`server/design/svgAuto.js` la aplica en visión y en el parseo de datos). Red de seguridad en los
`.vbs` (`NormalizarNombre` en `infinito.vbs` y `gen-corazones.vbs`, solo a placeholders de NOMBRE):
aunque una corrida manual pase datos crudos, la pieza sale bien. Idempotente en ambas capas.
Scripts junto a esta skill: `infinito.vbs`, `gen-corazones.vbs`, `gen-grabado.js`,
`upload-drive.js`, plantillas en `plantillas/`.

**REGLA DE SEPARACION (Chris, 2026-07-20, a raiz de DH13598): el texto negro (grabado) NUNCA
debe tocar NINGUNA linea, en especial las AZULES (infinito/corazones/marco) ni la roja de corte.**
Siempre verificar con el PNG al derecho (y hacer zoom a las zonas apretadas) que cada texto tenga
aire alrededor. El punto tipico de choque es la FECHA larga del infinito: su extremo cruza la linea
del infinito que baja al cruce.
**Como se resuelve (Chris 2026-07-20): la fecha queda PEGADA al infinito pero SIN tocarlo, y ARRIBA
de la base** — el diseno va montado en una base que tapa la parte de abajo, asi que la fecha NO debe
bajarse mucho (no debe pasar la LINEA AZUL de la base hacia abajo) o no se vera. El hueco del infinito
se ensancha hacia abajo, asi que basta bajar la fecha UN POQUITO (`DATE_DY=-5` mm) para que su ancho
legible (`MAX_W_FECHA=50` mm) quepa entre las lineas. Ya aplicado en `infinito.vbs` y `gen-corazones.vbs`.
NO sobre-encoger la fecha ni empujarla al ras de la base. Si un nombre/nombre-sobre-corazon queda
pegado a una linea: reducir tamano, mover al area libre, o partir en 2 renglones.

**REGLA DE ORO (Chris, 2026-07-18, a raiz de DH13569): un diseno que el cliente NO ha
aprobado (especiales del Modo 3 y variantes, grabados Modo 4, o cualquier hoja hecha a mano
de un pedido SIN mockup aprobado) NO se sube a Drive ni se le cambia el estatus al pedido.**

**Y ANTES del previo (Chris, 2026-07-18, tras DH13588): NO mandarle imagenes al cliente sin
autorizacion de Chris.** Al terminar el diseno, ensenarle a Chris la captura EN EL CHAT y
esperar su OK explicito; SOLO entonces mandar el previo al cliente.

**Y para esa revision (Chris, 2026-07-18): dejar SIEMPRE el documento abierto en CorelDRAW**
— en corridas manuales de la skill NO usar `/close` ni cerrar el doc por codigo: Chris revisa
(y a veces retoca) la pieza directo en Corel, ademas de ver la captura en el chat. `/close`
queda SOLO para el worker automatico. Si un script ya lo cerro, reabrir el `.cdr` guardado
(`corel.OpenDocument`) antes de reportar. Comando del previo:

    node "C:\Users\chris\Documents\crm\scripts\send-design-approval.js" --dh 13569 --cdr "<ruta.cdr>" --svg "<ruta.svg>"

Eso genera la captura AL DERECHO (client-preview.vbs), la manda por WhatsApp al cliente,
deja el SVG *staged* (`designApproval.stagedSvgLocalPath`, status='pending') y activa el
clasificador: cuando el cliente responda que si, el `svg-corte-worker` sube el SVG a Drive
y cambia el estatus SOLO. Los unicos disenos que se suben directo a Drive son los del
worker Modo 2, porque su mockup ya fue aprobado por el cliente antes de pagar.

## Modo 2: lampara infinito (nombres + fecha)

Producto: lampara con globos de corazon (corte rojo), simbolo infinito con dos nombres
grabados (negro) y fecha abajo. **Lo normal son 2 pedidos por hoja** (cada cliente pide 1
lampara y se juntan 2 en una hoja); solo va 1 cuando ya no hay mas pedidos que disenar.

1. **Datos**: por cada pedido: nombre izquierdo, nombre derecho y fecha (texto libre, se graba
   tal cual: "30-Julio-2025", "Forever", etc.). Si el usuario no dio los datos completos,
   preguntarlos en el chat en un solo mensaje (son texto libre, no usar AskUserQuestion).
   **Nombres a 2 renglones**: pasar el token literal `\n` dentro del valor (ej. "Rosa\nMaría")
   — sale apilado y centrado a 44.8pt con interlineado de 60% altura de caracter (infinito.vbs
   lo aplica solo desde 2026-07-18). La regla de negocio de cuando
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
4. Subir el SVG a Drive y reportar con el link — SOLO si el pedido ya tiene mockup aprobado
   por el cliente (lo normal en Modo 2); si no lo tiene, aplica la REGLA DE ORO (previo primero).

## Modo 3: lampara de 4 corazones ("Plantilla Corazones para Claude")

Diseno mas nuevo de "Lampara de corazones": **4 corazones 3D con malla** (grabado) + simbolo de
infinito con los **2 nombres** y la **fecha**, en hoja **tabloide 279x431 mm (1 pieza)**. La
plantilla vive en `C:\Users\chris\Documents\Corel\Plantilla Corazones para Claude.cdr` (la mantiene
Chris; DEBE conservar sus 3 textos de ejemplo **"Romario" / "Romina" / "13-Agosto-1992"**, que
funcionan como placeholders detectados por CONTENIDO). No confundir con "Plantillas Corazones.cdr"
(doc de produccion intocable).

**Nomenclatura (Chris, 2026-07-18) — la lampara de 4 corazones tiene DOS variantes:**
- **"Plantilla 1"** = corazones/globos en **LINEA (sin malla)** + infinito azul = **la lampara
  INFINITO** (`plantillas/plantilla-infinito-1.cdr`, la MISMA del Modo 2). CONFIRMADO 2026-07-20
  con DH13574-correccion-p1 y DH13498: "plantilla 1" NO necesita extraccion, es la infinito que ya
  tenemos. Se genera con `infinito.vbs` (2 nombres + fecha), o a mano sobre `plantilla-infinito-1.cdr`
  para layouts ESPECIALES (p.ej. DH13498: una persona -> nombre en el aro IZQ, fecha en el aro DER,
  borrando el placeholder FECHA1 central). OJO: el mockup que ve el cliente SIEMPRE sale con malla
  (asi lo genera el generador de mockups), pero si el pedido se corta en Plantilla 1 el fisico va
  en linea (sin malla) — es decision de produccion, no discrepancia.
- **"Plantilla 2"** = la de **MALLA** (corazones 3D grabados en negro) = `Plantilla Corazones
  para Claude.cdr`; es la que usa `gen-corazones.vbs` y todo lo documentado en este Modo 3.
Cuando el usuario diga "plantilla 1" / "plantilla 2", se refiere a esta distincion.

1. **Datos**: nombre izquierdo, nombre derecho, fecha y — opcional — un **texto adicional** (p. ej.
   el campo "Especial" del pedido, tipo "Aniversario No. 27") que va CENTRADO **debajo de la fecha**.
2. Ejecutar:

       cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\gen-corazones.vbs" /file:DHxxxx /mirror /svg /png /save "Nombre1" "Nombre2" "Fecha" ["TextoAdicional"]

   Copia la plantilla, reemplaza los 3 textos por contenido conservando el centro (auto-reduce si el
   nombre pasa de 52 mm o la fecha de 50 mm), crea el texto adicional bajo la fecha (~18 pt),
   convierte a curvas y con **/mirror** aplica la orientacion de produccion (rotar -90 + espejo
   vertical; el grabado va ESPEJEADO porque el laser graba por atras). Flags: `/svg` (SVG laser),
   `/png` (revision), `/save` (.cdr editable al derecho), `/close` (cierra el doc — SOLO para
   automatizacion; en corridas manuales NO pasarlo, Chris revisa en Corel),
   `/extrasize:N` (pt del texto adicional, default 18).
3. Verificar el PNG (diseno EN ESPEJO, nada encimado) y **mandar el previo de aprobacion**
   (REGLA DE ORO de arriba): NO subir a Drive ni tocar el estatus hasta que el cliente apruebe.

Receta por si hay que recolocar a mano: nombre izq. centro **(72.0, 274.2) mm 62.4 pt**; nombre der.
**(152.9, 274.2) 62.4 pt**; fecha **(112.3, 247.4) 23.5 pt**; todo negro, fuente **Rows of Sunflowers**;
diseno centrado en X≈112.3. (Verificado end-to-end con DH13523 el 2026-07-17.)

**REGLA (Chris, 2026-07-17): los nombres que van SOBRE los corazones van SIEMPRE centrados en cada
corazon** (para que se vea lo mas uniforme posible), con silueta blanca para resaltar sobre la malla.

**Variante FAMILIA — 4 nombres (esposa/mama + hijos, SIN pareja)** — p. ej. DH13517 "Carmen, Eder,
Hugo, Angel Gael | 20-Julio-2026": la honoree (esposa/mama) va en el **loop IZQUIERDO** del infinito
y la **fecha en el loop DERECHO** (arriba de los 3 corazoncitos decorativos), NO abajo — un solo
nombre centrado en el infinito choca con el cruce grueso. Los hijos van **uno por corazon, centrados**;
el corazon grande de arriba queda como "corona" (vacio). Centros verificados en la base
`DH13528-4corazones-v2.cdr` (hoja 350x330): loop izq. nombre ~**(39, 214) 65pt**, loop der. fecha
~**(124, 215) 25pt**; corazones — frente-centro ~**(73, 266)**, derecho ~**(120, 267)**, izquierdo
~**(39, 268)**, todos 46pt (nombre de 2 palabras a 2 renglones, p. ej. "Angel"/"Gael", ~40pt), silueta
blanca **2.8 mm**. Se arma copiando `DH13528-4corazones-v2.cdr`, borrando sus textos y poniendo los
nuevos (ver `scratchpad/build-13517.vbs`).

**Variante PAREJA + hijos (2 nombres en el infinito + hijos sobre corazones)** — p. ej. DH13569
"Roberto, Laishaa, Katarhin e Iris | 19-Julio-2024" (papas + 2 hijas). La pareja va NORMAL en los
loops del infinito y la fecha abajo (igual que el Modo 3 estandar), y cada hijo va **centrado en un
corazon** con silueta blanca: 1er hijo en el corazon **FRONTAL-CENTRO**, 2o en el **DERECHO** (como
Gael/Uriel de DH13528; el grande de arriba y el izquierdo quedan vacios). Centros verificados en la
plantilla tabloide (2026-07-18): frontal-centro **(104.4, 327.5) mm**, derecho **(160.5, 334.5) mm**,
ambos **46 pt**. La silueta = el MISMO texto duplicado ATRAS con relleno blanco + contorno blanco de
**2.8 mm** (crear primero la silueta, encima el texto negro). OJO: en la plantilla los 4 corazones son
4 curvas combinadas con el MISMO bbox (x 38.6-188.9, y 297.3-389.8) — no se puede sacar el centro de
cada corazon leyendo shapes; usar estos centros y verificar con PNG al derecho (escala px/mm =
ancho_png / 157.5, origen x=33.6, y=391.6 hacia abajo). Script listo para copiar/adaptar:
`build-13569-pareja-2hijas.vbs` (junto a esta skill; acepta `kx ky ix iy` como args para ajustar
centros y regenera todo: reemplazos, siluetas, curvas, espejo, PNGs de revision y SVG).

## Modo 4: imagen para GRABADO RASTER (foto del cliente -> Gemini)

Cuando el cliente pide **grabar una imagen/foto** (una foto de pareja, mascota, etc.). Convierte la
foto en una imagen lista para **grabado laser raster**: **rellenos blancos, fondo negro, degradado en
trama (halftone) y alto detalle**. Usa **Gemini Nano Banana Pro** (`gemini-3-pro-image-preview`); la
llave vive SOLO en Render, por eso la skill llama al endpoint del servidor, no directo.

    node "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\gen-grabado.js" --img "<foto.jpg | http...>" [--corazon] [--extra "..."] [--out "<ruta.png>"] [--res 1k|2k|4k] [--aspect 1:1|2:3|3:2]

- `--img` foto de entrada (ruta local -> se sube sola, o URL publica).
- `--corazon` cuando el grabado va en el **modelo de corazones**: le manda a la IA la silueta
  `referencias/corazon-forma.png` para que el grabado salga **con forma de corazon** (todo lo de fuera
  del corazon queda negro). Sin la bandera sale en el encuadre normal de la foto.
- `--extra "..."` instrucciones extra al modelo; `--out` ruta del PNG (default `Documents\SVG-Corte\grabado-<stamp>.png`).
- `--res` default `2k` (en Nano Banana Pro 1K y 2K cuestan lo mismo; 2K da mas detalle para grabar).

**Si el modelo se niega**: Gemini puede rechazar fotos que marca como **sensibles** o con **derechos de
autor**. Ya **NO hay modelo de respaldo** — WaveSpeed (GPT Image 2) y Seedream 5 Pro se eliminaron el
2026-07-23 al pasar todo a Gemini. En ese caso el script falla con el texto del rechazo: hay que
recortar/reencuadrar la foto o describir lo que se quiere en `--extra`. **OJO: esto corre contra el
servidor de Render**, así que los cambios de servidor deben estar **desplegados** (push a main).

Flujo interno: sube la(s) imagen(es) a URL publica (`POST /api/mockups/upload-image`) -> `POST
/api/mockups/engrave-submit {imageUrl, shapeImageUrl?}` (arma el prompt de grabado, llama a Gemini y
responde YA con la imagen; ~30-60 s, sin polling) -> baja el resultado y lo guarda como PNG.
Exito = ultima linea `OK <ruta-png>`. El prompt de grabado vive en el servidor
(`server/mockups/mockupsRoutes.js`, `ENGRAVE_PROMPT_BASE` / `ENGRAVE_PROMPT_SHAPE`). El PNG resultante
va DENTRO de la lampara con el pipeline de Corel (como el panda/toronja) y luego a Drive. **Convencion
de color**: si el laser necesita lo contrario (negro sobre blanco), invertir el PNG (sharp `.negate()`).

## Modo 5: lamparas de PERSONAJE (Spiderman / T-Rex) — UN nombre por lampara

Lamparas redondas con la silueta de un personaje grabada y **un solo nombre** (sin fecha).
Plantillas dadas por Chris el 2026-08-06. Hoja de 350x330 con **DOS lamparas** apiladas.

**Como llegan estos pedidos** (verificado en Firestore el 2026-08-06): el producto se llama
`Lámpara infantil <Personaje>` y los datos vienen ya estructurados como
`Nombre: <nombre> | Personaje: <personaje>` (a veces con un `| Especial: ...` al final). **Cada item
del pedido es UNA lampara**, asi que un mismo pedido puede traer varias, incluso de personajes
distintos (por eso importa el "no mezclar modelos" al armar la hoja). Es una linea nueva y con volumen:
317 items en 90 dias, encabezada por T-Rex (69), Spiderman (62), nube (56) y dinosaurio (27), mas una
cola larga de ~70 personajes de una sola pieza (unicornio, Hello Kitty, Sonic, Goku, Stitch, Messi...)
para los que **no hay plantilla** — esos siguen siendo diseno manual. El **28%** de los nombres son
compuestos o de mas de 9 caracteres, que es justo el caso en el que hay que cotejar el mockup.

**Alias de personaje -> plantilla** (Chris, 2026-08-06; verificado contra el mockup de DH14328, que
graba la MISMA silueta de T-Rex):

| Plantilla | Personajes que la usan |
|---|---|
| `rex` | `T-Rex`, `Dinosaurio T-Rex`, `dinosaurio rex`, **`dinosaurio`** |
| `spiderman` | `Spiderman`, `Hombre araña` |

Con esos alias las dos plantillas cubren ~160 de las 317 lamparas (la mitad de la linea). **Ojo con dos
trampas**: `Dino cuello largo` **NO** es T-Rex (es de cuello largo, otra silueta) y `dinosaurio bebé`
esta sin confirmar — preguntar antes de cortarlo con la plantilla de rex.

    cscript //nologo "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\gen-personaje.vbs" /tpl:spiderman|rex [/label:DH14300-DH14301] [/file:base] [/max:NN] [/preview] [/close] "Nombre1" ["Nombre2"]

- **1 nombre** -> media hoja: graba la lampara de arriba y **borra** la de abajo (no deja una pieza en
  blanco cortandose). **2 nombres** -> hoja llena, Nombre1 arriba y Nombre2 abajo.
- **NUNCA mezclar modelos en una hoja** (regla de Chris, 2026-08-06): una hoja es toda de Spiderman o
  toda de T-Rex. Al emparejar pedidos para llenar la hoja, solo se pueden juntar dos del MISMO modelo;
  si no hay con quien emparejar, sale media hoja y ya. Esto aplica tambien a cualquier modelo nuevo que
  se agregue despues.
- `/preview` saca ademas un PNG **al derecho** (legible) para revisar; el SVG del laser no se toca.
- **OJO — lanzarlo desde PowerShell, NO desde Git Bash**: bash convierte `/tpl:spiderman` en ruta y
  el script recibe los argumentos mal (aparece el "Uso:").

**Tres diferencias contra el Modo 2 (infinito) que hay que tener en la cabeza:**

1. **Estas plantillas YA VIENEN en orientacion de produccion** (giradas -90 + espejo vertical: la
   figura sale acostada y el nombre vertical). Por eso `gen-personaje.vbs` **NO rota ni refleja** al
   exportar — si se le copiara el bloque de orientacion de `infinito.vbs` saldrian al reves.
2. Como el texto va **girado 90 grados**, el LARGO del nombre crece en **vertical**: el limite se mide
   sobre `SizeHeight`, no sobre `SizeWidth` (al reves que en la infinito).
3. **Las dos lamparas usan el MISMO placeholder literal `Xxxxx`**, y ademas va **dentro de grupos
   anidados**. No se pueden distinguir por texto: el script los busca recursivamente y los **ordena por
   posicion** (el de arriba es el primero). Tampoco sirve `doc.ActivePage.Shapes` a secas.

**Largo maximo del nombre** (constantes `MAX_LARGO_SPIDERMAN` = 62 mm, `MAX_LARGO_REX` = 72 mm): pasado
ese largo se reduce la letra proporcionalmente. Los topes se midieron con pruebas — en el spiderman
"Santiago" (67 mm) ya rozaba el aro por la izquierda y el brazo del personaje por la derecha; en el rex
"Emiliano" (77 mm) rozaba el aro. Son **distintos por plantilla** porque el hueco libre depende de donde
queda la figura, y el tamano base de letra tambien difiere (spiderman 80.3pt, rex 92.9pt; el script lo
**lee del propio placeholder**, no esta hardcodeado). Con `/max:NN` se ajusta a mano una hoja suelta.

**Nombres a 2 renglones** (`\n`): la letra baja al 68% como en la infinito, pero el **interlineado es
100%, NO el 60% de la infinito**. Con 60 los renglones se enciman: medido con DH14344 ("Dylan/Javier"),
la "y" de Dylan chocaba con la "J" de Javier. En los mockups de personaje los renglones van bien
separados, y el mockup es el que manda (ver abajo).

**EL MOCKUP MANDA** (regla de Chris, 2026-08-06): el corte tiene que quedar **como se le mostro al
cliente**, porque si no el cliente puede reclamar. Con un nombre largo NO se elige libremente entre
"reducir la letra" y "partir a dos renglones": hay que **cotejar el mockup aprobado** y reproducir ese
mismo acomodo. Es la misma regla del Modo 2, solo que aqui es un unico nombre. El auto-reducido a
`MAX_LARGO_*` es la red de seguridad para que nunca se salga del aro, no la decision de diseno.

## Cotejar el mockup antes de cortar (`mockup-de-pedido.js`)

    node "C:\Users\chris\Documents\crm\.claude\skills\svg-corte\mockup-de-pedido.js" DH14300 [DH14301 ...]

Corre LOCAL (lee Firestore con `serviceAccountKey.json`, igual que el worker). Por cada pedido imprime
estatus, datos, y TODOS sus previews, y **baja la imagen del ULTIMO preview** a
`Documents\SVG-Corte\mockups\<DH>.webp` — el ultimo es, por convencion del repo, el que el cliente
aprobo. **Hay que ABRIR esa imagen y mirarla**, no solo confiar en el texto.

Avisa solo cuando el mockup **quedo obsoleto** (`datoCorregidoAt` posterior al `createdAt` del preview):
en ese caso el cliente aprobo otra cosa y hay que rehacer el previo, no copiar ese.

**Gotcha del campo `layout`** (importante en Modo 5): cuando un preview trae `layout`, son los renglones
que la vision de Gemini leyo en la imagen — pero ese verificador (`verifyMockupLayout` en
`server/mockups/mockupsService.js`) esta **cableado a la lampara INFINITO**: su JSON solo tiene
`nombreIzquierdo` / `nombreDerecho` / `fecha`. En una lampara de UN nombre, el nombre cae
**arbitrariamente** en `izquierdo` o en `derecho`, y los `okNombre1` / `okNombre2` / `ok` salen en
**falso sin que nada este mal**. Por eso el script imprime los renglones **unidos de ambos lados** y
hay que **ignorar los `ok*`** en personaje. Sirven de pista; la fuente de verdad es la imagen.

## Automatizacion del Modo 5 (worker, desde 2026-08-07)

El worker corta y sube las lamparas de personaje solo, igual que el infinito. Kill-switch:
`svg_corte_config/settings { personajeAutoCut: false }` (independiente del `autoGenerate` del infinito).

- Elegibilidad: `personajeEligibility` en `server/design/svgAuto.js`. Vive AHI y no en un modulo aparte
  a proposito: `isAutoWaiting` es el predicado con el que el CRM **saca** un pedido de "Pendientes"
  manual (`apiRoutes.js:8424`). Si el worker cortara personaje sin que ese predicado lo supiera, el
  pedido seguiria a la vista del diseñador y saldria cortado DOS veces — el incidente del 2026-07-30.
- El worker usa **`hoja-personaje.js`, no el .vbs pelon**: solo ese driver garantiza que el nombre no
  toque las lineas. Corre con `--close` para no dejar documentos abiertos acumulandose en Corel.
- **Solo entran pedidos donde TODAS sus lamparas son cortables** (`completo`). Si una lleva foto
  grabada o un personaje sin plantilla, el pedido ENTERO se va a manual. Asi nunca queda a medias ni
  hace falta un estado intermedio de "medio diseñado".
- Emparejado: 2 lamparas por hoja **del mismo modelo**; una suelta espera pareja hasta
  `SINGLE_AFTER_HOURS` (12 h) y luego sale en media hoja, igual que el infinito.
- El paso de personaje corre en su propio `try`: si truena, el corte de corazones sigue igual.

**Lo que sigue sin automatizarse**: los personajes sin plantilla (la cola larga: unicornio, Sonic,
Goku...), las lamparas con foto grabada, y `verifyMockupLayout`, que sigue cableado a la infinito (por
eso `renglonesDelMockup` solo se fia de la vision cuando `derecho` viene VACIO — ver Modo 5).
`buildReviewInfo` (`server/apiRoutes.js`) tambien sigue con sus tres filas fijas de infinito.

## Subida a Drive (carpeta "SVG Corte", id `1FhMAUghuLI7u58hPJbV8ZWk9hJ5JOG4b`)

**OJO: subir SOLO disenos ya autorizados por el cliente** (mockup aprobado o previo de
aprobacion contestado) — ver la REGLA DE ORO de arriba. Todo lo que cae en esta carpeta
se considera listo para cortar. El Apps Script solo sube (no puede borrar): si algo se
sube por error, hay que borrarlo A MANO en Drive y avisar al usuario.

**ESTA CARPETA ES LA COLA DE LA LASER, NO UN ARCHIVERO** (aprendido a la mala el 2026-08-07).
El flujo real es: se sube a "SVG Corte" -> alguien lo corta -> mueve el archivo a la subcarpeta
**"Cortadas :)"**. O sea que **todo archivo que se suba se va a cortar**, y lo que ya esta en
"Cortadas :)" YA SE CORTO.

De ahi la regla: **NUNCA resubir una version nueva de algo ya subido.** Subir no reemplaza, SUMA
otra pieza a la cola. Si un diseno hay que rehacerlo, el orden es: (1) avisar, (2) que el usuario
borre el archivo viejo de Drive, (3) recien entonces subir el nuevo. Ese dia se re-subieron hojas
"corregidas" sin borrar las viejas y se cortaron LAS DOS versiones: acrilico tirado.

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
aprobado → hoja de 2 → Corel → Drive → estatus "Diseñado por IA". **También corta los pedidos
que PIDEN VIDEO** (Chris, 2026-07-23): un `Corregir` con `corregirMotivo='video'` es un cliente
que pide video de una lámpara que **nunca se cortó** (lo que vio fue el MOCKUP, la pieza no existe);
se fabrica para poder grabarla. Misma elegibilidad que un `Fabricar` (mockup aprobado + layout
verificado), se sube a Drive igual, pero **conserva su estatus `Corregir`** (solo gana
`svgCorteAt/svgCorteUrl`, `svgCorteBy='svg-worker-video'`) porque el pendiente del video sigue vivo
hasta que el equipo lo grabe y lo mande. Los `Corregir` de **`datos`** NO se cortan (el dato del
mockup está mal → manual). En Pendientes salen con la insignia **"Corte IA en cola"** para que el
diseñador no los corte a mano. Kill-switch propio: `svg_corte_config/settings.videoAutoCut=false`
(independiente de `autoGenerate`). Lógica en `server/design/svgAuto.js` (`isVideoCorregir`,
`isVideoAutoWaiting`). **Fidelidad con el mockup**:
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
- `plantilla-spiderman-2.cdr` / `plantilla-rex-2.cdr` (Modo 5): hoja 350x330 con DOS lamparas
  redondas apiladas, cada una = grupo{ texto `Xxxxx` + grupo{ figura azul + corte rojo } }. Fuente
  "Rows of Sunflowers". Traidas de `Downloads` el 2026-08-06. **Ya vienen orientadas para produccion**
  (ver Modo 5), a diferencia de las de infinito que estan al derecho.
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
- `Outline.SetProperties <ancho>` NO aplica el ancho en v23 (falla silencioso bajo On Error
  y el texto queda SIN silueta): para contornos por codigo usar asignaciones directas —
  `s.Outline.Width = 2.8` (unidades del doc) + `s.Outline.Color.RGBAssign 255,255,255` +
  `s.Outline.LineJoin = 1` (redondeado) — y confirmar con `WScript.Echo s.Outline.Width`.
- Corel reusa la instancia abierta con `CreateObject`; cerrar docs de trabajo sin prompt:
  `doc.Dirty = False : doc.Close`.
- Si Corel no esta abierto y algo falla al conectar: pedir al usuario abrirlo y reintentar.
