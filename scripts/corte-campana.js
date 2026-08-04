/**
 * Corte de una campaña de Meta Ads: CUÁNTO NOS PAGARON de verdad.
 *
 * El estatus del pedido y `metaPurchaseSentAt` mienten (el Purchase solo sale al
 * entrar a "Fabricar", y hay pedidos cobrados que nunca lo mandan). La única
 * fuente confiable es el CHAT: el comprobante que mandó el cliente y lo que
 * Andrea/el operador le contestó al validarlo. Este script lee eso.
 *
 * QUÉ HACE
 *   1. Universo de pedidos = los atribuidos a los anuncios de la campaña
 *      (`attributedAdId`) + los de contactos que traen uno de esos anuncios en su
 *      `adReferral`/`adReferralHistory` aunque el pedido haya quedado atribuido a
 *      otra campaña (se reportan aparte para no inflar el ROAS).
 *   2. Por cada pedido lee la conversación y clasifica el pago:
 *        liquidado  → salió la validación completa (/comprobante) o los montos
 *                     confirmados ya suman el precio.
 *        anticipo   → solo se confirmó un anticipo; se cobra ese monto.
 *        dudoso     → el cliente dice que pagó pero nadie confirmó nada.
 *        sin_pago   → nada.
 *   3. Saca totales, ROAS (si le pasas el gasto) y una lista de PENDIENTES DE
 *      REVISAR (pagados que el CRM no marcó, dudosos, inconsistencias).
 *
 * USO
 *   node scripts/corte-campana.js --ads 52537630733365,52537630606365 \
 *        --nombre "Dinosaurios 2807//" --gasto 9493.89
 *
 *   --ads      IDs de anuncio de la campaña, separados por coma. OBLIGATORIO.
 *              (Se sacan del MCP de Meta: ads_get_ad_entities level=ad
 *               filtrando por ad.campaign_id, o de Ads Manager.)
 *   --nombre   Nombre de la campaña, solo para el encabezado.
 *   --gasto    Gasto de Meta en el periodo, para el ROAS y el costo por pedido.
 *   --desde    YYYY-MM-DD. Por defecto: el día del pedido más viejo atribuido a
 *              esos anuncios (es el arranque real de la campaña).
 *   --hasta    YYYY-MM-DD (exclusivo). Por defecto: ahora.
 *   --json     Guarda el detalle por pedido en ese archivo.
 *   --chat     Imprime las líneas de pago del chat de los pedidos a revisar
 *              (o de los folios que le pases: --chat 14097,14059).
 *
 * Requiere FIREBASE_SERVICE_ACCOUNT_JSON (env) o serviceAccountKey.json local.
 */
require('dotenv').config();
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');

// ===================== argumentos =====================

function arg(nombre, def = null) {
    const i = process.argv.indexOf(nombre);
    if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
    const eq = process.argv.find(a => a.startsWith(nombre + '='));
    if (eq) return eq.slice(nombre.length + 1);
    return process.argv.includes(nombre) ? true : def;
}

const ADS = new Set(String(arg('--ads', '')).split(',').map(s => s.trim()).filter(Boolean));
const NOMBRE = arg('--nombre', 'Campaña');
const GASTO = Number(arg('--gasto', 0)) || 0;
const DESDE = arg('--desde');
const HASTA = arg('--hasta');
const JSON_OUT = arg('--json');
const CHAT = arg('--chat');
const CONCURRENCIA = Number(arg('--concurrencia', 20)) || 20;

if (!ADS.size) {
    console.error('Falta --ads con los IDs de anuncio de la campaña (separados por coma).');
    console.error('Ej: node scripts/corte-campana.js --ads 123,456 --nombre "Dino 2807//" --gasto 9493.89');
    process.exit(1);
}

// ===================== firebase =====================

