# DeKoor · Plan Día del Padre 2026

WebApp para capturar y controlar la campaña de Día del Padre 2026 (1–21 jun). Migración del Excel
`Dekoor_Plan_DiaDelPadre_2026.xlsx` a una app que se usa desde celular o computadora, con guardado
automático y todas las fórmulas del Excel calculadas en vivo.

## Cómo abrirla

- **En línea (recomendado):** entra a **https://crm-rzon.onrender.com/dia-padre/** e inicia sesión con
  tu cuenta del CRM (mismo correo y contraseña). Funciona en celular y desktop.
- **Instalar como app (PWA):** en el celular abre la URL en Chrome/Safari → menú → **"Agregar a
  pantalla de inicio"**. Quedará con ícono propio y se abre a pantalla completa. En desktop (Chrome/Edge)
  aparece el ícono de instalar ⊕ en la barra de direcciones.
- **Offline:** una vez que entraste con internet, la app abre sin conexión (los datos viven en el
  dispositivo). El **primer** inicio de sesión sí requiere internet.

## Las 6 pestañas

| Pestaña | Qué hace |
|---|---|
| **Resumen** | Dashboard: piezas (700), préstamo, utilidad esperada y resumen financiero Plan vs Real. |
| **Ventas** | Piezas y margen por canal (DGO, J&T, Pronto, DHL) + estructura de costos por pieza. |
| **Ads Semana 1** | Inversión diaria 1–7 jun (plan vs real) y pedidos esperados según CPL objetivo. |
| **Capital** | Estructura de capital, préstamo/intereses y resultado esperado. **Aquí se edita el préstamo, la tasa y la nómina.** |
| **Calendario** | 27 hitos del 29 may al 27 jun, con responsable y checkbox de completado. |
| **Métricas** | Captura diaria (21 días): CPL y Conversión WA se calculan y colorean con semáforo. |

Las celdas **amarillas** se editan; las **grises** se calculan solas. Cada cambio se guarda al instante
(verás "✓ Guardado" abajo a la derecha).

## Semáforos automáticos

- **CPL:** 🟢 menor a $180 · 🟡 $180–$250 · 🔴 mayor a $250
- **Conversión WA:** 🟢 mayor a 12% · 🟡 8–12% · 🔴 menor a 8%

## Gasto de Meta Ads por campaña (automático)

En la pestaña **Métricas**, arriba, está la card **"Gasto de Meta Ads por campaña"**:

- Elige un rango de fechas y pulsa **"🔄 Traer de Meta"**.
- Trae el gasto **directo de tu administrador de anuncios** (las mismas cuentas Meta que usa `admon`;
  el token y las cuentas se resuelven en el servidor — el navegador no maneja secretos).
- Muestra una tabla **Campaña | Gasto** (con nombre real de cada campaña) + total.
- **Auto-llena la columna "Gasto ads" diaria** de la tabla de métricas, emparejando por fecha real, y
  recalcula el CPL. Los días sin gasto en Meta quedan intactos; puedes seguir editando a mano.
- El último resultado se guarda (entra en Export/Import/Reset).

La tabla de métricas va del **29 may al 21 jun** (incluye días de prueba desde hoy). Para validar con
datos actuales, deja "Desde" en una fecha de mayo. Técnicamente llama a
`GET /api/meta-ads/campaign-spend` (servidor del CRM), que reutiliza el mismo servicio Meta de `admon`.

## Respaldo y traslado entre dispositivos

> ⚠️ **Importante:** los datos se guardan en **cada dispositivo por separado** (no se sincronizan
> automáticamente entre tu celular y tu computadora). Para pasarlos de uno a otro usa Exportar/Importar.

- **⭳ Exportar:** descarga un archivo `plan-dia-padre-AAAA-MM-DD.json` con todo lo capturado (respáldalo
  seguido, sobre todo durante la campaña).
- **⭱ Importar:** carga un `.json` exportado antes (sirve para pasar datos del celular a la compu, o
  restaurar un respaldo). Reemplaza los datos actuales.
- **↺ Reiniciar:** borra todo y vuelve a los valores iniciales del plan (pide confirmación). Exporta
  antes si quieres respaldo.

El archivo `plan-padre.json` incluido es un export de ejemplo con los valores iniciales del Excel.

## Notas de cálculo (fieles al Excel)

- La **utilidad** aparece con dos cifras, ambas del Excel: **$123,572** en Resumen (base margen) y
  **$124,700** en Capital (base costos con envío promedio $95).
- **Pronto COD** usa margen efectivo **$224**/pieza (ya considerando rechazos COD), aunque su margen
  unitario teórico calculado sea $260.

## Detalles técnicos

- HTML + CSS + JavaScript vanilla, un solo `index.html` (+ `manifest.json` y `sw.js` para la PWA).
- Persistencia en `localStorage`, una clave por sección: `dekoor_dp2026_global`, `dekoor_dp2026_ventas`,
  `dekoor_dp2026_ads`, `dekoor_dp2026_capital`, `dekoor_dp2026_calendario`, `dekoor_dp2026_metricas`.
- Acceso protegido con el login Firebase del CRM (proyecto `pedidos-con-gemini`).
- Se sirve desde `public/dia-padre/` y se despliega solo a Render junto con el resto del CRM.

## Mejoras futuras (no incluidas en v1)

- **Sincronización entre dispositivos** con Firestore (colección `dekoor_planes/dia_padre_2026`): la capa
  de guardado ya está aislada en `saveSection/loadSection` para enchufarla sin reescribir.
- **Gráficas** Plan vs Real con Chart.js.
- **Exportar a PDF** (ya hay estilos de impresión; por ahora funciona con Ctrl/Cmd + P → Guardar como PDF).
