/**
 * Build pipeline para el frontend Next.js.
 *
 * Render lo ejecuta como Build Command:  npm install && npm run build
 *
 * Pasos:
 *   1. Instala dependencias de nextjs-app/
 *   2. Hace next build (static export -> nextjs-app/out/)
 *   3. Copia el output a public/nextjs/ (de donde Express lo sirve)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const NEXTJS_DIR = path.join(ROOT, "nextjs-app");
const SOURCE = path.join(NEXTJS_DIR, "out");
const DEST = path.join(ROOT, "public", "nextjs");

function run(cmd, cwd, env = process.env) {
  console.log(`\n> ${cmd}  (cwd: ${path.relative(ROOT, cwd) || "."})`);
  execSync(cmd, { cwd, stdio: "inherit", env });
}

// Install incluyendo devDependencies (tailwind/postcss/typescript son necesarios para el build).
// No pasamos NODE_ENV=production aqui porque eso hace que npm omita devDependencies.
console.log("==> Installing nextjs-app dependencies");
run("npm ci --include=dev", NEXTJS_DIR);

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

console.log("\nDone. public/nextjs/ esta listo para que Express lo sirva.");
