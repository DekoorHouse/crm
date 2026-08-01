// Galería — banco de imágenes del taller.
// -------------------------------------------------------------------
// Andrea busca lo que le pide el cliente ("perro", "xv", "virgen"), marca las fotos y
// las manda. El puente con el chat es el PORTAPAPELES: el composer del CRM ya acepta
// pegado (handlePaste en public/js/modules/chat-handlers.js), así que copiar aquí y
// pegar allá funciona sin tocar una línea del chat.
//
// Los ~200 documentos se cargan completos y el filtrado es en memoria: Firestore no
// hace búsqueda de texto y a esta escala traerlos todos es más rápido y más barato que
// cualquier consulta. Si algún día pasan de unos miles, toca mover la búsqueda al servidor.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
    measurementId: "G-FTCDCMZB1S"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Etiquetas legibles de las colecciones (los ids son los mismos del sitio público).
const NOMBRES_COLECCION = {
    ninos: 'Niños', pareja: 'Pareja', empresas: 'Empresas', familia: 'Familia',
    mascotas: 'Mascotas', graduacion: 'Graduación', memorial: 'Memorial',
    religiosas: 'Religiosas', cuadros: 'Cuadros', otros: 'Otros',
};

const state = {
    fotos: [],                 // todas las de Firestore
    visibles: [],              // las que pasan el filtro (orden de la cuadrícula)
    marcadas: new Set(),       // ids seleccionados
    busqueda: '',
    coleccion: null,           // null = todas
    verDescartadas: false,
    visorIdx: -1,
};

const $ = id => document.getElementById(id);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ===================== AVISOS =====================

let avisoTimer = null;
function avisar(texto, esError = false) {
    const el = $('aviso');
    el.textContent = texto;
    el.classList.toggle('error', esError);
    el.classList.remove('oculto');
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => el.classList.add('oculto'), 2600);
}

// ===================== AUTENTICACIÓN =====================

onAuthStateChanged(auth, usuario => {
    $('loading-overlay').classList.add('oculto');
    $('seccionLogin').classList.toggle('oculto', !!usuario);
    $('seccionApp').classList.toggle('oculto', !usuario);
    if (usuario) escucharGaleria();
});

$('formularioLogin').addEventListener('submit', async e => {
    e.preventDefault();
    $('mensajeError').textContent = '';
    try {
        await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
    } catch (err) {
        $('mensajeError').textContent = 'Correo o contraseña incorrectos.';
    }
});

$('btnSalir').addEventListener('click', () => signOut(auth));

// ===================== CARGA =====================

let yaEscuchando = false;
function escucharGaleria() {
    if (yaEscuchando) return;
    yaEscuchando = true;
    onSnapshot(collection(db, 'galeria'), snap => {
        state.fotos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Más usadas primero: lo que se manda seguido es lo que se vuelve a necesitar.
        state.fotos.sort((a, b) => (b.vecesEnviada || 0) - (a.vecesEnviada || 0)
            || String(a.titulo || '').localeCompare(String(b.titulo || '')));
        pintarChips();
        pintar();
    }, err => {
        console.error('[galeria] onSnapshot:', err);
        avisar('No se pudo cargar la galería.', true);
    });
}

// ===================== FILTRO Y PINTADO =====================

const escaparRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Un término coincide si alguna PALABRA del texto empieza con él.
 * No vale `includes`: buscar "moto" devolvía 51 fotos porque casi toda descripción dice
 * "control remoto". El prefijo sí conserva lo útil — "lamp" encuentra "lámpara" y
 * "perro" encuentra "perros" — sin arrastrar coincidencias a media palabra.
 */
function coincide(heno, término) {
    return new RegExp(`\\b${escaparRegex(término)}`).test(heno);
}

function filtrar() {
    const términos = norm(state.busqueda).split(/\s+/).filter(Boolean);
    return state.fotos.filter(f => {
        if (!state.verDescartadas && f.activa === false) return false;
        if (state.coleccion && f.coleccion !== state.coleccion) return false;
        if (!términos.length) return true;
        // Todos los términos deben aparecer: "lampara perro" no debe traer toda lámpara.
        const heno = f.busqueda || norm(`${f.titulo} ${f.descripcion} ${(f.tags || []).join(' ')}`);
        return términos.every(t => coincide(heno, t));
    });
}

