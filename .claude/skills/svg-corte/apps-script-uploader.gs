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
    } else {
      var bytes = Utilities.base64Decode(body.b64);
      var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.name || 'archivo');
      var folder = DriveApp.getFolderById(body.folderId || FOLDER_ID);
      var file = folder.createFile(blob);
      out = { ok: true, id: file.getId(), name: file.getName(), webViewLink: file.getUrl() };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
