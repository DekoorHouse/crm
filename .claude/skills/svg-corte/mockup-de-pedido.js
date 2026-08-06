/**
 * mockup-de-pedido.js — Trae el MOCKUP QUE VIO EL CLIENTE de uno o varios pedidos, para poder
 * cotejarlo antes de cortar. Corre LOCAL (lee Firestore con las credenciales del repo, igual que
 * scripts/svg-corte-worker.js).
 *
 * Uso:  node mockup-de-pedido.js DH14300 [DH14301 ...]
 *       node mockup-de-pedido.js 14300            (el "DH" es opcional)
 *
 * Para cada pedido imprime los datos del pedido y TODOS sus previews, y BAJA la imagen del
 * ULTIMO preview a Documents\SVG-Corte\mockups\<DH>.<ext>, que es la que hay que mirar: por
 * convencion del repo el ultimo elemento de previews[] es el que el cliente aprobo.
 *
 * PARA QUE SIRVE (regla de Chris, 2026-08-06): el corte tiene que quedar COMO SE LE MOSTRO AL
 * CLIENTE. Con nombres largos no se elige a gusto entre reducir la letra o partir a dos renglones:
 * se abre esta imagen, se ve como quedo el nombre y se reproduce igual.
 *
 * OJO con `layout`: cuando el preview trae `layout`, son los renglones que la vision de Gemini LEYO
 * en la imagen. Pero ese verificador esta cableado a la lampara INFINITO (su JSON solo tiene
 * nombreIzquierdo/nombreDerecho/fecha). En una lampara de UN nombre (Spiderman / T-Rex) el nombre
 * cae arbitrariamente en `izquierdo` o en `derecho` y los `ok*` salen en falso sin que nada este mal.
 * Por eso aqui se imprimen los renglones UNIDOS de ambos lados y se ignoran los `ok*`: sirven de
 * pista, pero la fuente de verdad es MIRAR la imagen.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { db } = require('../../../server/config');

const OUT_DIR = path.join(os.homedir(), 'Documents', 'SVG-Corte', 'mockups');

const ms = v => { if (!v) return 0; if (v.toMillis) return v.toMillis(); const t = Date.parse(v); return isNaN(t) ? 0 : t; };
const fecha = v => (ms(v) ? new Date(ms(v)).toLocaleString('es-MX') : '—');
const datosOf = o => (Array.isArray(o.items) ? o.items : []).map(it => it.datosProducto).filter(Boolean).join('\n')
    || o.datosProducto || o.producto || '';

async function buscarPedido(arg) {
    const num = parseInt(String(arg).replace(/^dh/i, '').trim(), 10);
    if (!isNaN(num)) {
        const snap = await db.collection('pedidos').where('consecutiveOrderNumber', '==', num).limit(1).get();
        if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }
    // Si no era un numero de pedido, intentar como ID de documento.
    const doc = await db.collection('pedidos').doc(String(arg)).get();
    if (doc.exists) return { id: doc.id, ...doc.data() };
    return null;
}

async function bajarImagen(url, destSinExt) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} bajando ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tipo = (res.headers.get('content-type') || '').toLowerCase();
    const ext = tipo.includes('webp') ? '.webp' : tipo.includes('png') ? '.png'
        : tipo.includes('jpeg') || tipo.includes('jpg') ? '.jpg' : path.extname(new URL(url).pathname) || '.img';
    const dest = destSinExt + ext;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return dest;
}

(async () => {
    const args = process.argv.slice(2).filter(Boolean);
    if (!args.length) {
        console.log('Uso: node mockup-de-pedido.js DH14300 [DH14301 ...]');
        process.exit(1);
    }

    let fallos = 0;
    for (const arg of args) {
        console.log('\n' + '='.repeat(70));
        const o = await buscarPedido(arg);
        if (!o) {
            console.log(`${arg}: NO ENCONTRE el pedido`);
            fallos++;
            continue;
        }
        const dh = 'DH' + (o.consecutiveOrderNumber || o.id);
        console.log(`${dh}   (doc ${o.id})`);
        console.log(`  estatus:  ${o.estatus || '—'}`);
        console.log(`  cliente:  ${o.nombreCliente || o.contactName || '—'}   tel ${o.telefono || o.contactId || '—'}`);
        console.log(`  datos:    ${datosOf(o).replace(/\n/g, ' | ') || '—'}`);
        console.log(`  pagado:   ${fecha(o.comprobanteValidadoAt)}`);
        if (o.datoCorregidoAt) console.log(`  CORREGIDO: ${fecha(o.datoCorregidoAt)}`);

        const snap = await db.collection('mockup_previews').doc(String(o.id)).get();
        const previews = snap.exists ? (snap.data().previews || []) : [];
        if (!previews.length) {
            console.log('  MOCKUP:   ninguno. Sin mockup no hay con que cotejar -> aplica la REGLA DE ORO (previo primero).');
            fallos++;
            continue;
        }

        previews.forEach((p, i) => {
            const marca = i === previews.length - 1 ? '  <== el que aprobo el cliente' : '';
            console.log(`  preview ${i + 1}/${previews.length}  block=${p.blockId || '—'}  creado=${fecha(p.createdAt)}  enviado=${fecha(p.sentAt)}${marca}`);
            if (p.fields && Object.keys(p.fields).length) {
                const f = Object.entries(p.fields)
                    .filter(([k]) => k !== 'personalizacion')
                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ');
                if (f) console.log(`      fields:  ${f}`);
            }
            if (p.layout) {
                const l = p.layout;
                // Union de ambos lados: en una lampara de UN nombre la vision lo pone en cualquiera.
                const renglones = [...(l.izquierdo || []), ...(l.derecho || [])].filter(Boolean);
                console.log(`      vision:  renglones=${JSON.stringify(renglones)}  fecha=${JSON.stringify(l.fecha || [])}`);
                console.log(`               (izq=${JSON.stringify(l.izquierdo || [])} der=${JSON.stringify(l.derecho || [])}; los ok* de aqui son de la infinito, ignoralos en personaje)`);
            }
        });

        const last = previews[previews.length - 1];
        const url = last.imageUrl || last.url || '';
        if (!url) {
            console.log('  El ultimo preview no tiene imageUrl.');
            fallos++;
            continue;
        }
        if (o.datoCorregidoAt && ms(o.datoCorregidoAt) > ms(last.createdAt)) {
            console.log('  !! MOCKUP OBSOLETO: el pedido se corrigio DESPUES de generar este mockup.');
            console.log('     No lo copies: hay que rehacer el previo con los datos actuales.');
        }
        try {
            const dest = await bajarImagen(url, path.join(OUT_DIR, dh));
            console.log(`  IMAGEN -> ${dest}`);
            console.log(`  url:      ${url}`);
        } catch (e) {
            console.log(`  ERROR bajando la imagen: ${e.message}`);
            console.log(`  url:      ${url}`);
            fallos++;
        }
    }
    console.log('\n' + '='.repeat(70));
    process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR:', e && e.message || e); process.exit(1); });
