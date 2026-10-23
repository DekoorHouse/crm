// Apps Script "SVG Corte Uploader" — recibe un archivo por POST y lo guarda en la carpeta
// "SVG Corte" de Google Drive (ejecutandose como el dueno de la cuenta, con su cuota).
// Copia de referencia del codigo desplegado en script.google.com (implementacion: aplicacion
// web, "Ejecutar como: yo", "Acceso: cualquier persona"). Si se re-despliega, actualizar la
// URL en drive-webapp.json.
//
// Protegido con un secreto compartido (drive-webapp.json contiene el mismo valor).

var FOLDER_ID = '1FhMAUghuLI7u58hPJbV8ZWk9hJ5JOG4b'; // carpeta "SVG Corte"
var SECRET = 'f38f071a150e4c50a94c51e9d42cf75d1d962067c0cc4632';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      out = { ok: false, error: 'secreto invalido' };
    } else if (body.action === 'trash') {
      // Manda a la PAPELERA (no borra para siempre) un archivo que ya no se usa. Solo archivos que esten
      // dentro de la carpeta SVG Corte (u otra carpeta indicada): nunca otra cosa del Drive.
      var target = DriveApp.getFileById(body.id);
      var allowed = body.folderId || FOLDER_ID, parents = target.getParents(), inFolder = false;
      while (parents.hasNext()) { if (parents.next().getId() === allowed) { inFolder = true; break; } }
      if (!inFolder) {
        out = { ok: false, error: 'el archivo no esta en la carpeta SVG Corte' };
      } else {
        target.setTrashed(true);
        out = { ok: true, id: target.getId(), name: target.getName(), trashed: true };
      }
    } else if (body.action === 'thumbnail') {
      // Pone la miniatura a un archivo YA subido (para las hojas de antes). Solo dentro de la carpeta SVG Corte.
      var existing = DriveApp.getFileById(body.id), ps = existing.getParents(), mine = false;
      while (ps.hasNext()) { if (ps.next().getId() === (body.folderId || FOLDER_ID)) { mine = true; break; } }
      out = mine ? { ok: true, id: body.id, thumbnail: setThumbnail(body.id, body.thumbnail) } : { ok: false, error: 'el archivo no esta en la carpeta SVG Corte' };
    } else {
      var bytes = Utilities.base64Decode(body.b64);
      var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.name || 'archivo');
      var folder = DriveApp.getFolderById(body.folderId || FOLDER_ID);
      var file = folder.createFile(blob);
      out = { ok: true, id: file.getId(), name: file.getName(), webViewLink: file.getUrl() };
      // Miniatura (PNG en base64) para que la carpeta muestre el diseño: Drive no la genera sola para estas hojas.
      // Si falla, la subida ya quedó hecha: solo se informa.
      if (body.thumbnail) out.thumbnail = setThumbnail(file.getId(), body.thumbnail);
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Requiere el servicio avanzado "Drive API" (v3) activado en el proyecto (Servicios → + → Drive API).
// Drive pide la imagen en base64 "URL-safe" y de máximo 2 MB. Devuelve 'ok' o el error (nunca lanza).
function setThumbnail(fileId, b64) {
  try {
    var urlSafe = String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    Drive.Files.update({ contentHints: { thumbnail: { image: urlSafe, mimeType: 'image/png' } } }, fileId);
    return 'ok';
  } catch (err) {
    return String(err);
  }
}
