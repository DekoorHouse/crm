/**
 * Precalcula (y congela) los días de conversaciones que usa el panel "Negocio" de Métricas.
 *
 * El panel guarda un documento por día en `metrics_conversations/<YYYY-MM-DD>`: un día que ya
 * cerró no vuelve a cambiar, así que solo se calcula UNA vez. El problema es que ese primer
 * cálculo escanea todos los mensajes del rango, y con 90 días eso tarda varios minutos — algo
 * que nadie quiere esperar con el panel abierto. Este script lo hace por adelantado.
 *
 * Uso:
 *   node scripts/warmup-business-metrics.js            # 90 días (default)
 *   node scripts/warmup-business-metrics.js 180        # 180 días
 *   node scripts/warmup-business-metrics.js 90 --chunk 15
 *
 * Va por trozos (default 10 días) de lo MÁS RECIENTE a lo más viejo: cada trozo es un escaneo
 * corto y, si el script se corta a la mitad, lo ya calculado queda guardado y no se repite.
 */
const { computeBusinessMetrics, dayKeysBack } = require('../server/metrics/businessMetrics');

const args = process.argv.slice(2);
const totalDays = Math.min(Math.max(parseInt(args.find(a => /^\d+$/.test(a)), 10) || 90, 1), 730);
const chunkIdx = args.indexOf('--chunk');
const chunk = chunkIdx >= 0 ? Math.max(1, parseInt(args[chunkIdx + 1], 10) || 10) : 10;

(async () => {
    const allDays = dayKeysBack(totalDays);
    console.log(`Precalculando ${totalDays} días (${allDays[0]} → ${allDays[allDays.length - 1]}) en trozos de ${chunk}.\n`);

    // De lo más reciente a lo más viejo: computeBusinessMetrics(n) siempre cuenta hacia atrás
    // desde hoy, así que basta con ir creciendo la ventana.
    const t0 = Date.now();
    for (let days = Math.min(chunk, totalDays); ; days = Math.min(days + chunk, totalDays)) {
        const t = Date.now();
        const r = await computeBusinessMetrics(days);
        const nuevos = r.meta.recomputedDays;
        console.log(`  ${String(days).padStart(4)} días · ${nuevos} día(s) calculados · ${((Date.now() - t) / 1000).toFixed(1)}s` +
            `  (${r.range.from} → ${r.range.to}, ${r.conversations.total} conversaciones nuevas)`);
        if (days >= totalDays) break;
    }
    console.log(`\n✅ Listo en ${((Date.now() - t0) / 60000).toFixed(1)} min. El panel ya abre en segundos.`);
    process.exit(0);
})().catch(e => {
    console.error('❌ Falló el precálculo:', e.message);
    process.exit(1);
});
