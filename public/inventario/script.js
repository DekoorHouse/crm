import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore, collection, doc, getDocs, setDoc, addDoc, updateDoc,
    deleteDoc, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// Catálogo de productos: viene del mismo array usado en el modal de pedidos.
// Si en el futuro se mueve a Firestore, basta con cargarlo desde ahí.
const PRODUCTOS_CATALOGO = ['Spiderman', 'Rex', 'Guerreras', 'Muerto', 'Corazón', 'Mario', 'Sonic', 'Especial'];

// Estado en memoria
const state = {
    materiales: [],          // [{ id, nombre, unidad, stockActual, ... }]
    materialesById: new Map(),
    bomByProducto: new Map(), // producto -> { componentes: [{materialId, cantidad}] }
    recetaActual: null,       // producto que se edita en el modal de receta
};

// --- Helpers ---
const $ = (id) => document.getElementById(id);

function toast(msg, type = '') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    setTimeout(() => { el.className = 'toast'; }, 2500);
}

function fmtNum(n) {
    if (n === null || n === undefined || n === '') return '';
    const num = Number(n);
    if (!isFinite(num)) return '';
    return num.toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function fmtMoney(n) {
    const num = Number(n);
    if (!isFinite(num) || num === 0) return '';
    return '$' + num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- Auth ---
$('formularioLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('mensajeError').textContent = '';
    try {
        await signInWithEmailAndPassword(auth, $('email').value, $('password').value);
    } catch {
        $('mensajeError').textContent = 'Credenciales incorrectas.';
    }
});

$('btnCerrarSesion').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    $('loading-overlay').style.display = 'none';
    if (user) {
        $('seccionLogin').style.display = 'none';
        $('seccionApp').style.display = 'block';
        $('usuarioLogueado').textContent = user.email;
        await Promise.all([cargarMateriales(), cargarBOMs()]);
        renderRecetas();
    } else {
        $('seccionLogin').style.display = 'block';
        $('seccionApp').style.display = 'none';
    }
});

