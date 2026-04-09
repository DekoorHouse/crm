/**
 * Extrae y descifra cookies de un perfil de Chrome en Windows.
 * Usa DPAPI via PowerShell + AES-256-GCM para descifrar.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

/**
 * Obtiene la clave de encriptacion de Chrome desde Local State
 */
function getChromeKey(userDataDir) {
    const localStatePath = path.join(userDataDir, 'Local State');
    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const encryptedKeyB64 = localState.os_crypt.encrypted_key;
    const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');

    // Strip "DPAPI" prefix (5 bytes)
    const dpapiBlob = encryptedKey.slice(5);

    // Descifrar con DPAPI via PowerShell
    const b64Blob = dpapiBlob.toString('base64');
    const psFile = path.join(require('os').tmpdir(), 'dpapi_decrypt.ps1');
    const psContent = [
        'Add-Type -AssemblyName System.Security',
        "$blob = [Convert]::FromBase64String('" + b64Blob + "')",
        '$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
        '[Console]::Write([Convert]::ToBase64String($decrypted))'
    ].join('\r\n');
    fs.writeFileSync(psFile, psContent);
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { encoding: 'utf8', timeout: 15000 }).trim();
    fs.unlinkSync(psFile);
    return Buffer.from(result, 'base64');
}

/**
 * Descifra un valor de cookie encriptado por Chrome v80+
 */
function decryptCookieValue(encryptedValue, key) {
    if (!encryptedValue || encryptedValue.length < 15) return '';

    // Chrome v80+ encryption: "v10" + nonce(12) + ciphertext + tag(16)
    const prefix = encryptedValue.slice(0, 3).toString('utf8');
    if (prefix !== 'v10' && prefix !== 'v20') return '';

    const nonce = encryptedValue.slice(3, 15);
    const ciphertextAndTag = encryptedValue.slice(15);
    const tag = ciphertextAndTag.slice(-16);
    const ciphertext = ciphertextAndTag.slice(0, -16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}

/**
 * Extrae cookies de Facebook de un perfil de Chrome
 * @returns {Array} Cookies en formato Puppeteer
 */
function extractFacebookCookies(userDataDir, profileDir) {
    console.log('[COOKIES] Descifrando clave de Chrome...');
    const key = getChromeKey(userDataDir);
    console.log('[COOKIES] Clave OK (32 bytes)');

    let cookiesPath = path.join(userDataDir, profileDir, 'Network', 'Cookies');
    if (!fs.existsSync(cookiesPath)) cookiesPath = path.join(userDataDir, profileDir, 'Cookies');
    console.log('[COOKIES] Cookies DB:', cookiesPath);

    // Copiar cookies DB (Chrome tiene lock exclusivo, usar esentutl para bypass)
    const tempDb = path.join(require('os').tmpdir(), 'chrome_cookies_temp.db');
    try { fs.unlinkSync(tempDb); } catch (e) {}
    execSync(`esentutl /y "${cookiesPath}" /d "${tempDb}"`, { stdio: 'ignore', timeout: 10000 });
    console.log('[COOKIES] DB copiada');

    const db = new Database(tempDb, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
        SELECT host_key, name, path, encrypted_value, is_secure, is_httponly,
               expires_utc, samesite
        FROM cookies
        WHERE host_key LIKE '%facebook.com' OR host_key LIKE '%fbcdn.net'
    `).all();
    db.close();
    try { fs.unlinkSync(tempDb); } catch (e) {}

    const cookies = [];
    for (const row of rows) {
        const value = decryptCookieValue(row.encrypted_value, key);
        if (!value) continue;

        cookies.push({
            name: row.name,
            value,
            domain: row.host_key,
            path: row.path,
            secure: !!row.is_secure,
            httpOnly: !!row.is_httponly,
            sameSite: ['None', 'Lax', 'Strict'][row.samesite] || 'None',
            expires: row.expires_utc ? (row.expires_utc / 1000000 - 11644473600) : -1
        });
    }
    console.log(`[COOKIES] ${cookies.length} cookies de Facebook extraidas`);
    return cookies;
}

module.exports = { extractFacebookCookies };
