// --- START: HELPER FUNCTIONS ---
// Este archivo contiene funciones de ayuda genéricas utilizadas en toda la aplicación.

/**
 * Formats plain text with WhatsApp-like styling (bold, URLs) into safe HTML.
 * @param {string} text The plain text to format.
 * @returns {string} The formatted HTML string.
 */
function formatWhatsAppText(text) {
    if (!text) return '';
    
    let safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    safeText = safeText.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    safeText = safeText.replace(/\n/g, '<br>');

    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    safeText = safeText.replace(urlRegex, (url) => {
        let href = url;
        if (!url.startsWith('http')) {
            href = 'https://' + url;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">${url}</a>`;
    });

    return safeText;
}

/**
 * Copies formatted text (HTML and plain) to the clipboard and provides user feedback.
 * @param {string} text The text to copy.
 * @param {HTMLElement} buttonElement The button that was clicked to trigger the copy.
 */
function copyFormattedText(text, buttonElement) {
    const formattedHtml = formatWhatsAppText(text).replace(/<br>/g, '\n');
    const plainText = formattedHtml.replace(/<[^>]+>/g, '');

    const listener = (e) => {
        e.preventDefault();
        e.clipboardData.setData('text/html', formattedHtml);
        e.clipboardData.setData('text/plain', plainText);
    };

    document.addEventListener('copy', listener);
    document.execCommand('copy');
    document.removeEventListener('copy', listener);
    
    const originalIconHTML = buttonElement.innerHTML;
    buttonElement.innerHTML = '<i class="fas fa-check text-green-500"></i>';
    buttonElement.disabled = true;
    setTimeout(() => {
        buttonElement.innerHTML = originalIconHTML;
        buttonElement.disabled = false;
    }, 1500);
}


/**
 * Copies text to the clipboard and provides user feedback.
 * @param {string} text The text to copy.
 * @param {HTMLElement} buttonElement The button that triggered the copy action.
 */
function copyToClipboard(text, buttonElement) {
    navigator.clipboard.writeText(text).then(() => {
        const originalIconHTML = buttonElement.innerHTML;
        buttonElement.innerHTML = '<i class="fas fa-check text-green-500"></i>';
        buttonElement.disabled = true;
        setTimeout(() => {
            buttonElement.innerHTML = originalIconHTML;
            buttonElement.disabled = false;
        }, 1500);
    }).catch(err => {
        console.error('Error al copiar: ', err);
        alert('No se pudo copiar el número.');
    });
}


/**
 * Checks if two Date objects are on the same day.
 * @param {Date} d1 The first date.
 * @param {Date} d2 The second date.
 * @returns {boolean} True if they are the same day, false otherwise.
 */
function isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

/**
 * Formats a Date object into a user-friendly string for date separators ("Hoy", "Ayer", or full date).
 * @param {Date} date The date to format.
 * @returns {string} The formatted date string.
 */
function formatDateSeparator(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (isSameDay(date, today)) {
        return 'Hoy';
    }
    if (isSameDay(date, yesterday)) {
        return 'Ayer';
    }
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
