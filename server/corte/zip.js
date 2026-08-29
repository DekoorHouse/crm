'use strict';
/**
 * ZIP mínimo en memoria — para que /corte pueda bajar varios SVG de un jalón.
 * -------------------------------------------------------------------
 * No usamos `archiver` ni `jszip` a propósito: un ZIP de unos cuantos SVG (texto que
 * comprime 5-10x) cabe de sobra en memoria y el formato que se necesita aquí es el
 * mínimo del estándar (sin zip64, sin cifrado, sin data descriptors). Meter una
 * dependencia nueva al deploy de Render por esto no se paga.
 *
 * Límite consciente: todo se arma en RAM, así que el router acota cuántos archivos
 * y cuántos MB se pueden pedir por ZIP (ver LIMITE_ZIP_BYTES en corteRoutes.js).
 */
const zlib = require('zlib');

const TABLA_CRC = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/** Fecha/hora en el formato MS-DOS que pide el ZIP (segundos con precisión de 2). */
function fechaDos(d) {
    const hora = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF;
    const fecha = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { hora, fecha };
}

/** Nombres únicos dentro del ZIP: dos pedidos pueden traer el mismo nombre de archivo. */
function nombresUnicos(entradas) {
    const usados = new Set();
    return entradas.map(e => {
        let nombre = String(e.nombre || 'archivo.svg').replace(/[\\/]/g, '_').replace(/^\.+/, '');
        if (!usados.has(nombre)) { usados.add(nombre); return { ...e, nombre }; }
        const punto = nombre.lastIndexOf('.');
        const base = punto > 0 ? nombre.slice(0, punto) : nombre;
        const ext = punto > 0 ? nombre.slice(punto) : '';
        let n = 2;
        while (usados.has(`${base} (${n})${ext}`)) n++;
        nombre = `${base} (${n})${ext}`;
        usados.add(nombre);
        return { ...e, nombre };
    });
}

/**
 * Arma un .zip con las entradas dadas.
 * @param {Array<{nombre:string, datos:Buffer, fecha?:Date}>} entradas
 * @returns {Buffer}
 */
function crearZip(entradas, ahora = new Date()) {
    const items = nombresUnicos(entradas);
    const locales = [];
    const central = [];
    let offset = 0;

    for (const item of items) {
        const nombre = Buffer.from(item.nombre, 'utf8');
        const datos = Buffer.isBuffer(item.datos) ? item.datos : Buffer.from(item.datos);
        const comprimido = zlib.deflateRawSync(datos, { level: 6 });
        // Si comprimir no ayuda (ya venía comprimido), se guarda tal cual.
        const usaDeflate = comprimido.length < datos.length;
        const cuerpo = usaDeflate ? comprimido : datos;
        const metodo = usaDeflate ? 8 : 0;
        const crc = crc32(datos);
        const { hora, fecha } = fechaDos(item.fecha instanceof Date ? item.fecha : ahora);

        const encabezado = Buffer.alloc(30);
        encabezado.writeUInt32LE(0x04034b50, 0);   // firma local
        encabezado.writeUInt16LE(20, 4);           // versión necesaria (2.0)
        encabezado.writeUInt16LE(0x0800, 6);       // bit 11: nombres en UTF-8
        encabezado.writeUInt16LE(metodo, 8);
        encabezado.writeUInt16LE(hora, 10);
        encabezado.writeUInt16LE(fecha, 12);
        encabezado.writeUInt32LE(crc, 14);
        encabezado.writeUInt32LE(cuerpo.length, 18);
        encabezado.writeUInt32LE(datos.length, 22);
        encabezado.writeUInt16LE(nombre.length, 26);
        encabezado.writeUInt16LE(0, 28);           // sin campo extra

        locales.push(encabezado, nombre, cuerpo);

        const entradaCentral = Buffer.alloc(46);
        entradaCentral.writeUInt32LE(0x02014b50, 0);
        entradaCentral.writeUInt16LE(20, 4);       // versión que lo creó
        entradaCentral.writeUInt16LE(20, 6);       // versión necesaria
        entradaCentral.writeUInt16LE(0x0800, 8);
        entradaCentral.writeUInt16LE(metodo, 10);
        entradaCentral.writeUInt16LE(hora, 12);
        entradaCentral.writeUInt16LE(fecha, 14);
        entradaCentral.writeUInt32LE(crc, 16);
        entradaCentral.writeUInt32LE(cuerpo.length, 20);
        entradaCentral.writeUInt32LE(datos.length, 24);
        entradaCentral.writeUInt16LE(nombre.length, 28);
        entradaCentral.writeUInt16LE(0, 30);       // extra
        entradaCentral.writeUInt16LE(0, 32);       // comentario
        entradaCentral.writeUInt16LE(0, 34);       // disco
        entradaCentral.writeUInt16LE(0, 36);       // atributos internos
        entradaCentral.writeUInt32LE(0, 38);       // atributos externos
        entradaCentral.writeUInt32LE(offset, 42);  // dónde empieza su encabezado local

        central.push(entradaCentral, nombre);
        offset += encabezado.length + nombre.length + cuerpo.length;
    }

    const directorio = Buffer.concat(central);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(0, 4);                  // disco actual
    fin.writeUInt16LE(0, 6);                  // disco del directorio
    fin.writeUInt16LE(items.length, 8);
    fin.writeUInt16LE(items.length, 10);
    fin.writeUInt32LE(directorio.length, 12);
    fin.writeUInt32LE(offset, 16);            // dónde empieza el directorio central
    fin.writeUInt16LE(0, 20);                 // sin comentario

    return Buffer.concat([...locales, directorio, fin]);
}

module.exports = { crearZip, crc32 };
