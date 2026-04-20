/**
 * PRECIOS AUTORITATIVOS - Fuente unica de verdad
 *
 * Este archivo es la fuente de precios para:
 *   - Backend: Express + Mercado Pago (require directo)
 *   - Frontend: publico via GET /api/config/prices
 *
 * Cambiar aqui actualiza TODOS los lugares del sitio.
 */
const PRICES = {
    productUnitPrice: 650,        // MXN por lampara (precio de venta)
    productOriginalPrice: 780,    // MXN precio original (tachado, muestra descuento)
    shippingJtCost: 0,            // MXN - J&T Express (gratis)
    shippingDhlCost: 160,         // MXN - DHL Express
    currency: 'MXN',
    maxQty: 50                    // limite anti-abuso
};

module.exports = PRICES;
