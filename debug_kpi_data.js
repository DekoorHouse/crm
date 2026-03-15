const { db } = require('./config');

async function debugKpis() {
    console.log('--- DEBUG KPIS ---');
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Check for today specifically
    console.log(`Checking for date: ${today}`);
    const snapshot = await db.collection('daily_kpis').where('fecha', '==', today).get();
    
    if (snapshot.empty) {
        console.log('No KPI doc found for today.');
    } else {
        snapshot.forEach(doc => {
            console.log(`Found doc ID: ${doc.id}`);
            console.log('Data:', JSON.stringify(doc.data(), null, 2));
        });
    }

    // Check last 5 docs to see field names
    console.log('\nLast 5 docs in daily_kpis:');
    const lastDocs = await db.collection('daily_kpis').limit(5).get();
    lastDocs.forEach(doc => {
        console.log(`Doc ID: ${doc.id}, Fecha: ${doc.data().fecha}, Costo: ${doc.data().costo_publicidad}`);
    });
}

debugKpis().catch(console.error);
