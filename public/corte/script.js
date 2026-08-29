// Corte — biblioteca de archivos SVG para la cortadora láser.
// -------------------------------------------------------------------
// La lista completa se trae de una sola vez (son cientos de documentos chicos) y el
// filtrado, la búsqueda y el orden pasan en memoria: mismo criterio que /galeria. Lo
// que NO se trae es el SVG; para eso está la miniatura PNG que el servidor generó al
// subir (un grabado con foto embebida pesa MB y aquí se ven 40 de golpe).
//
// La sesión es la misma del CRM (Firebase Auth). Todo lo que escribe —subir y borrar—
// manda el ID token, así que en Firestore siempre queda quién subió cada archivo.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
    measurementId: "G-FTCDCMZB1S"
};

const auth = getAuth(initializeApp(firebaseConfig));

const $ = id => document.getElementById(id);

const state = {
    archivos: [],
    busqueda: '',
    filtro: 'todos',
    seleccion: new Set(),
    // En pantalla angosta (la tablet del taller en vertical) la tabla no cabe y hay que
    // deslizarla de lado; las tarjetas ahí se leen mejor. Es un default, no un candado:
    // el botón de lista sigue estando.
    vista: window.innerWidth < 900 ? 'cuadricula' : 'lista',
    orden: { campo: 'subidoEn', dir: 'desc' },
    cargando: true,
    subiendo: false,
};

// ===================== UTILERÍAS =====================

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sinAcentos = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function pesoLegible(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** En la tabla basta la persona: "chris", no "chris@dekoor.com" (el correo va en el title). */
const quien = correo => String(correo || '—').split('@')[0];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaLegible(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const hoy = new Date();
    const mismoDia = (a, b) => a.toDateString() === b.toDateString();
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const hora = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
    if (mismoDia(d, hoy)) return `Hoy, ${hora}`;
    if (mismoDia(d, ayer)) return `Ayer, ${hora}`;
    const conAno = d.getFullYear() !== hoy.getFullYear() ? ` ${d.getFullYear()}` : '';
    return `${d.getDate()} ${MESES[d.getMonth()]}${conAno}`;
}

/** Inicio del día de hoy y de hace 7 días: los usan los filtros del rail. */
function limites() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const semana = new Date(hoy); semana.setDate(hoy.getDate() - 6);
    return { hoy: hoy.getTime(), semana: semana.getTime() };
}

let avisoTimer = null;
function avisar(texto, esError = false) {
    const el = $('aviso');
    el.innerHTML = texto;
    el.classList.toggle('error', esError);
    el.classList.remove('oculto');
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => el.classList.add('oculto'), esError ? 6000 : 3800);
}

