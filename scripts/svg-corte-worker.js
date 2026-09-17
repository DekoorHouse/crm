'use strict';
// Portable maintenance CLI. Production runs from the server scheduler every two minutes.
// The same Firestore lease protects this command; --force cannot bypass the server's switch.
const { productionWorker } = require('../server/design/svgCutWorker');
const args = process.argv.slice(2), index = args.indexOf('--max');
async function main() {
    // Finish special SVGs already staged on this workstation before migration. No Corel call.
    // Catalog lamp generation runs on the server regardless of whether this workstation is on.
    if (process.platform === 'win32') await require('./svg-corte-approved-local').processApprovedDesigns();
    return productionWorker().run({ dry: args.includes('--dry'), single: args.includes('--sin-pareja'),
    maxSheets: index < 0 ? 2 : Math.max(1, Math.min(20, Number(args[index + 1]) || 2))
    });
}
main().then(result => { console.log(JSON.stringify(result, null, 2)); process.exit(0); })
    .catch(e => { console.error('[SVG CORTE]', e.message); process.exit(1); });