// --- Tabs ---
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        $('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// ============================================
// MATERIALES
// ============================================

async function cargarMateriales() {
    try {
        const snap = await getDocs(query(collection(db, 'materiales'), orderBy('nombre')));
        state.materiales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.materialesById = new Map(state.materiales.map(m => [m.id, m]));
        renderMateriales();
    } catch (err) {
        console.error('Error cargando materiales:', err);
        toast('Error al cargar materiales', 'error');
    }
}

function renderMateriales() {
    const tbody = $('tbodyMateriales');
    const filtro = ($('busquedaMaterial').value || '').toLowerCase().trim();
    const lista = filtro
        ? state.materiales.filter(m => (m.nombre || '').toLowerCase().includes(filtro))
        : state.materiales;

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty">${filtro ? 'Sin resultados' : 'Aún no hay materiales. Crea el primero con "Nuevo material".'}</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(m => {
        const stock = Number(m.stockActual) || 0;
        const minimo = Number(m.stockMinimo) || 0;
        const multiplo = Math.max(1, Number(m.multiploCompra) || 1);
        const stockClass = stock <= 0 ? 'stock-low' : (minimo > 0 && stock <= minimo ? 'stock-warn' : '');
        const multiploTxt = multiplo > 1 ? `pack ${multiplo}` : '—';
        return `
            <tr>
                <td><strong>${escapeHtml(m.nombre)}</strong></td>
                <td>${escapeHtml(m.unidad || '')}</td>
                <td class="num ${stockClass}">${fmtNum(stock)}</td>
                <td class="num">${fmtNum(minimo)}</td>
                <td class="num">${fmtNum(m.bufferPct || 0)}%</td>
                <td class="num">${multiploTxt}</td>
                <td>${escapeHtml(m.proveedor || '')}</td>
                <td class="num">${fmtNum(m.leadTimeDias || 0)}</td>
                <td class="num">${fmtMoney(m.costoUnit || 0)}</td>
                <td>
                    <button class="btn-icon" data-edit="${m.id}" title="Editar"><i class="fas fa-pen"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => abrirModalMaterial(btn.dataset.edit));
    });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('busquedaMaterial').addEventListener('input', renderMateriales);
$('btnNuevoMaterial').addEventListener('click', () => abrirModalMaterial(null));

function abrirModalMaterial(materialId) {
    const m = materialId ? state.materialesById.get(materialId) : null;
    $('tituloModalMaterial').innerHTML = m
        ? `<i class="fas fa-cube"></i> Editar material`
        : `<i class="fas fa-cube"></i> Nuevo material`;
    $('materialId').value = m?.id || '';
    $('materialNombre').value = m?.nombre || '';
    $('materialUnidad').value = m?.unidad || 'pieza';
    $('materialStock').value = m?.stockActual ?? 0;
    $('materialMinimo').value = m?.stockMinimo ?? 0;
    $('materialBuffer').value = m?.bufferPct ?? 20;
    $('materialMultiplo').value = Math.max(1, Number(m?.multiploCompra) || 1);
    $('materialPaquetesOrden').value = Math.max(0, parseInt(m?.paquetesPorOrden, 10) || 0);
    $('materialLead').value = m?.leadTimeDias ?? 3;
    $('materialCosto').value = m?.costoUnit ?? 0;
    $('materialProveedor').value = m?.proveedor || '';
    $('materialNotas').value = m?.notas || '';
    $('errorMaterial').textContent = '';
    $('btnEliminarMaterial').style.display = m ? 'inline-flex' : 'none';
    $('modalMaterial').style.display = 'flex';
}

function cerrarModalMaterial() {
    $('modalMaterial').style.display = 'none';
}

$('cerrarModalMaterial').addEventListener('click', cerrarModalMaterial);
$('cancelarModalMaterial').addEventListener('click', cerrarModalMaterial);

$('formMaterial').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('materialId').value;
    const data = {
        nombre: $('materialNombre').value.trim(),
        unidad: $('materialUnidad').value.trim() || 'pieza',
        stockActual: Number($('materialStock').value) || 0,
        stockMinimo: Number($('materialMinimo').value) || 0,
        bufferPct: Number($('materialBuffer').value) || 0,
        multiploCompra: Math.max(1, parseInt($('materialMultiplo').value, 10) || 1),
        paquetesPorOrden: Math.max(0, parseInt($('materialPaquetesOrden').value, 10) || 0),
        leadTimeDias: Number($('materialLead').value) || 0,
        costoUnit: Number($('materialCosto').value) || 0,
        proveedor: $('materialProveedor').value.trim(),
        notas: $('materialNotas').value.trim(),
        updatedAt: serverTimestamp(),
    };
    if (!data.nombre) {
        $('errorMaterial').textContent = 'El nombre es obligatorio.';
        return;
    }

    const btn = $('btnGuardarMaterial');
    btn.disabled = true;
    try {
        if (id) {
            await updateDoc(doc(db, 'materiales', id), data);
            toast('Material actualizado', 'success');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'materiales'), data);
            toast('Material creado', 'success');
        }
        cerrarModalMaterial();
        await cargarMateriales();
        renderRecetas(); // los nombres en cards de recetas pueden haber cambiado
    } catch (err) {
        console.error(err);
        $('errorMaterial').textContent = 'Error al guardar: ' + err.message;
    } finally {
        btn.disabled = false;
    }
});

$('btnEliminarMaterial').addEventListener('click', async () => {
    const id = $('materialId').value;
    if (!id) return;
    const m = state.materialesById.get(id);
    if (!confirm(`¿Eliminar "${m?.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
        await deleteDoc(doc(db, 'materiales', id));
        toast('Material eliminado', 'success');
        cerrarModalMaterial();
        await cargarMateriales();
        renderRecetas();
    } catch (err) {
        $('errorMaterial').textContent = 'Error al eliminar: ' + err.message;
    }
});

// ============================================
// RECETAS (BOM)
// ============================================

async function cargarBOMs() {
    try {
        const snap = await getDocs(collection(db, 'productos_bom'));
        state.bomByProducto = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    } catch (err) {
        console.error('Error cargando BOMs:', err);
    }
}

