// =====================================================================================
// === Proveedor OPENAI para el chat de Andrea (alternativa a Gemini) ==================
// =====================================================================================
// Por qué existe: el 30-jul-2026 Google bloqueó la cuenta de Gemini por facturación y
// Andrea dejó de contestar a los clientes durante horas. Este módulo permite que el chat
// corra en OpenAI, de modo que un problema con Google ya no tumbe la atención al cliente.
//
// Traduce el formato de Gemini (el que ya usa services.js) al de OpenAI, para NO tener que
// reescribir todo el armado de la conversación:
//
//   Gemini                                    OpenAI
//   ------------------------------------      -------------------------------------------
//   systemInstruction {parts:[{text}]}   ->   messages[0] {role:'system', content}
//   role 'model'                         ->   role 'assistant'
//   parts [{text}]                       ->   content [{type:'text', text}]
//   parts [{inlineData:{mimeType,data}}] ->   content [{type:'image_url', image_url:{url:'data:...'}}]
//
// Devuelve la MISMA forma que generateGeminiResponse ({text, inputTokens, outputTokens,
// cachedTokens}) para que el llamador no note la diferencia.
//
// Contrato verificado contra la API real (30-jul-2026):
//  · reasoning_effort:'minimal' -> 2.1s y 0 tokens de razonamiento. Sin él, gpt-5-mini
//    razona por defecto: 8.7s y ~320 tokens desperdiciados por respuesta. Para un chat de
//    ventas la latencia importa más que el razonamiento profundo.
//  · Visión OK: leyó monto/beneficiario/fecha de un comprobante de transferencia.
//  · El caché de OpenAI es AUTOMÁTICO por prefijo (no hay que crear ni borrar cachés como
//    en Gemini); llega en usage.prompt_tokens_details.cached_tokens.
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Modelo y esfuerzo de razonamiento configurables por entorno (sin re-deploy).
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini';
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'minimal';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) || 60000;

/**
 * Convierte un part multimedia de Gemini al bloque equivalente de OpenAI.
 * Soportado (verificado contra la API real): IMAGEN y PDF — los dos formatos en que llegan
 * los comprobantes de pago. El PDF va como content type 'file' con file_data en base64.
 * OJO: gpt-5-mini NO acepta audio ni video (Gemini sí). Esos se descartan y se avisa por
 * texto, igual que hace skippedMediaNote con lo que no cabe.
 */
