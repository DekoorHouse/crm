const fs = require('fs');
const path = require('path');

let cpData = null;

function loadData() {
    if (cpData) return cpData;
    const filePath = path.join(__dirname, 'codigos_postales.json');
    cpData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`[SEPOMEX] Loaded ${Object.keys(cpData).length} postal codes`);
    return cpData;
}

/**
 * Lookup by postal code
 * @returns {{ success: boolean, codigoPostal: string, estado: string, municipio: string, ciudad: string, colonias: string[] } | null}
 */
function getByCp(cp) {
    const data = loadData();
    const entry = data[cp];
    if (!entry) return null;
    return {
        success: true,
        codigoPostal: cp,
        estado: entry.estado,
        municipio: entry.municipio,
        ciudad: entry.ciudad,
        colonias: entry.colonias,
    };
}

/**
 * Search colonias by state and partial name (accent-insensitive)
 * @returns {{ colonia: string, codigoPostal: string, estado: string, municipio: string, ciudad: string, vecinos: string[] }[]}
 */
function searchByColonia(estado, colonia) {
    const data = loadData();
    const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const normalEstado = normalize(estado);
    const normalColonia = normalize(colonia);

    const results = [];
    for (const [cp, entry] of Object.entries(data)) {
        if (normalize(entry.estado) !== normalEstado) continue;
        for (const col of entry.colonias) {
            if (normalize(col).includes(normalColonia)) {
                const vecinos = entry.colonias.filter(v => v !== col).slice(0, 3);
                results.push({
                    colonia: col,
                    codigoPostal: cp,
                    estado: entry.estado,
                    municipio: entry.municipio,
                    ciudad: entry.ciudad,
                    vecinos,
                });
            }
        }
        if (results.length >= 50) break;
    }
    return results;
}

module.exports = { getByCp, searchByColonia };