function renderRecetas() {
    const grid = $('recetasGrid');
    grid.innerHTML = PRODUCTOS_CATALOGO.map(producto => {
        const bom = state.bomByProducto.get(producto);
        const componentes = bom?.componentes || [];
        const statusClass = componentes.length > 0 ? 'defined' : 'empty';
        const statusText = componentes.length > 0
            ? `<i class="fas fa-check-circle"></i> ${componentes.length} material${componentes.length === 1 ? '' : 'es'}`
            : `<i class="fas fa-exclamation-circle"></i> Receta sin definir`;

        const lista = componentes.length > 0
            ? '<ul>' + componentes.map(c => {
                const m = state.materialesById.get(c.materialId);
                const nombre = m?.nombre || c.materialNombre || '(material no encontrado)';
                const unidad = m?.unidad || '';
                const escalaTxt = c.escala === 'por_pedido'
                    ? ' <span style="color:var(--color-warning);font-size:11px;">(por pedido)</span>'
                    : '';
                return `<li><strong>${fmtNum(c.cantidad)} ${escapeHtml(unidad)}</strong> de ${escapeHtml(nombre)}${escalaTxt}</li>`;
            }).join('') + '</ul>'
            : '';

        const copiarBtn = componentes.length > 0
            ? `<button class="btn btn-link" data-copiar="${escapeHtml(producto)}" style="width:100%; margin-top:6px;">
                    <i class="fas fa-copy"></i> Copiar receta a los demás productos
               </button>`
            : '';

        return `
            <div class="receta-card">
                <h3>${escapeHtml(producto)}</h3>
                <div class="receta-status ${statusClass}">${statusText}</div>
                ${lista}
                <button class="btn btn-secondary" data-receta="${escapeHtml(producto)}" style="width:100%;">
                    <i class="fas fa-pen"></i> ${componentes.length > 0 ? 'Editar' : 'Definir'} receta
                </button>
                ${copiarBtn}
            </div>
        `;
    }).join('');

    grid.querySelectorAll('[data-receta]').forEach(btn => {
        btn.addEventListener('click', () => abrirModalReceta(btn.dataset.receta));
    });
    grid.querySelectorAll('[data-copiar]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            copiarRecetaAOtros(btn.dataset.copiar);
        });
    });
}

async function copiarRecetaAOtros(productoOrigen) {
    const bomOrigen = state.bomByProducto.get(productoOrigen);
    if (!bomOrigen?.componentes?.length) {
        toast('La receta de origen está vacía', 'error');
        return;
    }

    const destinos = PRODUCTOS_CATALOGO.filter(p => {
        if (p === productoOrigen) return false;
        const existing = state.bomByProducto.get(p);
        return !existing || !existing.componentes || existing.componentes.length === 0;
    });

    if (destinos.length === 0) {
        toast('Todos los demás productos ya tienen receta. Usa "Editar" para sobrescribir.', '');
        return;
    }

    const msg = `Copiar la receta de "${productoOrigen}" a los siguientes ${destinos.length} producto(s)?\n\n• ${destinos.join('\n• ')}\n\n(No se sobrescribirán productos que ya tengan receta definida.)`;
    if (!confirm(msg)) return;

    try {
        await Promise.all(destinos.map(producto =>
            setDoc(doc(db, 'productos_bom', producto), {
                producto,
                componentes: bomOrigen.componentes.map(c => ({
                    materialId: c.materialId,
                    materialNombre: c.materialNombre || '',
                    cantidad: c.cantidad,
                    escala: c.escala === 'por_pedido' ? 'por_pedido' : 'por_unidad',
                })),
                updatedAt: serverTimestamp(),
            }, { merge: true })
        ));
        toast(`Receta copiada a ${destinos.length} producto(s)`, 'success');
        await cargarBOMs();
        renderRecetas();
    } catch (err) {
        console.error(err);
        toast('Error al copiar: ' + err.message, 'error');
    }
}

function abrirModalReceta(producto) {
    state.recetaActual = producto;
    $('tituloModalReceta').innerHTML = `<i class="fas fa-clipboard-list"></i> Receta: ${escapeHtml(producto)}`;
    const bom = state.bomByProducto.get(producto);
    const componentes = bom?.componentes || [];
    $('errorReceta').textContent = '';
    renderComponentesEditor(componentes);
    $('modalReceta').style.display = 'flex';
}

function cerrarModalReceta() {
    $('modalReceta').style.display = 'none';
    state.recetaActual = null;
}

$('cerrarModalReceta').addEventListener('click', cerrarModalReceta);
$('cancelarModalReceta').addEventListener('click', cerrarModalReceta);