function inlineDataToOpenAIPart(part) {
    const inline = part && (part.inlineData || part.inline_data);
    if (!inline || !inline.data) return null;
    const mime = String(inline.mimeType || inline.mime_type || '').toLowerCase();
    if (mime.startsWith('image/')) {
        return { type: 'image_url', image_url: { url: `data:${mime};base64,${inline.data}` } };
    }
    if (mime.includes('pdf')) {
        // Comprobantes de pago en PDF: probado, lee monto/beneficiario/fecha correctamente.
        return {
            type: 'file',
            file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${inline.data}` },
        };
    }
    return null; // audio y video: no soportados por el modelo de chat
}

/** Describe lo que se tuvo que descartar, para decírselo al modelo en vez de callarlo. */
function describeDropped(parts) {
    const tipos = new Set();
    for (const p of parts) {
        const inline = p && (p.inlineData || p.inline_data);
        if (!inline) continue;
        const mime = String(inline.mimeType || inline.mime_type || '').toLowerCase();
        if (mime.startsWith('image/') || mime.includes('pdf')) continue; // sí se mandan
        if (mime.startsWith('audio/')) tipos.add('una nota de voz');
        else if (mime.startsWith('video/')) tipos.add('un video');
        else tipos.add('un archivo');
    }
    return tipos.size ? [...tipos].join(' y ') : null;
}

/**
 * Convierte los `contents` de Gemini a `messages` de OpenAI.
 * systemText va como primer mensaje con rol system.
 */
function toOpenAIMessages(contents, systemText) {
    const messages = [];
    if (systemText && String(systemText).trim()) {
        messages.push({ role: 'system', content: String(systemText) });
    }
    for (const turn of contents || []) {
        if (!turn || !Array.isArray(turn.parts)) continue;
        const role = turn.role === 'model' ? 'assistant' : 'user';
        const textos = turn.parts.filter(p => p && typeof p.text === 'string').map(p => p.text);
        const imagenes = turn.parts.map(inlineDataToOpenAIPart).filter(Boolean);
        const dropped = describeDropped(turn.parts);

        // Los turnos del ASISTENTE solo admiten texto plano en la API de OpenAI.
        if (role === 'assistant') {
            const t = textos.join('\n').trim();
            if (t) messages.push({ role, content: t });
            continue;
        }
        let t = textos.join('\n');
        if (dropped) {
            // No mentir por omisión: el modelo debe saber que llegó algo que no puede ver.
            t += `\n(El cliente mandó ${dropped} que no puedo revisar aquí. Si es importante, pídele que lo describa por escrito.)`;
        }
        const content = [];
        if (t.trim()) content.push({ type: 'text', text: t.trim() });
        content.push(...imagenes);
        if (content.length) messages.push({ role, content });
    }
    // La API exige al menos un mensaje que no sea system.
    if (!messages.some(m => m.role !== 'system')) {
        messages.push({ role: 'user', content: '(inicio de la conversación)' });
    }
    return messages;
}

/**
 * Genera la respuesta del chat con OpenAI. Misma firma y misma forma de retorno que
 * generateGeminiResponse(promptOrContents, mediaParts, systemInstruction) para que el
 * switch de proveedor sea transparente en services.js.
 */
async function generateOpenAIResponse(promptOrContents, mediaParts = [], systemInstruction = null) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY para el chat con OpenAI.');

    // Acepta string (prompt plano) o array de turnos, igual que la ruta de Gemini.
    const contents = Array.isArray(promptOrContents)
        ? promptOrContents.map(t => ({ ...t, parts: [...(t.parts || [])] }))
        : [{ role: 'user', parts: [{ text: String(promptOrContents || '') }] }];

    // La multimedia se anexa al ÚLTIMO turno del usuario (mismo criterio que buildGeminiContents).
    if (mediaParts && mediaParts.length) {
        let last = contents[contents.length - 1];
        if (!last || last.role === 'model') {
            last = { role: 'user', parts: [] };
            contents.push(last);
        }
        last.parts = [...last.parts, ...mediaParts];
    }

    const payload = {
        model: OPENAI_CHAT_MODEL,
        reasoning_effort: OPENAI_REASONING_EFFORT,
        messages: toOpenAIMessages(contents, systemInstruction),
    };

    let data;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetch(OPENAI_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
            });
            data = await res.json().catch(() => null);
            if (!res.ok) {
                const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
                // 429/5xx son transitorios: vale la pena un reintento.
                if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
                    console.warn(`[OPENAI] ${msg}; reintentando...`);
                    await new Promise(r => setTimeout(r, 900));
                    continue;
                }
                throw new Error(`La API de OpenAI respondió: ${msg}`);
            }
            break;
        } catch (e) {
            const retriable = /timeout|aborted|fetch failed|network|econnreset|terminated/i.test(String(e && e.message));
            if (attempt < 2 && retriable) {
                console.warn(`[OPENAI] Falló (${e.message}), reintentando...`);
                await new Promise(r => setTimeout(r, 900));
                continue;
            }
            throw e;
        }
    }

    const choice = data && data.choices && data.choices[0];
    const text = choice && choice.message && typeof choice.message.content === 'string'
        ? choice.message.content.trim()
        : '';
    if (!text) {
        const motivo = choice && choice.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : '';
        throw new Error(`No se recibió una respuesta válida de OpenAI${motivo}.`);
    }
    const usage = (data && data.usage) || {};
    const cached = (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0;
    return {
        text,
        // Se reporta igual que Gemini: inputTokens INCLUYE los cacheados (promptTokenCount).
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        cachedTokens: cached,
    };
}

// --- Transcripción de notas de voz --------------------------------------------------------
// El modelo de CHAT (gpt-5-mini) no acepta audio, pero OpenAI tiene endpoint dedicado y es
// mejor para esto. Probado con español de México: capturó nombres propios ("María Fernanda",
// "Jonathan"), la fecha y hasta normalizó "setecientos cincuenta" -> "750".
// gpt-4o-mini-transcribe: ~1.7s y más barato que whisper-1.
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

/**
 * Transcribe un audio con OpenAI. Devuelve { text, inputTokens, outputTokens, cachedTokens }
 * para encajar con logAiUsage igual que la ruta de Gemini (el endpoint no reporta tokens,
 * van en cero; el costo del audio se factura por minuto, no por token).
 */
async function transcribeAudioOpenAI(buffer, mimeType = 'audio/ogg') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY para transcribir.');
    if (!buffer || !buffer.length) return { text: '', inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

    // El nombre de archivo importa: la API deduce el formato de la extensión.
    const mime = String(mimeType || 'audio/ogg').toLowerCase();
    const ext = mime.includes('mp3') || mime.includes('mpeg') ? 'mp3'
        : mime.includes('wav') ? 'wav'
        : mime.includes('m4a') || mime.includes('mp4') ? 'm4a'
        : mime.includes('webm') ? 'webm' : 'ogg';

    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type: mime }), `nota.${ext}`);
    fd.append('model', OPENAI_TRANSCRIBE_MODEL);
    fd.append('language', 'es'); // fijar el idioma mejora nombres propios en español
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Transcripción con OpenAI falló: HTTP ${res.status} ${t.slice(0, 160)}`);
    }
    const d = await res.json().catch(() => null);
    return { text: String((d && d.text) || '').trim(), inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
}

module.exports = {
    generateOpenAIResponse,
    toOpenAIMessages,
    transcribeAudioOpenAI,
    OPENAI_CHAT_MODEL,
    OPENAI_TRANSCRIBE_MODEL,
};
