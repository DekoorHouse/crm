// --- START: WhatsApp Web Utility Functions ---
// Este archivo contiene funciones auxiliares del lado del cliente
// relacionadas específicamente con la funcionalidad de WhatsApp Web.

/**
 * Obtiene el estado actual de la conexión de WhatsApp Web desde el backend.
 * @returns {Promise<{status: string}>} Una promesa que resuelve con un objeto
 * conteniendo el estado (ej: 'connected', 'disconnected', 'requires_scan', 'connecting').
 * Devuelve 'disconnected' en caso de error de red o si la API no responde como se espera.
 */
export async function getWebConnectionStatus() {
    try {
        // Llama al endpoint /api/web/status que creamos en webWhatsappRoutes.js
        // Usamos una ruta relativa asumiendo que el frontend se sirve desde el mismo dominio/puerto
        const response = await fetch('/api/web/status');

        if (!response.ok) {
            // Si la respuesta no es exitosa (ej: 404, 500), asume desconectado.
            console.warn(`Could not fetch web status (${response.status}), assuming disconnected.`);
            return { status: 'disconnected' };
        }

        const data = await response.json();

        // Verifica que la respuesta tenga el formato esperado
        if (data && data.status) {
            return { status: data.status };
        } else {
            // Si la respuesta es exitosa pero no tiene el formato esperado, asume desconectado.
            console.warn("Invalid response format from /api/web/status, assuming disconnected.");
            return { status: 'disconnected' };
        }

    } catch (error) {
        // Si hay un error de red (ej: el servidor está caído), asume desconectado.
        console.error("Network error fetching web status:", error);
        return { status: 'disconnected' };
    }
}
