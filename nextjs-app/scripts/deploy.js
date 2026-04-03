/**
 * Deploy script: copies Next.js static export to public/pedidos-new/
 * Run with: npm run deploy (from nextjs-app directory)
 *
 * Once validated, to switch over:
 * 1. Rename public/pedidos/ → public/pedidos-legacy/
 * 2. Rename public/pedidos-new/ → public/pedidos/
 * 3. Update Express routes in server/index.js
 */

const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "out");
const DEST = path.join(__dirname, "..", "..", "public", "pedidos-new");

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Source not found: ${src}`);
    process.exit(1);
  }

  // Clean destination
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log("🚀 Deploying Next.js build to public/pedidos-new/...");
copyRecursive(SOURCE, DEST);

const fileCount = fs.readdirSync(DEST).length;
console.log(`✓ Deployed ${fileCount} items to public/pedidos-new/`);
console.log("");
console.log("Access the new app at: https://app.dekoormx.com/pedidos-new");
console.log("");
console.log("To switch over permanently:");
console.log("  1. Rename public/pedidos/ → public/pedidos-legacy/");
console.log("  2. Rename public/pedidos-new/ → public/pedidos/");
console.log("  3. Update routes in server/index.js");
