<#
  start.ps1 - Arranque diario del CRM Dekoor

  Hace lo que hay que hacer al sentarse a trabajar, en orden:
    1. Avisa si dejaste cambios sin commitear (esos NO viajan a tus otras PCs).
    2. git pull --ff-only  (trae lo que hiciste desde otra computadora o la nube).
    3. npm install         SOLO si el pull toco package.json o falta node_modules.
    4. Revisa que exista serviceAccountKey.json (sin el, el servidor no arranca).
    5. npm start           (los schedulers quedan APAGADOS en local; ver .env.example).

  Uso:
    .\start.ps1              sincroniza y levanta el servidor
    .\start.ps1 -NoStart     solo sincroniza, no levanta nada
    .\start.ps1 -All         ademas instala dependencias de nextjs-app y functions

  Si Windows bloquea el script por la politica de ejecucion, corre una vez:
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>

[CmdletBinding()]
param(
    [switch]$NoStart,
    [switch]$All
)

# Los comandos nativos (git, npm) reportan fallos por exit code, no por excepcion.
# Con 'Stop' cualquier linea que git escriba en stderr abortaria el script sin razon.
$ErrorActionPreference = 'Continue'

Set-Location -Path $PSScriptRoot

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok  ($msg) { Write-Host "    OK   $msg" -ForegroundColor Green }
function Write-Note($msg) { Write-Host "    -    $msg" -ForegroundColor Gray }
function Write-Warn($msg) { Write-Host "    !    $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    X    $msg" -ForegroundColor Red }

# ---------------------------------------------------------------- 1. estado local
Write-Step "Revisando el estado local"

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Esta carpeta no es un repositorio git. Abortando."
    exit 1
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Note "Rama actual: $branch"

$dirty = git status --porcelain
if ($dirty) {
    Write-Warn "Tienes cambios sin commitear. No viajan a tus otras computadoras:"
    $dirty | Select-Object -First 15 | ForEach-Object { Write-Host "         $_" -ForegroundColor Yellow }
    $extra = ($dirty | Measure-Object).Count - 15
    if ($extra -gt 0) { Write-Host "         ... y $extra mas" -ForegroundColor Yellow }
    Write-Warn "Recuerda hacer commit y push antes de cambiar de PC."
} else {
    Write-Ok "Sin cambios pendientes."
}

# ---------------------------------------------------------------- 2. pull
Write-Step "Trayendo cambios de GitHub"

$before = (git rev-parse HEAD).Trim()

git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Fail "El pull no se pudo hacer en linea recta (fast-forward)."
    Write-Note "Suele pasar por una de dos razones:"
    Write-Note "  a) Hiciste commits aqui que no estan en GitHub  -> git push"
    Write-Note "  b) Hay cambios locales que estorban            -> git stash"
    Write-Note "Resuelve y vuelve a correr este script. No levanto el servidor."
    exit 1
}

$after = (git rev-parse HEAD).Trim()

if ($before -eq $after) {
    Write-Ok "Ya estabas al dia."
    $changed = @()
} else {
    $nuevos = (git rev-list --count "$before..$after").Trim()
    Write-Ok "$nuevos commit(s) nuevos: $($before.Substring(0,8)) -> $($after.Substring(0,8))"
    $changed = git diff --name-only $before $after
}

# ---------------------------------------------------------------- 3. dependencias
Write-Step "Revisando dependencias"

# Un proyecto necesita install si el pull toco su package.json / lock, o si nunca se instalo.
function Sync-Deps($nombre, $ruta) {
    $manifest = if ($ruta -eq '.') { 'package.json' } else { "$ruta/package.json" }
    $lock     = if ($ruta -eq '.') { 'package-lock.json' } else { "$ruta/package-lock.json" }
    $modules  = Join-Path $ruta 'node_modules'

    if (-not (Test-Path (Join-Path $ruta 'package.json'))) {
        Write-Note "$nombre : no tiene package.json, lo salto."
        return
    }

    $tocado = $changed -contains $manifest -or $changed -contains $lock
    $falta  = -not (Test-Path $modules)

    if (-not $tocado -and -not $falta) {
        Write-Ok "$nombre : al dia, no hace falta instalar."
        return
    }

    if ($falta) { Write-Note "$nombre : falta node_modules." }
    if ($tocado) { Write-Note "$nombre : el pull cambio package.json." }
    Write-Note "$nombre : instalando (puede tardar varios minutos)..."

    Push-Location $ruta
    npm install --no-audit --no-fund
    $code = $LASTEXITCODE
    Pop-Location

    if ($code -ne 0) {
        Write-Fail "$nombre : npm install fallo (exit $code)."
        exit 1
    }
    Write-Ok "$nombre : dependencias listas."
}

Sync-Deps "raiz" "."
if ($All) {
    Sync-Deps "nextjs-app" "nextjs-app"
    Sync-Deps "functions"  "functions"
} else {
    Write-Note "nextjs-app y functions omitidos. Usa -All si los necesitas."
}

# ---------------------------------------------------------------- 4. credenciales
Write-Step "Revisando credenciales"

$tieneLlave = Test-Path 'serviceAccountKey.json'
$tieneEnv   = Test-Path '.env'

if ($tieneLlave) {
    Write-Ok "serviceAccountKey.json presente."
} elseif ($tieneEnv) {
    Write-Note ".env presente (se asume FIREBASE_SERVICE_ACCOUNT_JSON adentro)."
} else {
    Write-Fail "No hay serviceAccountKey.json ni .env. El servidor no va a arrancar."
    Write-Note "Descarga la llave en Firebase Console > Configuracion del proyecto >"
    Write-Note "Cuentas de servicio > Generar nueva clave privada, y guardala como"
    Write-Note "serviceAccountKey.json en: $PSScriptRoot"
    Write-Note "(Esta en .gitignore: nunca se sube al repo.)"
    exit 1
}

if (-not $tieneEnv) {
    Write-Note "Sin .env: WhatsApp, Gemini y Mercado Pago no van a responder."
    Write-Note "Copia .env.example a .env si necesitas esas funciones."
}

# ---------------------------------------------------------------- 5. arranque
if ($NoStart) {
    Write-Step "Listo (-NoStart, no levanto el servidor)"
    exit 0
}

Write-Step "Levantando el servidor en http://localhost:3000"
Write-Note "Los schedulers quedan APAGADOS en local para no escribir en la BD de"
Write-Note "produccion. Se encienden solos en Render. Ctrl+C para detener."
Write-Host ""

npm start
