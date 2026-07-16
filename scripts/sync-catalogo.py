# -*- coding: utf-8 -*-
"""
Sincroniza las fotos de C:/Users/chris/Pictures/IA Dekoor/Colecciones
hacia public/sitio/img/col/<coleccion>/ del sitio publico.

- Idempotente: cada foto se identifica por el hash md5 de su contenido;
  si ya fue convertida (sync-<hash>.webp existe) se salta.
- Convierte a webp (max 1200px, calidad 80).
- Imprime un JSON con los archivos NUEVOS para que Claude los nombre
  y los agregue al arreglo PHOTOS de coleccion/index.html.

Uso:  python scripts/sync-catalogo.py
"""
import hashlib
import io
import json
import os
import sys

from PIL import Image

SOURCE = r"C:\Users\chris\Pictures\IA Dekoor\Colecciones"
DEST_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "sitio", "img", "col")

# Carpeta local -> id de coleccion del sitio
FOLDER_MAP = {
    "Bebes y Niños": "ninos",
    "Empresas y Profesiones": "empresas",
    "Familia": "familia",
    "Graduación": "graduacion",
    "Mas Regalos": "cuadros",
    "Mascotas": "mascotas",
    "Memorial": "memorial",
    "Parejas": "pareja",
    "Religiosas": "religiosas",
}

EXTS = (".jpg", ".jpeg", ".png", ".webp")
MAX_SIDE = 1200
QUALITY = 80


def convert(src_path, dest_path):
    im = Image.open(src_path)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    w, h = im.size
    if max(w, h) > MAX_SIDE:
        ratio = MAX_SIDE / max(w, h)
        im = im.resize((round(w * ratio), round(h * ratio)), Image.LANCZOS)
    im.save(dest_path, "WEBP", quality=QUALITY, method=6)


def main():
    nuevos = []
    errores = []
    for folder, col_id in FOLDER_MAP.items():
        src_dir = os.path.join(SOURCE, folder)
        if not os.path.isdir(src_dir):
            continue
        dest_dir = os.path.join(DEST_BASE, col_id)
        os.makedirs(dest_dir, exist_ok=True)
        for fname in sorted(os.listdir(src_dir)):
            if not fname.lower().endswith(EXTS):
                continue
            src_path = os.path.join(src_dir, fname)
            with open(src_path, "rb") as f:
                h = hashlib.md5(f.read()).hexdigest()[:10]
            dest_name = "sync-%s.webp" % h
            dest_path = os.path.join(dest_dir, dest_name)
            if os.path.exists(dest_path):
                continue
            try:
                convert(src_path, dest_path)
                kb = os.path.getsize(dest_path) // 1024
                nuevos.append({"colId": col_id, "file": dest_name, "original": fname, "kb": kb,
                               "abs": dest_path})
            except Exception as e:
                errores.append({"original": fname, "error": str(e)})

    out = {"nuevos": nuevos, "errores": errores, "total_nuevos": len(nuevos)}
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    main()
