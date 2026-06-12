/**
 * Build pipeline para el frontend Next.js.
 *
 * Render lo ejecuta como Build Command:  npm install && npm run build
 *
 * El build de Next.js esta COMMITEADO en public/nextjs/ junto con
 * .build-meta.json, que guarda un hash del codigo fuente de nextjs-app/.
 * Si el hash actual coincide con el del build commiteado, este script
 * termina en menos de un segundo y el deploy solo paga el npm install
 * de la raiz. Si no coincide, reconstruye como fallback (lento en Render).
 *
 * Flujo local cuando toques nextjs-app/:
 *   npm run build                        # reconstruye public/nextjs/
 *   git add public/nextjs && git commit  # commitea el build actualizado
 *
 * Flags:
 *   --force   Reconstruir aunque el hash coincida.
 */

const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const NEXTJS_DIR = path.join(ROOT, "nextjs-app");
const SOURCE = path.join(NEXTJS_DIR, "out");
const DEST = path.join(ROOT, "public", "nextjs");
const META_FILE = path.join(DEST, ".build-meta.json");

// Entradas que NO cuentan como codigo fuente para el hash. Solo deben entrar
// archivos TRACKEADOS en git: lo gitignorado (generados como next-env.d.ts /
// tsconfig.tsbuildinfo, o .env* locales) no existe en el clone de Render y
// romperia la coincidencia del hash. Si cambias un .env local, usa --force.
const HASH_EXCLUDE = new Set(["node_modules", ".next", "out", "tsconfig.tsbuildinfo", "next-env.d.ts", ".DS_Store"]);

function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HASH_EXCLUDE.has(entry.name) || entry.name.startsWith(".env")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

// CRLF -> LF, para que el hash coincida entre Windows (local) y Linux (Render)
// aunque git autocrlf cambie los finales de linea al hacer checkout.
function normalizeEol(buf) {
  if (!buf.includes(0x0d)) return buf;
  return Buffer.from(buf.filter((b) => b !== 0x0d));
}

// Hash determinista del fuente: rutas relativas (separador "/") ordenadas + contenido.
function sourceHash() {
  const files = listSourceFiles(NEXTJS_DIR)
    .map((full) => ({ full, rel: path.relative(NEXTJS_DIR, full).split(path.sep).join("/") }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const hash = crypto.createHash("sha256");
  for (const { full, rel } of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(normalizeEol(fs.readFileSync(full)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  } catch {
    return null;
  }
}

function run(cmd, cwd, env = process.env) {
  console.log(`\n> ${cmd}  (cwd: ${path.relative(ROOT, cwd) || "."})`);
  execSync(cmd, { cwd, stdio: "inherit", env });
}

const force = process.argv.includes("--force");
const currentHash = sourceHash();
const meta = readMeta();
const isFresh = meta && meta.sourceHash === currentHash && fs.existsSync(path.join(DEST, "_next"));

if (isFresh && !force) {
  console.log("==> public/nextjs/ esta al dia con nextjs-app/ (hash coincide). Saltando build de Next.js.");
  process.exit(0);
}

if (!isFresh && process.env.RENDER) {
  console.warn(
    "\n!! ADVERTENCIA: public/nextjs/ esta desactualizado respecto a nextjs-app/.\n" +
    "!! Reconstruyendo en Render como fallback (esto hace el deploy lento).\n" +
    "!! Para deploys rapidos: corre `npm run build` localmente y commitea public/nextjs/.\n"
  );
}

// Install incluyendo devDependencies (tailwind/postcss/typescript son necesarios para el build).
// npm install (no npm ci): respeta node_modules existente, asi el fallback en Render
// aprovecha el build cache y localmente no reinstala nada.
console.log("==> Installing nextjs-app dependencies");
run("npm install --include=dev", NEXTJS_DIR);

// El next.config.ts solo activa output:export cuando NODE_ENV=production
console.log("\n==> Building Next.js (static export)");
run("npm run build", NEXTJS_DIR, { ...process.env, NODE_ENV: "production" });

if (!fs.existsSync(SOURCE)) {
  console.error(`\nERROR: build output not found at ${SOURCE}`);
  process.exit(1);
}

console.log(`\n==> Copying ${path.relative(ROOT, SOURCE)} -> ${path.relative(ROOT, DEST)}`);
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SOURCE, DEST, { recursive: true });

// Recalcular el hash DESPUES del build por si npm install ajusto el lockfile.
fs.writeFileSync(
  META_FILE,
  JSON.stringify({ sourceHash: sourceHash(), builtAt: new Date().toISOString(), node: process.version }, null, 2) + "\n"
);

console.log("\nDone. public/nextjs/ esta listo. Recuerda commitearlo junto con tus cambios de nextjs-app/.");