function cargarCredencial() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw && raw.trim()) {
        try { return JSON.parse(raw); } catch (e) { console.warn('[firebase] env presente pero JSON inválido:', e.message); }
    }
    const local = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
    throw new Error('No hay FIREBASE_SERVICE_ACCOUNT_JSON ni serviceAccountKey.json.');
}
admin.initializeApp({ credential: admin.credential.cert(cargarCredencial()) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ===================== utilidades =====================

const ms = t => !t ? 0 : (typeof t.toMillis === 'function' ? t.toMillis()
    : (typeof t._seconds === 'number' ? t._seconds * 1000 : (typeof t.seconds === 'number' ? t.seconds * 1000 : 0)));
// Todo se imprime en hora del centro (-6), que es como el equipo lee el CRM.
const fecha = t => ms(t) ? new Date(ms(t) - 6 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) : '';
const dinero = n => '$' + Math.round(n).toLocaleString('es-MX');

// ===================== detección de pago en el chat =====================

// La plantilla que manda services.js cuando la IA emite /comprobante (o el
// operador aprieta el botón): significa PAGO COMPLETO, el pedido pasa a Envíos.
const VALIDACION_TOTAL = /(ya validamos tu comprobante de pago|\/datos-estafeta\/|quedamos al pendiente de tus datos de envío en el formulario)/i;
// Confirmaciones libres de Andrea: "ya recibimos tu anticipo de $200",
// "recibimos tu comprobante por los $550 y quedó validado", "ya quedó validado el pago de $400".
// El hueco permite "!" porque el arranque más común es "¡Recibido! Muchísimas gracias por tu
// comprobante"; lo que NO cruza es el punto, para no encadenar dos oraciones distintas.
// Ojo: "recibamos" (subjuntivo, "en cuanto recibamos tu pago") no matchea a propósito.
const CONFIRMA_PAGO = /(recibim[oa]s|recibido|ya qued[óo] (confirmad|validad)|qued[óo] (confirmad|validad)|validam[oa]s)[^.\n]{0,90}(anticipo|comprobante|pago|dep[óo]sito|transferencia|\$)/i;
// Cuando Andrea PIDE el anticipo: sirve para saber el monto si la confirmación no lo trae.
// Exige "de/por/sería de" para no morder "anticipo ya pagados y *$900* restantes".
const PIDE_ANTICIPO = /anticipo (de|por|ser[íi]a de|es de)[^.!\n]{0,20}?\*?\$\s?([\d,]{3,6})/i;
// El cliente afirma haber pagado.
const CLIENTE_PAGO = /(ya (le )?(hice|realic[ée]|deposit|pagu[ée]|transfer)|ya (qued[óo]|est[áa]) (el |su )?(dep[óo]sito|pago)|ya (deposit[éeoó]|pagu[ée]|transfer[íi])|le mand[ée] (el )?comprobante|anexo comprobante|ah[íi] qued[óo] el dep[óo]sito|anticipo pagado)/i;
// Líneas que vale la pena imprimir cuando uno revisa a mano.
const LINEA_PAGO = /(comprobante|validam|valid[óo]|recibim|dep[óo]sit|deposit|transferen|pagu[ée]|anticipo|restante|liquid|oxxo|clave de rastreo|folio|referencia)/i;

// Una confirmación suele traer TRES montos en la misma línea: "…por un total de
// *$1200* ($300 de anticipo ya pagados y *$900* restantes)". Solo uno es lo que
// entró, así que cada $ se juzga por su contexto en vez de agarrar el primero.
// "Total: *$1200* (Anticipo *$300* ya pagado | Restante *$900*)": el total del pedido
// nunca es lo que acaba de entrar, y el restante es lo que debe.
const MONTO_DESCALIFICA = /(restante|resto|falta|liquidar|por pagar|lo pagas|\btotal\b|realizas)/i;
const MONTO_CALIFICA = /(anticipo|comprobante|pago|pagad|dep[óo]sito|abono|recibim|transferencia|validad|confirmad)/i;
// Excepción: "ya recibimos el pago restante de *$550*" sí es dinero que entró.
const RESTO_RECIBIDO = /(recibim[oa]s|recibido|validam[oa]s|validad|confirmad)[^.\n]{0,25}(restante|resto)/i;
const VENTANA = 25; // caracteres de contexto a cada lado del monto

/** Monto cobrado que declara una confirmación ("recibimos tu comprobante por los *$550*" -> 550). */
function montoDePago(texto) {
    const re = /\*?\$\s?([\d][\d,]{1,6})/g;
    const resExplicito = RESTO_RECIBIDO.test(texto);
    const montos = [];
    let m;
    while ((m = re.exec(texto))) montos.push({ ini: m.index, fin: m.index + m[0].length, valor: Number(m[1].replace(/,/g, '')) });

    for (let i = 0; i < montos.length; i++) {
        const { ini, fin, valor } = montos[i];
        if (!(valor >= 50 && valor <= 50000)) continue;
        // El contexto se corta en el monto vecino: en "un total de *$1200* ($300 de
        // anticipo ya pagados y *$900* restantes)", el "total de" es del $1200 y el
        // "restantes" es del $900 — al $300 no le tocan ni uno ni otro.
        const desde = Math.max(i > 0 ? montos[i - 1].fin : 0, ini - VENTANA);
        const hasta = Math.min(montos[i + 1] ? montos[i + 1].ini : texto.length, fin + VENTANA);
        const antes = texto.slice(desde, ini);
        const despues = texto.slice(fin, hasta);
        const descalificado = MONTO_DESCALIFICA.test(antes) || MONTO_DESCALIFICA.test(despues);
        if (descalificado && !resExplicito) continue;
        if (MONTO_CALIFICA.test(antes) || MONTO_CALIFICA.test(despues)) return valor;
    }
    return null;
}

/**
 * Clasifica el pago de UN pedido a partir de los mensajes de su ventana.
 * @param {Array<{t:number, cli:boolean, texto:string, media:boolean}>} msgs
 * @param {number} precio
 */
function clasificarPago(msgs, precio) {
    const confirmaciones = [];   // {t, monto}
    let validacionTotal = null;  // ts de la plantilla de pago completo
    let ultimoAnticipoPedido = null;
    let clienteDicePago = false;
    let mediaDelCliente = 0;

    for (const m of msgs) {
        if (m.cli) {
            if (m.media) mediaDelCliente++;
            if (CLIENTE_PAGO.test(m.texto)) clienteDicePago = true;
            continue;
        }
        if (VALIDACION_TOTAL.test(m.texto)) { if (!validacionTotal) validacionTotal = m.t; continue; }
        if (CONFIRMA_PAGO.test(m.texto)) {
            // El monto puede venir en la confirmación; si no, es el anticipo que
            // se acababa de pedir ("¡Recibido! Muchísimas gracias por tu comprobante").
            const monto = montoDePago(m.texto) || ultimoAnticipoPedido;
            if (monto) confirmaciones.push({ t: m.t, monto });
            continue; // la confirmación no re-define el anticipo pedido
        }
        const pide = PIDE_ANTICIPO.exec(m.texto);
        if (pide) ultimoAnticipoPedido = Number(pide[2].replace(/,/g, ''));
    }

    // Andrea re-confirma el mismo anticipo varias veces (el comprobante sigue en
    // su ventana de contexto), así que los montos IGUALES cuentan una sola vez.
    const montosDistintos = [...new Set(confirmaciones.map(c => c.monto))];
    const sumaConfirmada = montosDistintos.reduce((s, n) => s + n, 0);
    const repetidas = confirmaciones.length > montosDistintos.length;

    if (validacionTotal) {
        return { estado: 'liquidado', cobrado: precio, validadoAt: validacionTotal, montosDistintos, repetidas, clienteDicePago, mediaDelCliente };
    }
    if (sumaConfirmada >= precio && sumaConfirmada > 0) {
        return { estado: 'liquidado', cobrado: precio, validadoAt: confirmaciones[confirmaciones.length - 1].t, montosDistintos, repetidas, clienteDicePago, mediaDelCliente };
    }
    if (sumaConfirmada > 0) {
        return { estado: 'anticipo', cobrado: sumaConfirmada, validadoAt: confirmaciones[0].t, montosDistintos, repetidas, clienteDicePago, mediaDelCliente };
    }
    if (clienteDicePago) {
        return { estado: 'dudoso', cobrado: 0, validadoAt: null, montosDistintos, repetidas, clienteDicePago, mediaDelCliente };
    }
    return { estado: 'sin_pago', cobrado: 0, validadoAt: null, montosDistintos, repetidas, clienteDicePago, mediaDelCliente };
}

// ===================== armado del universo =====================

/** Los pedidos atribuidos directo a los anuncios de la campaña (`in` acepta 30 valores). */
async function pedidosAtribuidos() {
    const ids = [...ADS];
    const docs = [];
    for (let i = 0; i < ids.length; i += 30) {
        const snap = await db.collection('pedidos').where('attributedAdId', 'in', ids.slice(i, i + 30)).get();
        docs.push(...snap.docs);
    }
    return docs.map(d => ({ id: d.id, ...d.data(), _via: 'anuncio' }));
}

/**
 * Pedidos del mismo rango cuyo CONTACTO trae un anuncio de la campaña en su
 * historial, aunque el pedido haya quedado atribuido a otra cosa ("o que lo
 * tienen en uno de sus anuncios").
 */
async function pedidosPorHistorial(desde, hasta, yaTengo) {
    let q = db.collection('pedidos').where('createdAt', '>=', desde);
    if (hasta) q = q.where('createdAt', '<', hasta);
    const snap = await q.get();
    const candidatos = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => !yaTengo.has(p.id) && (p.contactId || p.telefono));

    const limite = pLimit(CONCURRENCIA);
    const extra = [];
    await Promise.all(candidatos.map(p => limite(async () => {
        const doc = await db.collection('contacts_whatsapp').doc(String(p.contactId || p.telefono)).get();
        if (!doc.exists) return;
        const c = doc.data();
        const primero = c.adReferral && c.adReferral.source_id ? String(c.adReferral.source_id) : null;
        const historial = Array.isArray(c.adReferralHistory) ? c.adReferralHistory.map(h => String(h && h.source_id)) : [];
        if ((primero && ADS.has(primero)) || historial.some(h => ADS.has(h))) {
            extra.push({ ...p, _via: primero && ADS.has(primero) ? 'contacto (1er anuncio)' : 'contacto (historial)' });
        }
    })));
    return { extra, revisados: candidatos.length };
}

// ===================== main =====================

(async () => {
    console.log(`\n=== CORTE DE CAMPAÑA: ${NOMBRE} ===`);
    console.log(`Anuncios: ${[...ADS].join(', ')}\n`);

    const atribuidos = await pedidosAtribuidos();
    if (!atribuidos.length) {
        console.log('No hay ningún pedido atribuido a esos anuncios. ¿Los IDs son correctos?');
        process.exit(0);
    }
    const minMs = Math.min(...atribuidos.map(p => ms(p.createdAt)).filter(Boolean));
    const desde = DESDE ? new Date(`${DESDE}T00:00:00-06:00`) : new Date(minMs);
    const hasta = HASTA ? new Date(`${HASTA}T00:00:00-06:00`) : null;

    const enRango = atribuidos.filter(p => {
        const t = ms(p.createdAt);
        return t >= desde.getTime() && (!hasta || t < hasta.getTime());
    });
    const { extra, revisados } = await pedidosPorHistorial(desde, hasta, new Set(enRango.map(p => p.id)));
    const universo = [...enRango, ...extra];

    console.log(`Rango: ${fecha({ _seconds: desde.getTime() / 1000 })} → ${hasta ? fecha({ _seconds: hasta.getTime() / 1000 }) : 'hoy'}`);
    if (!DESDE) console.log('  (arranque tomado del primer pedido atribuido; si la campaña empezó antes, pásale --desde YYYY-MM-DD)');
    console.log(`Pedidos: ${universo.length}  (${enRango.length} atribuidos al anuncio + ${extra.length} por historial del contacto, de ${revisados} revisados)\n`);

    // --- leer las conversaciones ---
    const porContacto = new Map();
    for (const p of universo) {
        const cid = String(p.contactId || p.telefono || '');
        if (!cid) { p._sinContacto = true; continue; }
        if (!porContacto.has(cid)) porContacto.set(cid, []);
        porContacto.get(cid).push(p);
    }

    const limite = pLimit(CONCURRENCIA);
    await Promise.all([...porContacto.entries()].map(([cid, pedidos]) => limite(async () => {
        const snap = await db.collection('contacts_whatsapp').doc(cid).collection('messages').orderBy('timestamp', 'asc').get();
        const msgs = snap.docs.map(d => {
            const m = d.data();
            return {
                t: ms(m.timestamp),
                cli: m.from === cid,
                texto: String(m.text || '').replace(/\s+/g, ' '),
                media: !!m.fileUrl
            };
        }).filter(m => m.t);

        // Un contacto puede traer varios pedidos: se parte la conversación por
        // fecha de creación para no acreditarle a uno el pago del otro.
        pedidos.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
        pedidos.forEach((p, i) => {
            const ini = pedidos.length > 1 && i > 0 ? ms(p.createdAt) : 0;
            const fin = pedidos[i + 1] ? ms(pedidos[i + 1].createdAt) : Infinity;
            const ventana = msgs.filter(m => m.t >= ini && m.t < fin);
            p._pago = clasificarPago(ventana, Number(p.precio) || 0);
            p._variosPedidos = pedidos.length > 1;
            p._chat = ventana.filter(m => LINEA_PAGO.test(m.texto) || (m.cli && m.media))
                .map(m => `  ${fecha({ _seconds: m.t / 1000 })} ${m.cli ? '<<CLI' : 'BOT>>'} ${m.media ? '[media] ' : ''}${m.texto.slice(0, 165)}`);
        });
    })));

    // --- cuadre ---
    const filas = universo.map(p => {
        const pago = p._pago || { estado: 'sin_chat', cobrado: 0, montosDistintos: [] };
        const precio = Number(p.precio) || 0;
        const revisar = [];
        if (pago.estado === 'liquidado' && !p.comprobanteValidadoAt) revisar.push('PAGADO pero el CRM no lo marcó (no entra a Envíos)');
        if (pago.estado !== 'liquidado' && p.comprobanteValidadoAt) revisar.push('el CRM lo da por pagado pero el chat no lo confirma');
        if (pago.estado === 'dudoso') revisar.push('dice que pagó y nadie lo confirmó — checar en el banco');
        if (p._variosPedidos) revisar.push('el contacto tiene varios pedidos en el corte');
        if (p._sinContacto) revisar.push('pedido sin contacto: no se pudo leer el chat');
        // Andrea re-confirma el mismo anticipo mientras el comprobante siga en su ventana de
        // contexto, así que repetir 2 veces es lo normal: solo es raro a partir de la tercera.
        const notas = pago.repetidas ? ['el mismo monto se confirmó varias veces (normal si el comprobante siguió en contexto)'] : [];
        return {
            folio: p.consecutiveOrderNumber || null,
            contactId: String(p.contactId || p.telefono || ''),
            estatus: p.estatus || 'Sin estatus',
            producto: p.producto || '',
            precio,
            estado: pago.estado,
            cobrado: pago.cobrado,
            porCobrar: /cancel/i.test(p.estatus || '') ? 0 : precio - pago.cobrado,
            montos: pago.montosDistintos,
            via: p._via,
            createdAt: fecha(p.createdAt),
            pagoAt: pago.validadoAt ? fecha({ _seconds: pago.validadoAt / 1000 }) : '',
            comprobanteValidadoAt: fecha(p.comprobanteValidadoAt),
            revisar,
            notas,
            _chat: p._chat || []
        };
    }).sort((a, b) => (a.folio || 0) - (b.folio || 0));

    const liq = filas.filter(f => f.estado === 'liquidado');
    const ant = filas.filter(f => f.estado === 'anticipo');
    const dud = filas.filter(f => f.estado === 'dudoso');
    const canc = filas.filter(f => /cancel/i.test(f.estatus));
    const suma = arr => arr.reduce((s, f) => s + f.cobrado, 0);
    const cobrado = suma(liq) + suma(ant);
    const cobradoAnuncio = suma(liq.filter(f => f.via === 'anuncio')) + suma(ant.filter(f => f.via === 'anuncio'));
    const porCobrar = filas.reduce((s, f) => s + f.porCobrar, 0);
    const pagadores = liq.length + ant.length;

    console.log(`LIQUIDADOS (pago completo confirmado en el chat): ${String(liq.length).padStart(3)} pedidos → ${dinero(suma(liq))}`);
    console.log(`ANTICIPOS cobrados (pedido a medias):             ${String(ant.length).padStart(3)} pedidos → ${dinero(suma(ant))}`);
    console.log('─'.repeat(66));
    console.log(`COBRADO CONFIRMADO:                              ${String(pagadores).padStart(3)} pedidos → ${dinero(cobrado)}`);
    if (extra.length) console.log(`  · atribuido estrictamente a la campaña: ${dinero(cobradoAnuncio)} (el resto viene de contactos que también vieron otras campañas)`);
    if (dud.length) console.log(`DUDOSOS (dicen que pagaron, sin confirmar):      ${String(dud.length).padStart(3)} pedidos → hasta ${dinero(dud.reduce((s, f) => s + f.precio, 0))} por verificar`);
    console.log(`POR COBRAR (pedidos vivos sin liquidar):                     ${dinero(porCobrar)}`);
    const listaFolios = (arr, max = 12) => arr.slice(0, max).map(c => 'DH' + c.folio).join(', ') + (arr.length > max ? `, +${arr.length - max} más` : '');
    console.log(`Cancelados: ${canc.length}${canc.length ? ' (' + listaFolios(canc) + ')' : ''}`);
    console.log(`Tasa de pago: ${pagadores}/${filas.length} = ${Math.round(pagadores / filas.length * 100)}%  ·  liquidados ${Math.round(liq.length / filas.length * 100)}%`);

    if (GASTO > 0) {
        console.log(`\nGasto en Meta: ${dinero(GASTO)}`);
        console.log(`ROAS cobrado: ${(cobrado / GASTO).toFixed(2)}x${extra.length ? `  ·  solo atribuido: ${(cobradoAnuncio / GASTO).toFixed(2)}x` : ''}`);
        if (pagadores) console.log(`Costo por pedido pagado: ${dinero(GASTO / pagadores)}  ·  por liquidado: ${dinero(GASTO / (liq.length || 1))}`);
        console.log(`ROAS si se cobrara todo lo pendiente: ${((cobrado + porCobrar) / GASTO).toFixed(2)}x`);
    }

    if (ant.length) {
        console.log('\n--- ANTICIPOS: falta liquidar ---');
        ant.forEach(f => console.log(`  DH${f.folio}  pagó ${dinero(f.cobrado)} de ${dinero(f.precio)} → falta ${dinero(f.porCobrar)}  [${f.estatus}]`));
    }

    const aRevisar = filas.filter(f => f.revisar.length);
    if (aRevisar.length) {
        console.log('\n--- PENDIENTES DE REVISAR A MANO ---');
        aRevisar.forEach(f => console.log(`  DH${f.folio} (${f.estatus}, ${dinero(f.precio)}, ${f.contactId}): ${f.revisar.join(' | ')}`));
    }

    const cobrables = filas.filter(f => f.estado === 'sin_pago' && !/cancel/i.test(f.estatus));
    if (cobrables.length) {
        console.log(`\n--- SIN UN PESO (${cobrables.length} pedidos = ${dinero(cobrables.reduce((s, f) => s + f.precio, 0))}) ---`);
        console.log('  ' + cobrables.map(f => `DH${f.folio}(${f.precio})`).join(' '));
    }

    // --- chat de los casos a revisar (o de los folios pedidos) ---
    if (CHAT) {
        const folios = CHAT === true
            ? aRevisar.concat(dud).map(f => f.folio)
            : String(CHAT).split(',').map(s => Number(s.trim().replace(/\D/g, '')));
        console.log('\n' + '='.repeat(100));
        for (const folio of [...new Set(folios)]) {
            const f = filas.find(x => x.folio === folio);
            if (!f) { console.log(`\n### DH${folio}: no está en el corte`); continue; }
            console.log(`\n### DH${f.folio} | ${f.estatus} | ${dinero(f.precio)} | ${f.producto} | ${f.estado}${f.montos.length ? ' ' + f.montos.map(dinero).join('+') : ''} | ${f.contactId}`);
            console.log(f._chat.length ? f._chat.slice(-30).join('\n') : '  (sin líneas de pago en el chat)');
        }
    }

    if (JSON_OUT) {
        const salida = filas.map(({ _chat, ...f }) => f);
        fs.writeFileSync(JSON_OUT, JSON.stringify({
            campana: NOMBRE, ads: [...ADS], gasto: GASTO,
            desde: desde.toISOString(), hasta: hasta ? hasta.toISOString() : null,
            resumen: {
                pedidos: filas.length, liquidados: liq.length, anticipos: ant.length, dudosos: dud.length,
                cobrado, cobradoAtribuido: cobradoAnuncio, porCobrar
            },
            pedidos: salida
        }, null, 2));
        console.log(`\n→ detalle en ${JSON_OUT}`);
    }

    process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
