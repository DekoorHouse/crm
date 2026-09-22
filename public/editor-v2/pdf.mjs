import { exportSvg, validateDocument } from './model.mjs';

let libraries;
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = src;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar el exportador PDF. Intenta de nuevo.')); };
        document.head.append(script);
    });
}

export async function exportPdf(project) {
    const snapshot = validateDocument(project);
    libraries ||= (async () => {
        if (!window.jspdf) await loadScript('/editor-v2/vendor/jspdf.umd.min.js');
        if (!window.jspdf.jsPDF.API.svg) await loadScript('/editor-v2/vendor/svg2pdf.umd.min.js');
    })().catch(error => { libraries = null; throw error; });
    await libraries;
    const width = snapshot.width * 72 / 25.4, height = snapshot.height * 72 / 25.4;
    const pdf = new window.jspdf.jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt', format: [width, height], compress: true });
    pdf.setProperties({ title: snapshot.name, creator: 'Dekoor Editor' });
    const svg = new DOMParser().parseFromString(exportSvg(snapshot), 'image/svg+xml').documentElement;
    svg.setAttribute('width', width); svg.setAttribute('height', height);
    // jsPDF's built-in Helvetica supports the editor's Spanish text and accents.
    svg.querySelectorAll('text').forEach(text => text.setAttribute('font-family', 'helvetica'));
    await pdf.svg(svg, { x: 0, y: 0, width, height });
    return pdf.output('arraybuffer');
}
