# Arranque del pod de Qwen Image 2.1 (lo crea qwenPod.js en RunPod con la imagen runpod/stable-diffusion:comfy-ui-6.0.0).
# Deja ComfyUI en 127.0.0.1:8188 y expone en el puerto 3000 un proxy que solo acepta el header X-Dekoor-Token.
# Recetas probadas a mano el 24-sep-2026: ComfyUI viene en /ComfyUI sin rama, y su torch 2.6 ya no sirve.
set -uo pipefail
exec > >(tee -a /tmp/dekoor_boot.log) 2>&1
stage() { echo "$1" > /tmp/dekoor_stage; echo "[dekoor] $(date +%T) $1"; }
PY=/usr/bin/python3.10
MODELS=/ComfyUI/models
HF=https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main

cat > /dekoor_proxy.py <<'PYEOF'
import glob, hmac, json, os, re, subprocess
import aiohttp
from aiohttp import web
TOKEN = os.environ['DEKOOR_TOKEN']
UPSTREAM = 'http://127.0.0.1:8188'

# Borra todo rastro de una imagen del CRM en el pod: sus archivos (crm_<id>...) y su entrada del historial de ComfyUI.
async def purge(request, session):
    prefix = (await request.json()).get('prefix', '')
    if not re.fullmatch(r'crm_[0-9a-fA-F-]{36}', prefix):
        return web.json_response({'error': 'prefijo no valido'}, status=400)
    removed = 0
    for folder in ('/ComfyUI/input', '/ComfyUI/output', '/ComfyUI/temp'):
        for path in glob.glob(os.path.join(folder, glob.escape(prefix) + '*')):
            os.remove(path)
            removed += 1
    async with session.get(UPSTREAM + '/history') as response:
        history = await response.json()
    ids = [pid for pid, entry in history.items() if prefix in json.dumps(entry.get('prompt', [])) or prefix in json.dumps(entry.get('outputs', {}))]
    if ids:
        async with session.post(UPSTREAM + '/history', json={'delete': ids}):
            pass
    return web.json_response({'removed': removed, 'history': len(ids)})

async def handle(request):
    if not hmac.compare_digest(request.headers.get('X-Dekoor-Token', ''), TOKEN):
        return web.Response(status=401)
    session = request.app['session']
    if request.path == '/dekoor/purge' and request.method == 'POST':
        return await purge(request, session)
    if request.path == '/dekoor/health':
        stage = open('/tmp/dekoor_stage').read().strip() if os.path.exists('/tmp/dekoor_stage') else 'iniciando'
        try:
            async with session.get(UPSTREAM + '/system_stats', timeout=aiohttp.ClientTimeout(total=5)) as response:
                return web.json_response({'ready': response.status == 200, 'stage': stage})
        except Exception:
            tail = subprocess.run(['tail', '-3', '/tmp/dekoor_boot.log'], capture_output=True, text=True).stdout
            return web.json_response({'ready': False, 'stage': stage, 'log': tail[-600:]})
    headers = {k: v for k, v in request.headers.items() if k.lower() == 'content-type'}
    async with session.request(request.method, UPSTREAM + request.path_qs, data=await request.read(), headers=headers) as response:
        return web.Response(status=response.status, body=await response.read(), headers={'Content-Type': response.headers.get('Content-Type', 'application/octet-stream')})

async def start(app): app['session'] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=300))
async def stop(app): await app['session'].close()
app = web.Application(client_max_size=64 * 1024 * 1024)
app.on_startup.append(start); app.on_cleanup.append(stop)
app.router.add_route('*', '/{tail:.*}', handle)
web.run_app(app, host='0.0.0.0', port=3000, print=None)
PYEOF

stage 'iniciando'
$PY /dekoor_proxy.py &

stage 'actualizando ComfyUI'
cd /ComfyUI && git fetch -q origin && git checkout -q "$COMFY_COMMIT" || { stage 'error: no se pudo actualizar ComfyUI'; sleep infinity; }
$PY -m pip install -q -r requirements.txt < /dev/null
stage 'instalando PyTorch'
$PY -m pip install -q "torch==$TORCH_VERSION" torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128 < /dev/null

stage 'descargando modelos'
command -v aria2c > /dev/null || { apt-get update -qq && apt-get install -y -qq aria2; } < /dev/null
for f in diffusion_models/qwen_image_2.1_int8_convrot.safetensors text_encoders/qwen3vl_8b_int8_convrot.safetensors vae/qwen_image_2.1_vae_bf16.safetensors; do
  aria2c -c -x 16 -s 16 --console-log-level=warn --summary-interval=0 -d "$MODELS/$(dirname "$f")" -o "$(basename "$f")" "$HF/$f" < /dev/null \
    || { stage "error: no se pudo descargar $(basename "$f")"; sleep infinity; }
done

stage 'cargando ComfyUI'
$PY main.py --listen 127.0.0.1 --port 8188 < /dev/null &
COMFY_PID=$!
wait $COMFY_PID
stage 'error: ComfyUI se detuvo'
sleep infinity
