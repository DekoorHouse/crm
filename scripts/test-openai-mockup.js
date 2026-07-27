/**
 * Prueba de generación de MOCKUPS con la API de OpenAI (ChatGPT / gpt-image-1).
 *
 * Genera la imagen y la guarda en un archivo LOCAL: no toca pedidos, no manda nada
 * al cliente y no sube nada a la galería. Sirve para comparar contra Gemini antes de
 * cambiar nada en producción.
 *
 * Uso:
 *   # 1) Ver qué plantillas hay
 *   node scripts/test-openai-mockup.js --list
 *
 *   # 2) Probar una plantilla con datos de ejemplo
 *   node scripts/test-openai-mockup.js --template "Infinito Corazones 2" --n1 Juan --n2 Maria --fecha "14 Febrero 2026"
 *
 *   # 3) Lo mismo pero con Gemini, para comparar lado a lado
 *   node scripts/test-openai-mockup.js --template "Infinito Corazones 2" --n1 Juan --n2 Maria --fecha "14 Febrero 2026" --gemini
 *
 *   # 4) Imagen y prompt sueltos (sin plantilla)
 *   node scripts/test-openai-mockup.js --base https://... --prompt "Cambia el texto por..." --ref ./diseno.png
 *
 * Opciones:
 *   --template <id|nombre>  Plantilla de Firestore (mockup_templates). Toma su imagen base y su prompt.
 *   --base <url|archivo>    Imagen base a editar (si no usas --template).
 *   --ref  <url|archivo>    2ª referencia opcional (el diseño a grabar).
 *   --prompt "..."          Prompt a mano (sustituye al de la plantilla).
 *   --n1 --n2 --fecha       Valores de los placeholders {nombre1} {nombre2} {fecha}.
 *   --quality low|medium|high   Calidad de OpenAI (default: high). Baja = más barato.
 *   --gemini                Usa el motor actual de producción en vez de OpenAI.
 *   --out <archivo>         Dónde guardar el PNG (default: carpeta temporal del sistema).
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const svc = require('../server/mockups/mockupsService');

// --- argumentos ---
const argv = process.argv.slice(2);
function arg(name, def = null) {
    const i = argv.indexOf('--' + name);
    return (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[i + 1] : def;
}
const flag = name => argv.includes('--' + name);

const USE_GEMINI = flag('gemini');

// Lee una imagen de una URL pública o de un archivo local -> { mimeType, base64 }.
async function loadImage(src) {
    if (/^https?:\/\//i.test(src)) return svc.fetchImageAsBase64(src);
    const abs = path.resolve(src);
    if (!fs.existsSync(abs)) throw new Error('No existe el archivo: ' + abs);
    return { mimeType: 'image/png', base64: fs.readFileSync(abs).toString('base64') };
}

(async () => {
    const templates = await svc.listTemplates();

    if (flag('list')) {
        console.log('\nPlantillas (mockup_templates):');
        for (const t of templates) console.log(`  ${t.id}  ${t.nombre}   [aspecto ${t.aspectRatio || '1:1'}]`);
        console.log('');
        process.exit(0);
    }

    // --- de dónde salen la imagen base y el prompt ---
    let baseSrc = arg('base');
    let promptTemplate = arg('prompt');
    let aspectRatio = arg('aspect', '1:1');

    const tplArg = arg('template');
    if (tplArg) {
        const q = tplArg.toLowerCase();
        const tpl = templates.find(t => t.id === tplArg) || templates.find(t => (t.nombre || '').toLowerCase().includes(q));
        if (!tpl) throw new Error(`No encontré la plantilla "${tplArg}". Corre --list para ver las que hay.`);
        console.log(`Plantilla: ${tpl.nombre} (${tpl.id})`);
        baseSrc = baseSrc || tpl.baseImageUrl;
        promptTemplate = promptTemplate || tpl.promptTemplate;
        aspectRatio = tpl.aspectRatio || aspectRatio;
    }

    if (!baseSrc) throw new Error('Falta la imagen base: usa --template <nombre> o --base <url|archivo>.');
    if (!promptTemplate) throw new Error('Falta el prompt: usa --template <nombre> o --prompt "...".');

    const fields = { nombre1: arg('n1', ''), nombre2: arg('n2', ''), fecha: arg('fecha', '') };
    const prompt = svc.buildPromptFromTemplate(promptTemplate, fields);

    // Imágenes de referencia: la base y, opcionalmente, el diseño a grabar.
    const refs = [await loadImage(baseSrc)];
    const refSrc = arg('ref');
    if (refSrc) {
        refs.push(await loadImage(refSrc));
        console.log('2ª referencia:', refSrc);
    }

    console.log(`\nMotor: ${USE_GEMINI ? 'Gemini (gemini-3-pro-image-preview)' : 'OpenAI (' + (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1') + ')'}`);
    console.log(`Aspecto: ${aspectRatio}   Datos: ${JSON.stringify(fields)}`);
    console.log('\n--- PROMPT ---\n' + prompt + '\n--------------\n');
    console.log('Generando…');

    const t0 = Date.now();
    const result = USE_GEMINI
        ? await svc.generateImageGemini(prompt, aspectRatio, refs, '2K')
        : await svc.generateImageOpenAI(prompt, aspectRatio, refs, arg('quality'));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    const outPath = path.resolve(arg('out') || path.join(os.tmpdir(), `mockup-${result.provider}-${Date.now()}.png`));
    fs.writeFileSync(outPath, Buffer.from(result.images[0].base64, 'base64'));

    console.log(`\n✅ Listo en ${secs}s`);
    console.log(`   Motor:   ${result.provider} (${result.model})`);
    console.log(`   Tokens:  entrada ${result.usage.inputTokens} / salida ${result.usage.outputTokens}`);
    console.log(`   Costo:   $${result.cost.total.toFixed(4)} USD  (imagen $${result.cost.imagesCost.toFixed(4)} + entrada $${result.cost.inputTokenCost.toFixed(4)})`);
    console.log(`   Archivo: ${outPath}\n`);
    process.exit(0);
})().catch(e => {
    console.error('\n❌ Falló:', e.message, '\n');
    process.exit(1);
});