/** Toda llamada a /api/corte va firmada con el ID token de la sesión del CRM. */
async function api(ruta, opciones = {}) {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(ruta, {
        ...opciones,
        headers: { ...(opciones.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        let mensaje = `Error ${res.status}`;
        try { mensaje = (await res.json()).message || mensaje; } catch { /* respuesta sin JSON */ }
        throw new Error(mensaje);
    }
    return res;
}

/** Guarda un blob con el nombre que le toca (el navegador no puede escribir solo). */
function guardar(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ===================== AUTENTICACIÓN =====================

onAuthStateChanged(auth, usuario => {
    $('btnLista').setAttribute('aria-pressed', String(state.vista === 'lista'));
    $('btnCuadricula').setAttribute('aria-pressed', String(state.vista === 'cuadricula'));
    $('loading-overlay').classList.add('oculto');
    $('seccionLogin').classList.toggle('oculto', !!usuario);
    $('seccionApp').classList.toggle('oculto', !usuario);
    if (usuario) cargar();
});

$('formularioLogin').addEventListener('submit', async e => {
    e.preventDefault();
    $('mensajeError').textContent = '';
    try {
        await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
    } catch {
        $('mensajeError').textContent = 'Correo o contraseña incorrectos.';
    }
});

$('btnSalir').addEventListener('click', () => signOut(auth));

// ===================== CARGA =====================

async function cargar() {
    state.cargando = true;
    pintar();
    try {
        const res = await api('/api/corte');
        const datos = await res.json();
        state.archivos = datos.archivos || [];
    } catch (error) {
        avisar(`No se pudo cargar la biblioteca: ${esc(error.message)}`, true);
        state.archivos = [];
    }
    state.cargando = false;
    pintar();
}

// ===================== FILTROS Y ORDEN =====================

const FILTROS = [
    { id: 'todos', etiqueta: 'Todos los archivos', icono: 'i-folder', prueba: () => true },
    { id: 'hoy', etiqueta: 'De hoy', icono: 'i-clock', prueba: a => new Date(a.subidoEn).getTime() >= limites().hoy },
    { id: 'semana', etiqueta: 'Esta semana', icono: 'i-clock', prueba: a => new Date(a.subidoEn).getTime() >= limites().semana },
    { id: 'con-dh', etiqueta: 'Con pedido', icono: 'i-tag', prueba: a => !!a.dh },
    { id: 'sin-dh', etiqueta: 'Sin pedido', icono: 'i-tag', prueba: a => !a.dh },
];

const filtroActivo = () => FILTROS.find(f => f.id === state.filtro) || FILTROS[0];

function visibles() {
    const q = sinAcentos(state.busqueda).trim();
    const prueba = filtroActivo().prueba;
    const lista = state.archivos.filter(a => {
        if (!prueba(a)) return false;
        if (!q) return true;
        return sinAcentos(`${a.nombre} ${a.dh || ''} ${a.subidoPor || ''}`).includes(q);
    });

    const { campo, dir } = state.orden;
    const signo = dir === 'asc' ? 1 : -1;
    return lista.sort((a, b) => {
        if (campo === 'peso') return signo * ((a.peso || 0) - (b.peso || 0));
        if (campo === 'nombre') return signo * String(a.nombre).localeCompare(String(b.nombre), 'es');
        return signo * (new Date(a.subidoEn) - new Date(b.subidoEn));
    });
}

function ordenarPor(campo) {
    if (state.orden.campo === campo) state.orden.dir = state.orden.dir === 'asc' ? 'desc' : 'asc';
    else state.orden = { campo, dir: campo === 'nombre' ? 'asc' : 'desc' };
    pintar();
}

// ===================== PINTADO =====================

function miniatura(a, clase = 'mini') {
    if (a.thumbUrl) return `<img class="${clase}" src="${esc(a.thumbUrl)}" alt="" loading="lazy" data-ver="${esc(a.id)}">`;
    // Sin miniatura = resvg no pudo con el archivo (o el lienzo salió vacío). Se dice,
    // no se disimula: quien corta necesita saber que ese archivo hay que abrirlo.
    return `<div class="mini-vacia" data-ver="${esc(a.id)}" title="No se pudo generar la miniatura">SVG</div>`;
}

function pintarCarpetas() {
    $('carpetas').innerHTML = FILTROS.map(f => {
        const n = state.archivos.filter(f.prueba).length;
        return `<button class="carpeta" data-filtro="${f.id}" aria-pressed="${state.filtro === f.id}">
            <svg class="ico"><use href="#${f.icono}"/></svg>
            <span>${f.etiqueta}</span>
            <span class="n">${n}</span>
        </button>`;
    }).join('');

    const total = state.archivos.reduce((suma, a) => suma + (a.peso || 0), 0);
    $('resumenPeso').innerHTML = state.archivos.length
        ? `${state.archivos.length} archivo${state.archivos.length === 1 ? '' : 's'}<br>${pesoLegible(total)} en total`
        : '';
}

function pintarRuta(lista) {
    $('ruta').innerHTML = `
        <svg class="ico"><use href="#i-folder"/></svg>
        <b>Corte</b> ›
        <span>${esc(filtroActivo().etiqueta)}</span> ·
        <span>${lista.length} archivo${lista.length === 1 ? '' : 's'}</span>
        ${state.busqueda ? `· <span>buscando “${esc(state.busqueda)}”</span>` : ''}`;
}

function flecha(campo) {
    if (state.orden.campo !== campo) return '';
    return `<span class="flecha">${state.orden.dir === 'asc' ? '▲' : '▼'}</span>`;
}

function pintarLista(lista) {
    const todosMarcados = lista.length > 0 && lista.every(a => state.seleccion.has(a.id));
    return `
    <table>
        <thead><tr>
            <th class="col-check"><input type="checkbox" id="checkTodos" ${todosMarcados ? 'checked' : ''} aria-label="Seleccionar todo"></th>
            <th class="ordenable" data-orden="nombre">Nombre ${flecha('nombre')}</th>
            <th>Pedido</th>
            <th class="ordenable col-peso" data-orden="peso">Peso ${flecha('peso')}</th>
            <th class="celda-oculta-movil">Subido por</th>
            <th class="ordenable" data-orden="subidoEn">Fecha ${flecha('subidoEn')}</th>
            <th class="col-acciones"></th>
        </tr></thead>
        <tbody>
            ${lista.map(a => `
                <tr data-sel="${state.seleccion.has(a.id) ? 1 : 0}">
                    <td class="col-check"><input type="checkbox" data-marcar="${esc(a.id)}" ${state.seleccion.has(a.id) ? 'checked' : ''} aria-label="Seleccionar ${esc(a.nombre)}"></td>
                    <td>
                        <div class="celda-archivo">
                            ${miniatura(a)}
                            <div class="nombre-archivo">
                                <div class="n" title="${esc(a.nombre)}">${esc(a.nombre)}</div>
                                <div class="sub">${esc(a.medidas || 'sin medidas')}</div>
                            </div>
                        </div>
                    </td>
                    <td>${a.dh ? `<span class="dh">${esc(a.dh)}</span>` : '<span class="dh vacio">—</span>'}</td>
                    <td class="col-peso">${pesoLegible(a.peso)}</td>
                    <td class="celda-oculta-movil" title="${esc(a.subidoPor || '')}">${esc(quien(a.subidoPor))}</td>
                    <td>${esc(fechaLegible(a.subidoEn))}</td>
                    <td class="col-acciones">
                        <div class="acciones">
                            <button data-bajar="${esc(a.id)}" title="Descargar"><svg class="ico"><use href="#i-down"/></svg></button>
                            <button data-ver="${esc(a.id)}" title="Ver grande"><svg class="ico"><use href="#i-eye"/></svg></button>
                            <button class="peligro" data-borrar="${esc(a.id)}" title="Borrar"><svg class="ico"><use href="#i-trash"/></svg></button>
                        </div>
                    </td>
                </tr>`).join('')}
        </tbody>
    </table>`;
}

function pintarCuadricula(lista) {
    return `<div class="cuadricula">
        ${lista.map(a => `
            <article class="tarjeta" data-sel="${state.seleccion.has(a.id) ? 1 : 0}">
                <div class="tarjeta-mini" data-ver="${esc(a.id)}">
                    ${a.thumbUrl ? `<img src="${esc(a.thumbUrl)}" alt="" loading="lazy">` : '<div class="mini-vacia">SVG</div>'}
                    <label class="tarjeta-check">
                        <input type="checkbox" data-marcar="${esc(a.id)}" ${state.seleccion.has(a.id) ? 'checked' : ''} aria-label="Seleccionar ${esc(a.nombre)}">
                    </label>
                </div>
                <div class="tarjeta-cuerpo">
                    <div class="n" title="${esc(a.nombre)}">${esc(a.nombre)}</div>
                    <div class="tarjeta-meta">
                        ${a.dh ? `<span class="dh">${esc(a.dh)}</span>` : ''}
                        <span>${esc(fechaLegible(a.subidoEn))}</span>
                    </div>
                </div>
                <div class="tarjeta-pie">
                    <button data-bajar="${esc(a.id)}"><svg class="ico"><use href="#i-down"/></svg> Descargar</button>
                    <button data-borrar="${esc(a.id)}" title="Borrar"><svg class="ico"><use href="#i-trash"/></svg></button>
                </div>
            </article>`).join('')}
    </div>`;
}

function pintar() {
    pintarCarpetas();
    const lista = visibles();
    pintarRuta(lista);

    const contenido = $('contenido');
    if (state.cargando) {
        contenido.innerHTML = '<div class="cargando">Cargando archivos…</div>';
    } else if (!state.archivos.length) {
        contenido.innerHTML = `<div class="vacio-total">
            <b>Todavía no hay archivos de corte</b>
            Sube los SVG y aquí quedan, con miniatura, para quien esté en la máquina.
            <div><button id="btnSubirVacio">Subir el primero</button></div>
        </div>`;
    } else if (!lista.length) {
        contenido.innerHTML = `<div class="vacio-total">
            <b>Nada coincide</b>
            ${state.busqueda ? `No hay archivos que digan “${esc(state.busqueda)}”.` : 'Ese filtro está vacío.'}
        </div>`;
    } else {
        contenido.innerHTML = state.vista === 'lista' ? pintarLista(lista) : pintarCuadricula(lista);
    }

    // La selección solo tiene sentido sobre lo que se ve; si filtras, se recorta sola.
    const idsVisibles = new Set(lista.map(a => a.id));
    for (const id of state.seleccion) if (!idsVisibles.has(id)) state.seleccion.delete(id);

    const n = state.seleccion.size;
    $('barraSeleccion').classList.toggle('oculto', n === 0);
    $('textoSeleccion').textContent = `${n} seleccionado${n === 1 ? '' : 's'}`;
    $('btnLimpiar').classList.toggle('oculto', !state.busqueda);
}

// ===================== ACCIONES =====================

const buscar = id => state.archivos.find(a => a.id === id);

async function descargar(id) {
    const a = buscar(id);
    if (!a) return;
    try {
        avisar(`Preparando <b>${esc(a.nombre)}</b>…`);
        const res = await api(`/api/corte/archivo/${encodeURIComponent(id)}`);
        guardar(await res.blob(), a.nombre);
        avisar(`Descargado <b>${esc(a.nombre)}</b>`);
    } catch (error) {
        avisar(`No se pudo descargar: ${esc(error.message)}`, true);
    }
}

async function descargarZip() {
    const ids = [...state.seleccion];
    if (!ids.length) return;
    try {
        avisar(`Armando el ZIP con ${ids.length} archivo${ids.length === 1 ? '' : 's'}…`);
        const res = await api('/api/corte/zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        const hoy = new Date().toISOString().slice(0, 10);
        guardar(await res.blob(), `corte-${hoy}.zip`);
        avisar(`ZIP listo con ${ids.length} archivo${ids.length === 1 ? '' : 's'}`);
    } catch (error) {
        avisar(`No se pudo armar el ZIP: ${esc(error.message)}`, true);
    }
}

async function borrar(ids) {
    const lista = ids.map(buscar).filter(Boolean);
    if (!lista.length) return;
    const mensaje = lista.length === 1
        ? `¿Borrar "${lista[0].nombre}"?\n\nSe va del servidor y no se puede deshacer.`
        : `¿Borrar ${lista.length} archivos?\n\nSe van del servidor y no se puede deshacer.`;
    if (!confirm(mensaje)) return;

    let borrados = 0;
    for (const a of lista) {
        try {
            await api(`/api/corte/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
            state.archivos = state.archivos.filter(x => x.id !== a.id);
            state.seleccion.delete(a.id);
            borrados++;
        } catch (error) {
            avisar(`No se pudo borrar ${esc(a.nombre)}: ${esc(error.message)}`, true);
        }
    }
    if (borrados) avisar(`${borrados} archivo${borrados === 1 ? '' : 's'} borrado${borrados === 1 ? '' : 's'}`);
    cerrarVisor();
    pintar();
}

async function subir(archivos) {
    const svgs = [...archivos].filter(f => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml');
    if (!svgs.length) {
        avisar('Solo se pueden subir archivos .svg — es lo que lee la máquina.', true);
        return;
    }
    if (state.subiendo) return;

    state.subiendo = true;
    $('btnSubir').disabled = true;
    avisar(`Subiendo ${svgs.length} archivo${svgs.length === 1 ? '' : 's'}…`);

    // De 20 en 20: es el tope del servidor por petición (multer).
    const lotes = [];
    for (let i = 0; i < svgs.length; i += 20) lotes.push(svgs.slice(i, i + 20));

    let subidos = 0, duplicados = 0, rechazados = [];
    try {
        for (const lote of lotes) {
            const form = new FormData();
            lote.forEach(f => form.append('archivos', f, f.name));
            const res = await api('/api/corte', { method: 'POST', body: form });
            const datos = await res.json();
            state.archivos = [...(datos.subidos || []), ...state.archivos];
            subidos += (datos.subidos || []).length;
            duplicados += (datos.duplicados || []).length;
            rechazados = rechazados.concat(datos.rechazados || []);
        }

        const partes = [];
        if (subidos) partes.push(`<b>${subidos}</b> subido${subidos === 1 ? '' : 's'}`);
        if (duplicados) partes.push(`${duplicados} ya estaba${duplicados === 1 ? '' : 'n'}`);
        if (rechazados.length) partes.push(`${rechazados.length} rechazado${rechazados.length === 1 ? '' : 's'}`);
        avisar(partes.join(' · ') || 'Nada que subir', rechazados.length > 0 && !subidos);
    } catch (error) {
        avisar(`Falló la subida: ${esc(error.message)}`, true);
    }

    state.subiendo = false;
    $('btnSubir').disabled = false;
    pintar();
}

// ===================== VISOR =====================

let visorId = null;
let visorBlobUrl = null;

function abrirVisor(id) {
    const a = buscar(id);
    if (!a) return;
    visorId = id;
    $('visorNombre').textContent = a.nombre;
    $('visorDatos').innerHTML = [
        a.dh ? `<span class="dh">${esc(a.dh)}</span>` : '',
        `<span>${esc(a.medidas || 'sin medidas')}</span>`,
        `<span>${pesoLegible(a.peso)}</span>`,
        `<span>${esc(a.subidoPor || '—')}</span>`,
        `<span>${esc(fechaLegible(a.subidoEn))}</span>`,
    ].filter(Boolean).join('');

    // Primero la miniatura (instantánea) y encima el SVG real cuando llegue: se ve nítido
    // a cualquier tamaño, que es justo para lo que sirve abrir grande antes de cortar.
    const img = $('visorImagen');
    img.src = a.thumbUrl || '';
    $('visor').classList.remove('oculto');

    api(`/api/corte/archivo/${encodeURIComponent(id)}`)
        .then(res => res.blob())
        .then(blob => {
            if (visorId !== id) return;
            if (visorBlobUrl) URL.revokeObjectURL(visorBlobUrl);
            visorBlobUrl = URL.createObjectURL(blob);
            img.src = visorBlobUrl;
        })
        .catch(() => { /* se queda la miniatura: suficiente para reconocerlo */ });
}

function cerrarVisor() {
    $('visor').classList.add('oculto');
    visorId = null;
    if (visorBlobUrl) { URL.revokeObjectURL(visorBlobUrl); visorBlobUrl = null; }
}

// ===================== EVENTOS =====================

$('btnSubir').addEventListener('click', () => $('inputArchivos').click());
$('inputArchivos').addEventListener('change', e => {
    if (e.target.files.length) subir(e.target.files);
    e.target.value = '';
});

$('inputBuscar').addEventListener('input', e => { state.busqueda = e.target.value; pintar(); });
$('btnLimpiar').addEventListener('click', () => {
    state.busqueda = '';
    $('inputBuscar').value = '';
    $('inputBuscar').focus();
    pintar();
});

$('btnLista').addEventListener('click', () => cambiarVista('lista'));
$('btnCuadricula').addEventListener('click', () => cambiarVista('cuadricula'));
function cambiarVista(vista) {
    state.vista = vista;
    $('btnLista').setAttribute('aria-pressed', String(vista === 'lista'));
    $('btnCuadricula').setAttribute('aria-pressed', String(vista === 'cuadricula'));
    pintar();
}

$('carpetas').addEventListener('click', e => {
    const boton = e.target.closest('[data-filtro]');
    if (!boton) return;
    state.filtro = boton.dataset.filtro;
    pintar();
});

$('contenido').addEventListener('click', e => {
    const bajar = e.target.closest('[data-bajar]');
    if (bajar) return descargar(bajar.dataset.bajar);

    const borrarUno = e.target.closest('[data-borrar]');
    if (borrarUno) return borrar([borrarUno.dataset.borrar]);

    const ver = e.target.closest('[data-ver]');
    if (ver) return abrirVisor(ver.dataset.ver);

    const cabecera = e.target.closest('[data-orden]');
    if (cabecera) return ordenarPor(cabecera.dataset.orden);

    if (e.target.id === 'btnSubirVacio') $('inputArchivos').click();
});

$('contenido').addEventListener('change', e => {
    if (e.target.matches('[data-marcar]')) {
        const id = e.target.dataset.marcar;
        e.target.checked ? state.seleccion.add(id) : state.seleccion.delete(id);
        pintar();
    }
    if (e.target.id === 'checkTodos') {
        const lista = visibles();
        e.target.checked ? lista.forEach(a => state.seleccion.add(a.id)) : state.seleccion.clear();
        pintar();
    }
});

$('btnZip').addEventListener('click', descargarZip);
$('btnBorrarVarios').addEventListener('click', () => borrar([...state.seleccion]));
$('btnQuitarSeleccion').addEventListener('click', () => { state.seleccion.clear(); pintar(); });

$('visorCerrar').addEventListener('click', cerrarVisor);
$('visorDescargar').addEventListener('click', () => visorId && descargar(visorId));
$('visorBorrar').addEventListener('click', () => visorId && borrar([visorId]));
$('visor').addEventListener('click', e => { if (e.target.id === 'visor') cerrarVisor(); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('visor').classList.contains('oculto')) cerrarVisor();
});

// --- Arrastrar y soltar sobre cualquier parte de la pantalla ---
let arrastres = 0;
const traeArchivos = e => [...(e.dataTransfer?.types || [])].includes('Files');

window.addEventListener('dragenter', e => {
    if (!traeArchivos(e) || $('seccionApp').classList.contains('oculto')) return;
    e.preventDefault();
    arrastres++;
    $('zonaSoltar').classList.add('activa');
});
window.addEventListener('dragover', e => { if (traeArchivos(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
    arrastres = Math.max(0, arrastres - 1);
    if (!arrastres) $('zonaSoltar').classList.remove('activa');
});
window.addEventListener('drop', e => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    arrastres = 0;
    $('zonaSoltar').classList.remove('activa');
    if (e.dataTransfer.files.length) subir(e.dataTransfer.files);
});
