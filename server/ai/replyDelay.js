/**
 * replyDelay.js — Cuánto espera la IA antes de contestar un mensaje entrante.
 *
 * Lo comparten WhatsApp y Messenger para que no se separen (antes la regla vivía copiada
 * en los dos handlers y bastaba tocar uno para que se desincronizaran).
 *
 * Reglas:
 *  - 20 s en una conversación normal: le da chance al cliente de mandar su idea en 2-3
 *    mensajes seguidos y que la IA conteste una sola vez, con todo el contexto.
 *  - 10 min cuando la IA YA pidió los datos de envío (contactData.awaitingShippingData):
 *    el cliente los manda en partes (nombre, calle, colonia, CP...) y si contestamos a los
 *    20 s le pedimos lo que "falta" cuando venía en camino.
 *  - De vuelta a 20 s, aunque estemos esperando datos, si el mensaje NO es un dato más:
 *      · pregunta qué falta / dice que ya mandó todo → merece respuesta inmediata;
 *      · trae un problema o pregunta por su envío (rastreo, guía, "no me ha llegado") →
 *        dejarlo 10 min esperando es justo lo peor que podemos hacer ahí.
 */
'use strict';

const DELAY_NORMAL_MS = 20 * 1000;
const DELAY_DATOS_ENVIO_MS = 10 * 60 * 1000;

// "¿qué falta?", "ya te lo mandé", "ya está", "es todo" → contestar rápido.
const PREGUNTA_QUE_FALTA = /(falta|faltan|qu[eé] m[aá]s|qu[eé] datos|cu[aá]l|es todo|eso es todo|ya (?:te )?(?:lo|los|las|le)?\s*(?:di|mand|envi|env[ií]|pas)|ya est|ya qued|list[oa]|complet|algo m[aá]s)/i;

// Problema o duda de envío: no es un dato más, es alguien esperando ayuda.
const URGENTE = /(problem|error|no me deja|no funciona|no puedo|no jala|no sirve|ayuda|urge|queja|reclam|cancel|devol|reembols|equivocad|rastre|gu[ií]a|paqueter|d[oó]nde va|donde va|no (?:me )?ha lleg|todav[ií]a no|a[uú]n no)/i;

/**
 * @param {object} contactData  Documento del contacto (interesa awaitingShippingData).
 * @param {string} incomingText Texto del mensaje que acaba de entrar.
 * @returns {number} milisegundos a esperar antes de disparar la respuesta de la IA.
 */
function aiReplyDelayMs(contactData, incomingText) {
    if (!contactData || !contactData.awaitingShippingData) return DELAY_NORMAL_MS;
    const texto = String(incomingText || '');
    if (PREGUNTA_QUE_FALTA.test(texto) || URGENTE.test(texto)) return DELAY_NORMAL_MS;
    return DELAY_DATOS_ENVIO_MS;
}

module.exports = { aiReplyDelayMs, DELAY_NORMAL_MS, DELAY_DATOS_ENVIO_MS };
