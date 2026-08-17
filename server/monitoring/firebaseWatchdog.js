/**
 * Watchdog de Firebase: avisa por WhatsApp en minutos cuando Firestore deja de responder.
 *
 * POR QUÉ EXISTE
 * El 16-ago-2026 se suspendió la cuenta de facturación, Firestore se quedó sin cuota y el CRM
 * estuvo ~7 horas sin poder guardar mensajes. Lo caro no fue la caída: fue que nadie se enteró.
 * Con el webhook contestando 500 (ver debeReintentar en whatsappHandler.js), Meta reintenta los
 * mensajes un buen rato, así que enterarse EN MINUTOS hace que todo se recupere solo. Enterarse
 * en horas te deja al filo de esa ventana.
 *
 * CÓMO FUNCIONA
 * Cada 2 minutos escribe y relee un documento propio (_watchdog/heartbeat). Se prueban las dos
 * operaciones a propósito: en la caída de agosto lo que se agotó fueron las LECTURAS, pero una
 * cuota de escrituras agotada es igual de fatal y no se vería sondeando solo lecturas.
 *
 * Tras 2 fallas seguidas (~4 min) manda un WhatsApp, lo repite cada 30 min mientras siga caído y
 * avisa cuando se restablece, con la duración de la caída.
 *
 * El envío va por alertaWhatsApp.js, que NO toca Firestore: es lo que está caído.
 *
 * Variables de entorno:
 *  - ALERTA_OPS_PHONE            (default '5216183322226'; compartida con el detector)
 *  - FIREBASE_WATCHDOG_TEMPLATE  (opcional; plantilla aprobada de Meta con 2 variables:
 *                                 {{1}} hora, {{2}} detalle. Sin ella el aviso depende de que
 *                                 la ventana de 24 h esté abierta)
 *  - FIREBASE_WATCHDOG_CRON      (default cada 2 min)
 *  - FIREBASE_WATCHDOG_ENABLED   ('false' lo apaga)
 */
const cron = require('node-cron');
const { db, admin } = require('../config');
const { enviarAlertaWhatsApp, TELEFONO_ALERTAS } = require('./alertaWhatsApp');

const ALERT_TEMPLATE = process.env.FIREBASE_WATCHDOG_TEMPLATE || '';
const ENABLED = String(process.env.FIREBASE_WATCHDOG_ENABLED || 'true').toLowerCase() !== 'false';
// Un cron inválido en la env tira cron.schedule (y con él el proceso) durante el arranque.
const RAW_CRON = process.env.FIREBASE_WATCHDOG_CRON || '*/2 * * * *';
const CRON_SCHEDULE = cron.validate(RAW_CRON) ? RAW_CRON : '*/2 * * * *';
if (CRON_SCHEDULE !== RAW_CRON) {
    console.warn(`[WATCHDOG] FIREBASE_WATCHDOG_CRON inválido ("${RAW_CRON}"); usando "*/2 * * * *"`);
}

// 2 fallas seguidas antes de avisar: un timeout suelto no despierta a nadie de madrugada,
// pero 2 seguidas (~4 min) ya son una caída real.
const FALLOS_PARA_ALERTAR = 2;
const RECORDATORIO_MS = 30 * 60 * 1000;
// El sondeo tiene que rendirse solo: gRPC puede quedarse colgado sin devolver error, y un
// chequeo colgado es un watchdog que ya nunca vuelve a avisar de nada.
const SONDEO_TIMEOUT_MS = 20 * 1000;
const TIMEZONE = 'America/Mexico_City';
// Colección propia y aparte: nada del CRM la escucha, así que el latido no despierta listeners
// del front ni le cuesta lecturas a los clientes conectados.
const HEARTBEAT = { coleccion: '_watchdog', doc: 'heartbeat' };

let scheduledTask = null;
let chequeoEnCurso = false;
// Estado en memoria a propósito: persistirlo requeriría Firestore, que es justo lo que puede
// estar caído. Un reinicio de Render puede repetir una alerta; es barato comparado con no avisar.
const estado = {
    fallosSeguidos: 0,
    caidoDesde: null,        // ms del primer fallo de la racha
    alertaEnviadaAt: null,   // ms en que se logró avisar (null = falta avisar / ya se recuperó)
    ultimoRecordatorioAt: null,
    ultimoError: null,
    ultimoChequeoOkAt: null
};

