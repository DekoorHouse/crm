// ... existing code ...
    });
}
// --- FIN DE LA CORRECCIÓN ---


// --- NUEVO LISTENER PARA PEDIDOS EN TIEMPO REAL ---
function listenForContactOrders(contactId, callback) {
    if (unsubscribeOrdersListener) unsubscribeOrdersListener();

    const q = db.collection('pedidos').where('telefono', '==', contactId);

    unsubscribeOrdersListener = q.onSnapshot(snapshot => {
        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                consecutiveOrderNumber: data.consecutiveOrderNumber,
                producto: data.producto,
                createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
                estatus: data.estatus || 'Sin estatus'
            };
        });
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        callback(orders);
    }, error => {
        console.error(`Error escuchando pedidos para ${contactId}:`, error);
        showError("Error al actualizar el historial de pedidos en tiempo real.");
        callback([]); // Enviar array vacío en caso de error
    });
}
// --- FIN DEL NUEVO LISTENER ---


// --- NUEVAS FUNCIONES DE CARGA PAGINADA ---

async function fetchInitialContacts() {
// ... existing code ...