function renderComponentesEditor(componentes) {
    const container = $('recetaComponentes');
    if (state.materiales.length === 0) {
        container.innerHTML = `<p class="info-text" style="padding:12px;background:var(--color-warning-light);border-radius:6px;">Primero crea materiales en la pestaña <strong>Materiales</strong>.</p>`;
        return;
    }

    if (componentes.length === 0) {
        container.innerHTML = '';
        agregarFilaComponente(); // arranca con una fila vacía
        return;
    }

    container.innerHTML = '';
    componentes.forEach(c => agregarFilaComponente(c));
}

function agregarFilaComponente(componente = null) {
    const container = $('recetaComponentes');
    const opciones = state.materiales
        .map(m => `<option value="${m.id}" ${componente?.materialId === m.id ? 'selected' : ''}>${escapeHtml(m.nombre)}</option>`)
        .join('');
    const escalaActual = componente?.escala === 'por_pedido' ? 'por_pedido' : 'por_unidad';
    const row = document.createElement('div');
    row.className = 'componente-row';
    row.innerHTML = `
        <div class="form-item">
            <label>Material:</label>
            <select class="comp-material">
                <option value="">Selecciona...</option>
                ${opciones}
            </select>
        </div>
        <div class="form-item">
            <label>Cantidad:</label>
            <input type="number" class="comp-cantidad" step="0.01" min="0" value="${componente?.cantidad ?? 1}">
        </div>
        <div class="form-item">
            <label>Escala:</label>
            <select class="comp-escala" title="Por unidad: multiplica por cada lámpara del pedido. Por pedido: una sola vez sin importar cuántas lámparas.">
                <option value="por_unidad" ${escalaActual === 'por_unidad' ? 'selected' : ''}>Por unidad</option>
                <option value="por_pedido" ${escalaActual === 'por_pedido' ? 'selected' : ''}>Por pedido</option>
            </select>
        </div>
        <div class="qty-unit comp-unidad">${unidadDe(componente?.materialId) || '—'}</div>
        <button type="button" class="btn-remove" title="Quitar"><i class="fas fa-times"></i></button>
    `;
    const sel = row.querySelector('.comp-material');
    const unitEl = row.querySelector('.comp-unidad');
    sel.addEventListener('change', () => {
        unitEl.textContent = unidadDe(sel.value) || '—';
    });
    row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function unidadDe(materialId) {
    if (!materialId) return '';
    return state.materialesById.get(materialId)?.unidad || '';
}

$('btnAgregarComponente').addEventListener('click', () => {
    if (state.materiales.length === 0) {
        toast('Primero crea materiales', 'error');
        return;
    }
    agregarFilaComponente();
});

$('btnGuardarReceta').addEventListener('click', async () => {
    const producto = state.recetaActual;
    if (!producto) return;

    const filas = $('recetaComponentes').querySelectorAll('.componente-row');
    const componentes = [];
    const seenIds = new Set();
    let invalido = false;

    filas.forEach(row => {
        const materialId = row.querySelector('.comp-material').value;
        const cantidad = Number(row.querySelector('.comp-cantidad').value);
        const escalaSel = row.querySelector('.comp-escala')?.value;
        const escala = escalaSel === 'por_pedido' ? 'por_pedido' : 'por_unidad';
        if (!materialId) return; // fila vacía
        if (!isFinite(cantidad) || cantidad <= 0) {
            invalido = true; return;
        }
        if (seenIds.has(materialId)) {
            invalido = true; return;
        }
        seenIds.add(materialId);
        const m = state.materialesById.get(materialId);
        componentes.push({
            materialId,
            materialNombre: m?.nombre || '',
            cantidad,
            escala,
        });
    });

    if (invalido) {
        $('errorReceta').textContent = 'Cantidades deben ser > 0 y los materiales no pueden repetirse.';
        return;
    }

    const btn = $('btnGuardarReceta');
    btn.disabled = true;
    try {
        await setDoc(doc(db, 'productos_bom', producto), {
            producto,
            componentes,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        toast('Receta guardada', 'success');
        cerrarModalReceta();
        await cargarBOMs();
        renderRecetas();
    } catch (err) {
        console.error(err);
        $('errorReceta').textContent = 'Error al guardar: ' + err.message;
    } finally {
        btn.disabled = false;
    }
});
