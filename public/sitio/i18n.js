/* ============================================================
   DEKOOR - Sistema i18n básico
   Uso: data-i18n="key" en elementos HTML
   ============================================================ */

const I18N = {
    es: {
        // Navbar
        'nav.inicio': 'Inicio',
        'nav.colecciones': 'Colecciones',
        'nav.categorias': 'Categorías',
        'nav.como_funciona': 'Cómo Funciona',
        'nav.referencias': 'Referencias',
        'nav.rastreo': 'Rastreo',
        'nav.contacto': 'Contacto',
        // Hero
        'hero.title': 'REGALOS QUE<br>CUENTAN HISTORIAS',
        'hero.subtitle': 'Transforma tus recuerdos en tesoros únicos',
        'hero.cta': 'Crear mi lámpara de foto',
        'hero.orders': 'pedidos',
        'hero.shipping': 'Envío nacional',
        'hero.stars': 'estrellas',
        // Sections
        'sections.collections': 'COLECCIONES DESTACADAS',
        'sections.other_gifts': 'OTROS REGALOS',
        'sections.testimonials': 'LO QUE DICEN NUESTROS CLIENTES',
        'sections.how_it_works': 'CÓMO FUNCIONA',
        'sections.faq': 'PREGUNTAS FRECUENTES',
        'sections.deliveries_map': 'Nuestras entregas en México',
        // Steps
        'steps.choose': 'Elige tu producto',
        'steps.choose_desc': 'Explora nuestro catálogo y escoge el artículo que más te guste',
        'steps.personalize': 'Personalízalo',
        'steps.personalize_desc': 'Envíanos por WhatsApp tu foto, nombre o mensaje especial',
        'steps.fabricate': 'Lo fabricamos',
        'steps.fabricate_desc': 'Grabamos tu diseño con láser de precisión en nuestro taller',
        'steps.receive': 'Recíbelo en casa',
        'steps.receive_desc': 'Envío a todo México con rastreo en tiempo real',
        // Value props
        'vp.simple': 'SIMPLE',
        'vp.simple_desc': 'Crear un regalo personalizado es fácil y rápido por WhatsApp',
        'vp.secure': 'SEGURO',
        'vp.secure_desc': 'Compra con total confianza, envío protegido a todo México',
        'vp.fast': 'RÁPIDO',
        'vp.fast_desc': 'Fabricamos y enviamos tu pedido en menos de 5 días hábiles',
        // Footer
        'footer.navigation': 'Navegación',
        'footer.services': 'Servicios',
        'footer.contact': 'Contacto',
        'footer.privacy': 'Aviso de privacidad',
        'footer.terms': 'Términos y condiciones',
        'footer.copyright': 'Contenido personalizado © 2026 DEKOOR',
        // Cookie banner
        'cookies.text': 'Usamos cookies para mejorar tu experiencia y analizar el tráfico del sitio.',
        'cookies.accept': 'Aceptar',
        'cookies.reject': 'Rechazar',
    },
    en: {
        'nav.inicio': 'Home',
        'nav.colecciones': 'Collections',
        'nav.categorias': 'Categories',
        'nav.como_funciona': 'How It Works',
        'nav.referencias': 'Reviews',
        'nav.rastreo': 'Tracking',
        'nav.contacto': 'Contact',
        'hero.title': 'GIFTS THAT<br>TELL STORIES',
        'hero.subtitle': 'Transform your memories into unique treasures',
        'hero.cta': 'Create my photo lamp',
        'hero.orders': 'orders',
        'hero.shipping': 'Nationwide shipping',
        'hero.stars': 'stars',
        'sections.collections': 'FEATURED COLLECTIONS',
        'sections.other_gifts': 'OTHER GIFTS',
        'sections.testimonials': 'WHAT OUR CUSTOMERS SAY',
        'sections.how_it_works': 'HOW IT WORKS',
        'sections.faq': 'FREQUENTLY ASKED QUESTIONS',
        'sections.deliveries_map': 'Our deliveries in Mexico',
        'steps.choose': 'Choose your product',
        'steps.choose_desc': 'Browse our catalog and pick the item you like most',
        'steps.personalize': 'Personalize it',
        'steps.personalize_desc': 'Send us your photo, name or special message via WhatsApp',
        'steps.fabricate': 'We make it',
        'steps.fabricate_desc': 'We engrave your design with precision laser in our workshop',
        'steps.receive': 'Receive at home',
        'steps.receive_desc': 'Shipping to all Mexico with real-time tracking',
        'vp.simple': 'SIMPLE',
        'vp.simple_desc': 'Creating a personalized gift is easy and fast via WhatsApp',
        'vp.secure': 'SECURE',
        'vp.secure_desc': 'Shop with confidence, protected shipping nationwide',
        'vp.fast': 'FAST',
        'vp.fast_desc': 'We manufacture and ship your order in less than 5 business days',
        'footer.navigation': 'Navigation',
        'footer.services': 'Services',
        'footer.contact': 'Contact',
        'footer.privacy': 'Privacy Policy',
        'footer.terms': 'Terms & Conditions',
        'footer.copyright': 'Custom content © 2026 DEKOOR',
        'cookies.text': 'We use cookies to improve your experience and analyze site traffic.',
        'cookies.accept': 'Accept',
        'cookies.reject': 'Reject',
    }
};

function getCurrentLang() {
    return localStorage.getItem('dekoor_lang') || 'es';
}

function setLang(lang) {
    if (!I18N[lang]) return;
    localStorage.setItem('dekoor_lang', lang);
    applyTranslations(lang);
}

function t(key) {
    const lang = getCurrentLang();
    return (I18N[lang] && I18N[lang][key]) || (I18N.es[key]) || key;
}

function applyTranslations(lang) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = (I18N[lang] && I18N[lang][key]) || (I18N.es[key]) || '';
        if (text) el.innerHTML = text;
    });
}