function conTimeout(promesa, ms, etiqueta) {
    let temporizador;
    const limite = new Promise((_, reject) => {
        temporizador = setTimeout(() => reject(new Error(`${etiqueta}: sin respuesta en ${ms} ms`)), ms);
    });
    return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

/** Escribe y relee el latido. Si algo truena, lanza: eso es "Firestore no responde". */
async function sondearFirestore() {
    const ref = db.collection(HEARTBEAT.coleccion).doc(HEARTBEAT.doc);
    await conTimeout(
        ref.set({ at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
        SONDEO_TIMEOUT_MS,
        'escritura'
    );
    const snap = await conTimeout(ref.get(), SONDEO_TIMEOUT_MS, 'lectura');
    if (!snap.exists) throw new Error('El latido se escribió pero no se pudo leer de vuelta');
}

// --- TEXTOS ---

function horaMx(ms) {
    return new Date(ms).toLocaleString('es-MX', { timeZone: TIMEZONE, hour12: true });
}

function duracionLegible(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${min % 60} min`;
}

function textoDeCaida({ desdeMs, error, esRecordatorio }) {
    const encabezado = esRecordatorio
        ? `🚨 *Firebase SIGUE caído* (${duracionLegible(Date.now() - desdeMs)})`
        : '🚨 *Firebase no responde*';
    return [
        encabezado,
        '',
        `*Desde:* ${horaMx(desdeMs)}`,
        `*Error:* ${error}`,
        '',
        'Los mensajes que lleguen NO se están guardando, pero el webhook le contesta 500 a Meta y Meta los reintenta: si esto se arregla pronto, entran solos.',
        '',
        'Qué revisar, en orden:',
        '1. Facturación del proyecto (tarjeta rechazada = proyecto suspendido)',
        '2. https://status.firebase.google.com',
        '3. Cuotas de Firestore en la consola de Firebase'
    ].join('\n');
}

function textoDeRestablecido({ desdeMs }) {
    return [
        '✅ *Firebase se restableció*',
        '',
        `*Duración de la caída:* ${duracionLegible(Date.now() - desdeMs)}`,
        `*Desde:* ${horaMx(desdeMs)}`,
        `*Hasta:* ${horaMx(Date.now())}`,
        '',
        'Meta va reentregando los mensajes de ese rato. Revisa los chats por si alguno quedó sin respuesta.'
    ].join('\n');
}

const alerta = (texto, params) => enviarAlertaWhatsApp({ texto, params, plantilla: ALERT_TEMPLATE });

// --- CICLO ---

/**
 * Un chequeo. `forzarAlerta` recorre el camino completo del aviso sin tener que tumbar nada.
 * Nunca lanza: un watchdog que revienta el proceso sería peor que no tenerlo.
 */
async function runChequeoWatchdog({ forzarAlerta = false } = {}) {
    if (chequeoEnCurso) return { saltado: 'chequeo_en_curso' };
    chequeoEnCurso = true;
    try {
        let fallo = null;
        try {
            await sondearFirestore();
        } catch (err) {
            fallo = err;
        }
        if (forzarAlerta && !fallo) fallo = new Error('PRUEBA FORZADA: Firestore respondió bien, esto es un simulacro');

        // --- Firestore responde ---
        if (!fallo) {
            estado.ultimoChequeoOkAt = Date.now();
            estado.fallosSeguidos = 0;
            estado.ultimoError = null;
            const desdeMs = estado.caidoDesde;
            const huboCaidaAvisada = Boolean(desdeMs && estado.alertaEnviadaAt);
            estado.caidoDesde = null;
            estado.alertaEnviadaAt = null;
            estado.ultimoRecordatorioAt = null;
            // Solo se avisa la recuperación si se avisó la caída: si nunca supiste que se cayó,
            // un "ya se restableció" a secas no se entiende.
            if (huboCaidaAvisada) {
                const duracionMs = Date.now() - desdeMs;
                try {
                    const r = await alerta(
                        textoDeRestablecido({ desdeMs }),
                        [horaMx(Date.now()), `Firebase se restableció tras ${duracionLegible(duracionMs)}`]
                    );
                    console.log(`[WATCHDOG] ✅ Restablecido tras ${duracionLegible(duracionMs)}. Aviso enviado a ${r.telefono} vía ${r.via}.`);
                } catch (e) {
                    console.error('[WATCHDOG] Firestore volvió pero no se pudo avisar:', e.message);
                }
                return { estado: 'restablecido', duracionMs };
            }
            return { estado: 'ok' };
        }

        // --- Firestore no responde ---
        estado.fallosSeguidos++;
        estado.ultimoError = fallo.message;
        if (!estado.caidoDesde) estado.caidoDesde = Date.now();
        console.error(`[WATCHDOG] Sondeo fallido #${estado.fallosSeguidos} (${fallo.code || 'sin código'}): ${fallo.message}`);

        const ahora = Date.now();
        const detalle = `${fallo.code ? `[${fallo.code}] ` : ''}${fallo.message}`;
        // Reintentar el AVISO en cada tick mientras no se haya logrado: la primera alerta se manda
        // justo cuando la red o la API de Meta también pueden estar teniendo un mal rato.
        const tocaPrimeraAlerta = !estado.alertaEnviadaAt && estado.fallosSeguidos >= FALLOS_PARA_ALERTAR;
        const tocaRecordatorio = Boolean(estado.alertaEnviadaAt) &&
            (ahora - (estado.ultimoRecordatorioAt || estado.alertaEnviadaAt)) >= RECORDATORIO_MS;

        if (tocaPrimeraAlerta || tocaRecordatorio) {
            try {
                const r = await alerta(
                    textoDeCaida({ desdeMs: estado.caidoDesde, error: detalle, esRecordatorio: tocaRecordatorio }),
                    [horaMx(estado.caidoDesde), `Firebase no responde: ${detalle}`.slice(0, 500)]
                );
                if (tocaRecordatorio) estado.ultimoRecordatorioAt = ahora;
                else estado.alertaEnviadaAt = ahora;
                console.error(`[WATCHDOG] 🚨 Alerta${tocaRecordatorio ? ' (recordatorio)' : ''} enviada a ${r.telefono} vía ${r.via}.`);
            } catch (e) {
                console.error(`[WATCHDOG] ⚠️ NO SE PUDO AVISAR de la caída (se reintenta en el próximo chequeo): ${e.message}`);
            }
        }
        return { estado: 'caido', fallosSeguidos: estado.fallosSeguidos, error: detalle };
    } catch (inesperado) {
        console.error('[WATCHDOG] Error inesperado en el chequeo:', inesperado.message);
        return { estado: 'error_interno', error: inesperado.message };
    } finally {
        chequeoEnCurso = false;
    }
}

/** Manda un mensaje de prueba y devuelve por dónde salió (lo usa scripts/watchdog-test.js). */
async function enviarAlertaDePrueba() {
    const texto = [
        '🔔 *Prueba del watchdog de Firebase*',
        '',
        `Hora: ${horaMx(Date.now())}`,
        '',
        'Si estás leyendo esto, la alerta de caída de Firebase SÍ te va a llegar. ✅'
    ].join('\n');
    const r = await alerta(texto, [horaMx(Date.now()), 'Prueba del watchdog: la alerta llega bien']);
    return { ...r, plantillaConfigurada: ALERT_TEMPLATE || null };
}

function estadoWatchdog() {
    return {
        activo: Boolean(scheduledTask),
        cron: CRON_SCHEDULE,
        telefono: TELEFONO_ALERTAS,
        plantilla: ALERT_TEMPLATE || null,
        ...estado
    };
}

function startFirebaseWatchdog() {
    if (!ENABLED) {
        console.log('[WATCHDOG] Deshabilitado por FIREBASE_WATCHDOG_ENABLED=false');
        return;
    }
    if (scheduledTask) {
        console.log('[WATCHDOG] Scheduler ya iniciado');
        return;
    }
    if (!process.env.WHATSAPP_TOKEN || !process.env.PHONE_NUMBER_ID) {
        console.warn('[WATCHDOG] Sin WHATSAPP_TOKEN/PHONE_NUMBER_ID: el watchdog vigilará pero NO podrá avisar.');
    }
    console.log(`[WATCHDOG] Iniciado. Cron: "${CRON_SCHEDULE}". Avisa a ${TELEFONO_ALERTAS} tras ${FALLOS_PARA_ALERTAR} fallas seguidas${ALERT_TEMPLATE ? ` (plantilla "${ALERT_TEMPLATE}")` : ' (texto libre; sujeto a la ventana de 24 h)'}.`);
    scheduledTask = cron.schedule(CRON_SCHEDULE, () => {
        runChequeoWatchdog().catch(e => console.error('[WATCHDOG] Error en chequeo:', e.message));
    }, { timezone: TIMEZONE });
}

module.exports = {
    startFirebaseWatchdog,
    runChequeoWatchdog,
    enviarAlertaDePrueba,
    estadoWatchdog
};
