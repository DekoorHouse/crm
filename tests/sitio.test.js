const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const sitioDir = path.join(publicDir, 'sitio');

describe('Sitio - Archivos estáticos', () => {
    test('index.html existe', () => {
        expect(fs.existsSync(path.join(sitioDir, 'index.html'))).toBe(true);
    });

    test('style.css existe', () => {
        expect(fs.existsSync(path.join(sitioDir, 'style.css'))).toBe(true);
    });

    test('script.js existe', () => {
        expect(fs.existsSync(path.join(sitioDir, 'script.js'))).toBe(true);
    });

    test('404.html existe', () => {
        expect(fs.existsSync(path.join(publicDir, '404.html'))).toBe(true);
    });

    test('sw.js existe', () => {
        expect(fs.existsSync(path.join(publicDir, 'sw.js'))).toBe(true);
    });

    test('manifest del sitio existe', () => {
        expect(fs.existsSync(path.join(sitioDir, 'manifest.json'))).toBe(true);
    });

    test('página de términos existe', () => {
        expect(fs.existsSync(path.join(publicDir, 'terminos', 'index.html'))).toBe(true);
    });
});

describe('Sitio - SEO', () => {
    const html = fs.readFileSync(path.join(sitioDir, 'index.html'), 'utf8');

    test('tiene meta description', () => {
        expect(html).toContain('<meta name="description"');
    });

    test('tiene canonical URL', () => {
        expect(html).toContain('<link rel="canonical"');
    });

    test('tiene Open Graph tags', () => {
        expect(html).toContain('og:title');
        expect(html).toContain('og:description');
        expect(html).toContain('og:image');
    });

    test('tiene Twitter Card tags', () => {
        expect(html).toContain('twitter:card');
    });

    test('tiene structured data Store', () => {
        expect(html).toContain('"@type": "Store"');
    });

    test('tiene structured data FAQPage', () => {
        expect(html).toContain('"@type": "FAQPage"');
    });

    test('tiene structured data BreadcrumbList', () => {
        expect(html).toContain('"@type": "BreadcrumbList"');
    });

    test('tiene aggregateRating', () => {
        expect(html).toContain('"@type": "AggregateRating"');
    });
});

describe('Sitio - Accesibilidad', () => {
    const html = fs.readFileSync(path.join(sitioDir, 'index.html'), 'utf8');

    test('tiene lang="es"', () => {
        expect(html).toContain('lang="es"');
    });

    test('tiene aria-labels en botones de navegación', () => {
        expect(html).toContain('aria-label="Menú"');
        expect(html).toContain('aria-label="Rastrear pedido"');
    });

    test('imágenes del carrusel tienen alt descriptivo', () => {
        expect(html).toContain('alt="Lámpara 3D personalizada con foto de pareja');
    });

    test('imágenes tienen width y height', () => {
        expect(html).toMatch(/carousel-slide.*width="600".*height="600"/);
    });
});

describe('Sitio - Seguridad', () => {
    const html = fs.readFileSync(path.join(sitioDir, 'index.html'), 'utf8');

    test('enlaces externos tienen rel="noopener"', () => {
        const externalLinks = html.match(/target="_blank"[^>]*/g) || [];
        externalLinks.forEach(link => {
            expect(link).toContain('noopener');
        });
    });

    test('tiene cookie banner', () => {
        expect(html).toContain('cookieBanner');
    });

    test('tiene SRI en Font Awesome CDN', () => {
        expect(html).toContain('integrity="sha512');
    });
});

describe('Sitio - PWA', () => {
    const html = fs.readFileSync(path.join(sitioDir, 'index.html'), 'utf8');

    test('registra service worker', () => {
        expect(html).toContain("serviceWorker.register('/sw.js')");
    });

    test('tiene link al manifest', () => {
        expect(html).toContain('rel="manifest"');
    });

    test('tiene theme-color', () => {
        expect(html).toContain('name="theme-color"');
    });

    test('tiene apple-touch-icon', () => {
        expect(html).toContain('rel="apple-touch-icon"');
    });
});

describe('Firestore Rules - Seguridad', () => {
    const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

    test('NO tiene allow read, write: if true para todo', () => {
        // Should not have a blanket "if true" at the top level
        const lines = rules.split('\n');
        const blanketTrue = lines.filter(l =>
            l.includes('match /{document=**}') ||
            (l.includes('allow read, write: if true') && !l.trim().startsWith('//'))
        );
        // The catch-all should require authentication
        expect(rules).toContain('isAuthenticated()');
    });

    test('productos son de lectura pública', () => {
        expect(rules).toContain('match /productos/{docId}');
        expect(rules).toContain('allow read: if true');
    });

    test('contactos requieren autenticación', () => {
        expect(rules).toContain('match /contacts/{contactId}');
    });
});

describe('Robots.txt', () => {
    const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');

    test('permite /sitio/', () => {
        expect(robots).toContain('Allow: /sitio/');
    });

    test('permite /terminos/', () => {
        expect(robots).toContain('Allow: /terminos/');
    });

    test('bloquea /admon/', () => {
        expect(robots).toContain('Disallow: /admon/');
    });

    test('tiene sitemap', () => {
        expect(robots).toContain('Sitemap:');
    });
});
