// =================================================================
// === Construcción de payloads de PLANTILLAS de WhatsApp (HSM) =====
// =================================================================
// buildAdvancedTemplatePayload vivía dentro de apiRoutes.js; se movió aquí para que
// otros módulos (p. ej. el servicio de cobranza automática) puedan armar envíos de
// plantilla sin depender del router. La lógica es EXACTAMENTE la misma.
const { db } = require('./config');

async function buildAdvancedTemplatePayload(contactId, templateObject, imageUrl = null, bodyParams = []) {
    console.log('[DIAGNÓSTICO] Objeto de plantilla recibido:', JSON.stringify(templateObject, null, 2));
    const contactDoc = await db.collection('contacts_whatsapp').doc(contactId).get();
    // Usa el nombre del contacto si existe, si no 'Cliente'
    const contactName = contactDoc.exists ? contactDoc.data().name : 'Cliente';

    // Extraer datos relevantes de la plantilla
    const { name: templateName, components: templateComponents, language } = templateObject;

    const payloadComponents = []; // Array para los componentes del payload final
    let messageToSaveText = `📄 Plantilla: ${templateName}`; // Texto por defecto para guardar en DB

    // --- Procesar Cabecera (HEADER) ---
    // Nota: el parametro se llama `imageUrl` por historia pero acepta cualquier media URL
    // (imagen/video/documento). Lo usamos como `mediaUrl` segun el formato del HEADER.
    const headerDef = templateComponents?.find(c => c.type === 'HEADER');
    const mediaUrl = imageUrl;
    if (headerDef?.format === 'IMAGE') {
        if (!mediaUrl) throw new Error(`La plantilla '${templateName}' requiere una imagen.`);
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: mediaUrl } }]
        });
        messageToSaveText = `🖼️ Plantilla con imagen: ${templateName}`;
    }
    else if (headerDef?.format === 'VIDEO') {
        if (!mediaUrl) throw new Error(`La plantilla '${templateName}' requiere un video.`);
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'video', video: { link: mediaUrl } }]
        });
        messageToSaveText = `🎬 Plantilla con video: ${templateName}`;
    }
    else if (headerDef?.format === 'DOCUMENT') {
        if (!mediaUrl) throw new Error(`La plantilla '${templateName}' requiere un documento.`);
        const filename = (typeof mediaUrl === 'string' && mediaUrl.split('/').pop().split('?')[0]) || 'documento.pdf';
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'document', document: { link: mediaUrl, filename } }]
        });
        messageToSaveText = `📄 Plantilla con documento: ${templateName}`;
    }
    // Si la cabecera es texto y espera una variable ({{1}}), usar el nombre del contacto
    if (headerDef?.format === 'TEXT' && headerDef.text?.includes('{{1}}')) {
        payloadComponents.push({
            type: 'header',
            parameters: [{ type: 'text', text: contactName }]
        });
    }

    // --- Procesar Cuerpo (BODY) ---
    // Meta soporta dos estilos de variables (mutuamente excluyentes por plantilla):
    //   - Numeradas:  {{1}}, {{2}}, ...
    //   - Con nombre: {{customer_name}}, {{discount}}, ...
    // El payload tiene formato distinto: las nombradas requieren `parameter_name`.
    const bodyDef = templateComponents?.find(c => c.type === 'BODY');
    if (bodyDef) {
        const bodyText = bodyDef.text || '';

        // Detectar variables con nombre (primero, son mas especificas que las numeradas)
        const namedRe = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
        const namedMatches = [];
        let nm;
        while ((nm = namedRe.exec(bodyText)) !== null) {
            if (!namedMatches.includes(nm[1])) namedMatches.push(nm[1]);
        }

        // Detectar variables numeradas
        const numRe = /\{\{(\d+)\}\}/g;
        const varNumbers = new Set();
        while ((nm = numRe.exec(bodyText)) !== null) varNumbers.add(Number(nm[1]));
        const maxVar = varNumbers.size ? Math.max(...varNumbers) : 0;

        // Heuristica: nombres que tipicamente representan el nombre del contacto
        const NAME_PARAM_RE = /^(customer_name|nombre|nombre_cliente|client_name|first_name|name)$/i;

        if (namedMatches.length > 0) {
            // ---- Variables con nombre ----
            const examplesByName = {};
            (bodyDef.example?.body_text_named_params || []).forEach(p => {
                examplesByName[p.param_name] = p.example;
            });
            const parameters = namedMatches.map((name, idx) => {
                let value;
                if (NAME_PARAM_RE.test(name)) {
                    value = contactName;
                } else if (bodyParams[idx] !== undefined && bodyParams[idx] !== null) {
                    value = bodyParams[idx];
                } else if (examplesByName[name] !== undefined && examplesByName[name] !== null) {
                    value = examplesByName[name];
                } else {
                    value = '';
                }
                return { type: 'text', parameter_name: name, text: String(value) };
            });
            payloadComponents.push({ type: 'body', parameters });

            // Reconstruir texto para DB
            let tempText = bodyText;
            parameters.forEach(p => {
                tempText = tempText.replace(new RegExp(`\\{\\{${p.parameter_name}\\}\\}`, 'g'), p.text);
            });
            messageToSaveText = tempText;

        } else if (maxVar > 0) {
            // ---- Variables numeradas ----
            const exampleValues = (bodyDef.example?.body_text?.[0]) || [];
            const allParams = [];
            for (let i = 0; i < maxVar; i++) {
                if (i === 0) {
                    allParams.push(contactName);
                } else if (bodyParams[i - 1] !== undefined && bodyParams[i - 1] !== null) {
                    allParams.push(bodyParams[i - 1]);
                } else if (exampleValues[i] !== undefined && exampleValues[i] !== null) {
                    allParams.push(exampleValues[i]);
                } else {
                    allParams.push('');
                }
            }
            const parameters = allParams.map(p => ({ type: 'text', text: String(p) }));
            payloadComponents.push({ type: 'body', parameters });

            let tempText = bodyText;
            parameters.forEach((param, index) => {
                tempText = tempText.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
            });
            messageToSaveText = tempText;

        } else {
            // Sin variables
            payloadComponents.push({ type: 'body', parameters: [] });
            messageToSaveText = bodyText || messageToSaveText;
        }
    }

    // --- Procesar Botones (BUTTONS) ---
    const buttonsDef = templateComponents?.find(c => c.type === 'BUTTONS');
    buttonsDef?.buttons?.forEach((button, index) => {
        // Si el botón es de tipo URL y espera una variable ({{1}}), usar el contactId
        if (button.type === 'URL' && button.url?.includes('{{1}}')) {
            payloadComponents.push({
                type: 'button',
                sub_type: 'url',
                index: index.toString(), // El índice debe ser string
                parameters: [{ type: 'text', text: contactId }] // Usar el ID del contacto
            });
        }
        // Nota: Los botones de respuesta rápida (quick_reply) no necesitan parámetros aquí.
    });

    // Construir el payload final
    const payload = {
        messaging_product: 'whatsapp',
        to: contactId,
        type: 'template',
        template: {
            name: templateName,
            language: { code: language }
            // components se añade solo si hay alguno
        }
    };
    if (payloadComponents.length > 0) {
        payload.template.components = payloadComponents;
    }

    console.log(`[DIAGNÓSTICO] Payload final construido para ${contactId}:`, JSON.stringify(payload, null, 2));
    // Devolver el payload y el texto representativo
    return { payload, messageToSaveText };
}

module.exports = { buildAdvancedTemplatePayload };