function pintarChips() {
    const cont = $('chipsColecciones');
    const cuenta = new Map();
    for (const f of state.fotos) {
        if (!state.verDescartadas && f.activa === false) continue;
        cuenta.set(f.coleccion, (cuenta.get(f.coleccion) || 0) + 1);
    }
    const total = [...cuenta.values()].reduce((a, b) => a + b, 0);

    const chips = [`<button class="chip ${state.coleccion === null ? 'activo' : ''}" data-col="">Todas <span class="num">${total}</span></button>`];
    for (const [id, n] of [...cuenta.entries()].sort((a, b) => b[1] - a[1])) {
        const nombre = NOMBRES_COLECCION[id] || id || 'Sin colección';
        chips.push(`<button class="chip ${state.coleccion === id ? 'activo' : ''}" data-col="${id}">${nombre} <span class="num">${n}</span></button>`);
    }
    cont.innerHTML = chips.join('');
    cont.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
        state.coleccion = b.dataset.col || null;
        pintarChips();
        pintar();
    }));
}

function pintar() {
    state.visibles = filtrar();
    const cuadricula = $('cuadricula');

    cuadricula.innerHTML = state.visibles.map((f, i) => `
        <div class="tarjeta ${state.marcadas.has(f.id) ? 'marcada' : ''} ${f.activa === false ? 'inactiva' : ''}" data-idx="${i}">
            <div class="tarjeta-check" data-check="${f.id}"><i class="fas fa-check"></i></div>
            ${f.vecesEnviada ? `<span class="insignia"><i class="fas fa-paper-plane"></i> ${f.vecesEnviada}</span>` : ''}
            <img class="tarjeta-img" src="${f.thumbUrl || f.url || ''}" alt="" loading="lazy">
            <div class="tarjeta-cuerpo">
                <div class="tarjeta-titulo">${escapar(f.titulo || 'Sin título')}</div>
                <div class="tarjeta-meta">${NOMBRES_COLECCION[f.coleccion] || f.coleccion || '—'}</div>
            </div>
        </div>`).join('');

    // El check marca sin abrir; el resto de la tarjeta abre el visor.
    cuadricula.querySelectorAll('[data-check]').forEach(el => el.addEventListener('click', e => {
        e.stopPropagation();
        alternarMarca(el.dataset.check);
    }));
    cuadricula.querySelectorAll('.tarjeta').forEach(el => el.addEventListener('click', () => {
        abrirVisor(Number(el.dataset.idx));
    }));

    $('vacio').classList.toggle('oculto', state.visibles.length > 0);
    if (!state.visibles.length) {
        $('vacioTexto').textContent = state.busqueda
            ? `Nada para “${state.busqueda}”. Prueba con una palabra más general.`
            : 'Todavía no hay fotos en la galería.';
    }
    $('contadorTotal').textContent = `${state.visibles.length} de ${state.fotos.length}`;
    pintarSeleccion();
}

const escapar = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ===================== SELECCIÓN =====================

function alternarMarca(id) {
    if (state.marcadas.has(id)) state.marcadas.delete(id);
    else state.marcadas.add(id);
    pintar();
}

function pintarSeleccion() {
    const n = state.marcadas.size;
    $('barraSeleccion').classList.toggle('oculto', n === 0);
    $('textoSeleccion').textContent = n === 1 ? '1 foto seleccionada' : `${n} fotos seleccionadas`;
    // El portapapeles solo guarda UNA imagen a la vez; con varias, el camino es descargar.
    const btnCopiar = $('btnCopiar');
    btnCopiar.disabled = n !== 1;
    btnCopiar.title = n > 1 ? 'El portapapeles solo admite una imagen a la vez — usa Descargar' : '';
}

$('btnDeseleccionar').addEventListener('click', () => { state.marcadas.clear(); pintar(); });

// ===================== COPIAR Y DESCARGAR =====================

/**
 * Copia la imagen al portapapeles como PNG (Chrome solo acepta image/png en ClipboardItem).
 * Los bytes se piden al proxy del propio CRM para no chocar con el CORS del bucket.
 */
async function copiarAlPortapapeles(id) {
    if (!navigator.clipboard || !window.ClipboardItem) {
        avisar('Este navegador no permite copiar imágenes. Usa Descargar.', true);
        return;
    }
    try {
        const resp = await fetch(`/api/galeria/archivo/${id}`, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blobWebp = await resp.blob();

        const bitmap = await createImageBitmap(blobWebp);
        const lienzo = document.createElement('canvas');
        lienzo.width = bitmap.width;
        lienzo.height = bitmap.height;
        lienzo.getContext('2d').drawImage(bitmap, 0, 0);
        const blobPng = await new Promise(r => lienzo.toBlob(r, 'image/png'));

        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPng })]);
        contarEnvio(id);
        avisar('Copiada — pégala en el chat con Ctrl+V');
    } catch (err) {
        console.error('[galeria] copiar:', err);
        avisar('No se pudo copiar. Usa Descargar.', true);
    }
}

function descargar(ids) {
    ids.forEach((id, i) => {
        // Un pequeño escalonado: varias descargas simultáneas hacen que el navegador
        // descarte algunas sin avisar.
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = `/api/galeria/archivo/${id}?descargar=1`;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            a.remove();
            contarEnvio(id);
        }, i * 350);
    });
    avisar(ids.length === 1 ? 'Descargando…' : `Descargando ${ids.length} fotos…`);
}

/** Contador de uso: best-effort, nunca debe estorbar. */
function contarEnvio(id) {
    fetch(`/api/galeria/${id}/enviada`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
}

$('btnCopiar').addEventListener('click', () => {
    const [id] = [...state.marcadas];
    if (id) copiarAlPortapapeles(id);
});
$('btnDescargar').addEventListener('click', () => {
    if (state.marcadas.size) descargar([...state.marcadas]);
});

// ===================== BUSCADOR =====================

let debounce = null;
$('inputBuscar').addEventListener('input', e => {
    state.busqueda = e.target.value;
    $('btnLimpiar').classList.toggle('oculto', !state.busqueda);
    clearTimeout(debounce);
    debounce = setTimeout(pintar, 120);
});
$('btnLimpiar').addEventListener('click', () => {
    state.busqueda = '';
    $('inputBuscar').value = '';
    $('btnLimpiar').classList.add('oculto');
    pintar();
    $('inputBuscar').focus();
});
$('chkDescartadas').addEventListener('change', e => {
    state.verDescartadas = e.target.checked;
    pintarChips();
    pintar();
});

// ===================== VISOR =====================

function abrirVisor(idx) {
    const f = state.visibles[idx];
    if (!f) return;
    state.visorIdx = idx;

    $('visorImg').src = f.url || f.thumbUrl || '';
    $('visorTitulo').value = f.titulo || '';
    $('visorDescripcion').textContent = f.descripcion || '';
    $('visorTags').value = (f.tags || []).join(', ');
    $('visorEstado').textContent = f.activa === false ? `Descartada por la IA: ${f.motivoDescarte || 'sin motivo'}` : '';
    $('visorActiva').innerHTML = f.activa === false
        ? '<i class="fas fa-eye"></i> Reactivar'
        : '<i class="fas fa-eye-slash"></i> Ocultar';

    const sel = $('visorColeccion');
    sel.innerHTML = Object.entries(NOMBRES_COLECCION)
        .map(([id, n]) => `<option value="${id}" ${f.coleccion === id ? 'selected' : ''}>${n}</option>`).join('');

    $('visor').classList.remove('oculto');
}

function cerrarVisor() {
    $('visor').classList.add('oculto');
    state.visorIdx = -1;
}

function moverVisor(paso) {
    const nuevo = state.visorIdx + paso;
    if (nuevo >= 0 && nuevo < state.visibles.length) abrirVisor(nuevo);
}

$('visorCerrar').addEventListener('click', cerrarVisor);
$('visorAnterior').addEventListener('click', () => moverVisor(-1));
$('visorSiguiente').addEventListener('click', () => moverVisor(1));
$('visor').addEventListener('click', e => { if (e.target === $('visor')) cerrarVisor(); });

document.addEventListener('keydown', e => {
    if ($('visor').classList.contains('oculto')) return;
    if (e.key === 'Escape') cerrarVisor();
    if (e.key === 'ArrowLeft') moverVisor(-1);
    if (e.key === 'ArrowRight') moverVisor(1);
});

$('visorCopiar').addEventListener('click', () => {
    const f = state.visibles[state.visorIdx];
    if (f) copiarAlPortapapeles(f.id);
});

$('visorGuardar').addEventListener('click', async () => {
    const f = state.visibles[state.visorIdx];
    if (!f) return;
    const titulo = $('visorTitulo').value.trim();
    const coleccion = $('visorColeccion').value;
    const tags = $('visorTags').value.split(',').map(t => norm(t).trim()).filter(Boolean);
    try {
        await updateDoc(doc(db, 'galeria', f.id), {
            titulo, coleccion, tags,
            // `busqueda` es el campo contra el que filtra el buscador: hay que rehacerlo
            // o las ediciones no se podrían encontrar.
            busqueda: norm(`${titulo} ${f.descripcion || ''} ${tags.join(' ')}`),
        });
        avisar('Guardado');
        cerrarVisor();
    } catch (err) {
        console.error('[galeria] guardar:', err);
        avisar('No se pudo guardar.', true);
    }
});

$('visorActiva').addEventListener('click', async () => {
    const f = state.visibles[state.visorIdx];
    if (!f) return;
    try {
        await updateDoc(doc(db, 'galeria', f.id), { activa: f.activa === false });
        avisar(f.activa === false ? 'Reactivada' : 'Oculta de la galería');
        cerrarVisor();
    } catch (err) {
        console.error('[galeria] activa:', err);
        avisar('No se pudo cambiar.', true);
    }
});

// Atajo: "/" enfoca el buscador, como en el chat.
document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        $('inputBuscar').focus();
    }
});
