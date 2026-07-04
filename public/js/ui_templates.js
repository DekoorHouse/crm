// --- START: UI & VIEW TEMPLATES ---
// Este archivo contiene todas las funciones que generan el HTML para la aplicación.

// --- PLANTILLAS DE VISTAS PRINCIPALES ---

const ChatViewTemplate = () => `
    <div id="chat-view">
        <aside id="contacts-panel" class="w-full md:w-1/3 lg:w-1/4 h-full flex flex-col">
            <div class="p-4 border-b border-gray-200 relative">
                <input type="text" id="search-contacts-input" placeholder="Buscar o iniciar un nuevo chat..." class="w-full pr-8">
                <button id="clear-search-btn" class="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 hidden">
                    <i class="fas fa-times-circle"></i>
                </button>
            </div>
            <div id="tag-filters-container" class="p-2 flex flex-wrap gap-2 justify-center border-b border-[var(--color-border)] bg-[var(--color-container-bg)] items-center"></div>
            <div id="contacts-loading" class="p-4 text-center text-gray-400">Cargando contactos...</div>
            <div id="contacts-list" class="flex-1 overflow-y-auto" style="position:relative;">
                <div id="contacts-scroll-spacer" style="position:relative;"></div>
            </div>
        </aside>
        <section id="chat-panel" class="flex-1 flex flex-col relative"></section>
        <aside id="contact-details-panel"></aside>
    </div>
`;

const PipelineViewTemplate = () => `
    <div class="view-container !p-0 flex flex-col h-full">
        <div class="view-header !p-4 !mb-0 border-b border-gray-200">
            <h1>Pipeline de Ventas</h1>
        </div>
        <div id="pipeline-container" class="pipeline-container flex-1"></div>
    </div>
`;

const TagsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Etiquetas</h1>
            <div class="flex items-center gap-4">
                <button onclick="openTagModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar</button>
                <button onclick="handleDeleteAllTags()" class="btn btn-danger"><i class="fas fa-trash-alt mr-2"></i>Eliminar Todas</button>
            </div>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th class="w-10"></th>
                        <th>Nombre</th>
                        <th>Color</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="tags-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const DepartmentsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Gestión de Departamentos</h1>
            <button onclick="openDepartmentModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Departamento</button>
        </div>
        <p class="mb-6 text-gray-600">Crea departamentos (bandejas de entrada) para organizar tus chats y asignar agentes específicos.</p>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Color</th>
                        <th>Contactos</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="departments-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const AdRoutingViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Reglas de Enrutamiento de Ads</h1>
            <button onclick="openAdRoutingModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Regla</button>
        </div>
        <p class="mb-6 text-gray-600">Define a qué departamento deben llegar automáticamente los chats nuevos según el anuncio de origen (Ad ID).</p>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nombre de la Regla</th>
                        <th>Ad IDs</th>
                        <th>Departamento Destino</th>
                        <th>IA Activa</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="ad-routing-table-body"></tbody>
            </table>
        </div>
    </div>
`;

// Formulario constructor de plantillas de Meta (sub-pestaña "Crear plantilla")
const CreateTemplateFormTemplate = () => `
    <div class="template-builder">
      <div class="template-builder-form">
        <div class="ai-assist-box">
            <div class="ai-assist-title"><i class="fas fa-wand-magic-sparkles"></i> Generar con IA</div>
            <p class="ai-assist-desc">Describe para qué es la plantilla y la IA llenará todos los campos (con emojis). Puedes adjuntar una foto del producto para darle contexto.</p>
            <textarea id="ai-tpl-desc" rows="2" placeholder="Ej: Promoción 2x1 en lámparas LED para el Día del Padre, con un botón para comprar" class="!mb-2"></textarea>
            <div class="ai-assist-row">
                <label class="ai-assist-photo">
                    <input type="file" id="ai-tpl-photo" accept="image/*" onchange="onAiTemplatePhotoChange(event)" hidden>
                    <i class="fas fa-camera"></i> <span id="ai-tpl-photo-label">Adjuntar foto (opcional)</span>
                </label>
                <button type="button" id="ai-tpl-generate-btn" onclick="handleGenerateTemplateWithAI()" class="btn btn-primary btn-sm"><i class="fas fa-wand-magic-sparkles mr-1"></i> Generar</button>
            </div>
            <img id="ai-tpl-photo-preview" class="ai-tpl-photo-preview hidden" alt="foto adjunta">
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="tpl-name">Nombre de la plantilla</label>
            <input type="text" id="tpl-name" placeholder="ej. promo_dia_del_padre" oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,'_')" class="!mb-1">
            <p class="text-xs text-gray-400">Solo minúsculas, números y guion bajo. No se puede cambiar después.</p>
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div class="campaign-form-section">
                <label class="font-bold" for="tpl-language">Idioma</label>
                <select id="tpl-language" class="!mb-0">
                    <option value="es_MX">Español (México)</option>
                    <option value="es">Español</option>
                    <option value="en_US">Inglés (EE. UU.)</option>
                </select>
            </div>
            <div class="campaign-form-section">
                <label class="font-bold" for="tpl-category">Categoría</label>
                <select id="tpl-category" class="!mb-0">
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utilidad (Utility)</option>
                </select>
            </div>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="tpl-header-type">Cabecera (opcional)</label>
            <select id="tpl-header-type" onchange="onTemplateHeaderTypeChange()" class="!mb-2">
                <option value="NONE">Ninguna</option>
                <option value="TEXT">Texto</option>
                <option value="IMAGE">Imagen</option>
            </select>
            <input type="text" id="tpl-header-text" placeholder="Texto de la cabecera (máx. 60)" maxlength="60" oninput="updateTemplatePreview()" class="hidden !mb-0">
            <input type="text" id="tpl-header-image" placeholder="URL de una imagen de muestra (jpg/png)" oninput="updateTemplatePreview()" class="hidden !mb-0">
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="tpl-body">Cuerpo del mensaje *</label>
            <textarea id="tpl-body" rows="5" oninput="onTemplateBodyChange()" placeholder="Hola {{1}}, tu pedido {{2}} ya está listo para recoger. ¡Gracias por tu compra!" class="!mb-1"></textarea>
            <p class="text-xs text-gray-400">Usa {{1}}, {{2}}… para variables. Abajo escribe un ejemplo de cada una (Meta lo exige).</p>
            <div id="tpl-body-vars" class="space-y-2 mt-2"></div>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="tpl-footer">Pie de página (opcional)</label>
            <input type="text" id="tpl-footer" placeholder="ej. Dekoor · Responde BAJA para no recibir más" maxlength="60" oninput="updateTemplatePreview()" class="!mb-0">
        </div>

        <div class="campaign-form-section">
            <label class="font-bold">Botones (opcional, máx. 3)</label>
            <div id="tpl-buttons-list" class="space-y-2 mt-1"></div>
            <button type="button" onclick="addTemplateButton()" class="btn btn-outline btn-sm mt-2"><i class="fas fa-plus mr-1"></i> Agregar botón</button>
        </div>

        <div class="campaign-form-section">
            <button id="create-template-btn" onclick="handleCreateWhatsappTemplate()" class="btn btn-primary btn-lg">
                <i class="fas fa-paper-plane mr-2"></i> Crear y enviar a revisión
            </button>
            <p class="text-xs text-gray-400 mt-2">Meta revisa la plantilla (suele tardar unos minutos). Estará disponible para enviar cuando aparezca como APROBADA.</p>
        </div>
      </div>

      <!-- Vista previa en vivo estilo WhatsApp -->
      <div class="template-builder-preview">
        <p class="template-preview-title"><i class="fab fa-whatsapp mr-1" style="color:#25D366;"></i> Vista previa</p>
        <div class="wa-preview-chat">
            <div class="wa-preview-bubble" id="tpl-preview-bubble">
                <div id="tpl-preview-header"></div>
                <div id="tpl-preview-body"><span class="wa-preview-placeholder">El cuerpo del mensaje aparecerá aquí…</span></div>
                <div id="tpl-preview-footer"></div>
                <div id="tpl-preview-time">12:30</div>
            </div>
            <div id="tpl-preview-buttons"></div>
        </div>
      </div>
    </div>
`;

// Formulario constructor de anuncios click-to-WhatsApp (sub-pestaña "Crear Ad")
const CreateAdFormTemplate = () => `
    <style>
        .ad-builder { display: grid; grid-template-columns: 1fr 360px; gap: 28px; align-items: start; }
        @media (max-width: 900px) { .ad-builder { grid-template-columns: 1fr; } }
        /* Tamaño uniforme de todos los campos del formulario */
        .ad-builder input:not([type=file]):not([type=checkbox]):not([type=radio]),
        .ad-builder select {
            height: 42px; padding: 0 12px; font-size: 14px; line-height: 42px;
            border-radius: 8px; box-sizing: border-box; vertical-align: middle;
        }
        .ad-builder textarea {
            padding: 9px 12px; font-size: 14px; border-radius: 8px; box-sizing: border-box;
        }
        /* Control segmentado (estrategia de presupuesto) */
        .ad-seg { display: inline-flex; flex-wrap: wrap; background: var(--color-subtle-bg, #f3f4f6); border-radius: 10px; padding: 3px; gap: 3px; }
        .ad-seg-btn { border: none; background: transparent; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--color-text-secondary, #6b7280); transition: all .15s ease; }
        .ad-seg-btn.active { background: var(--color-container-bg, #fff); color: var(--color-primary, #E07A5F); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
        .ad-chip { white-space: nowrap; }
        .ad-objective-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .ad-objective-card {
            border: 2px solid var(--color-border, #e5e7eb); border-radius: 12px; padding: 14px;
            cursor: pointer; transition: all .15s ease; background: var(--color-container-bg, #fff);
        }
        .ad-objective-card:hover { border-color: var(--color-primary, #E07A5F); }
        .ad-objective-card.selected { border-color: var(--color-primary, #E07A5F); background: color-mix(in srgb, var(--color-primary, #E07A5F) 8%, transparent); }
        .ad-objective-card .ttl { font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .ad-objective-card .desc { font-size: 12px; color: var(--color-text-secondary, #6b7280); margin-top: 4px; }
        .ad-image-drop {
            border: 2px dashed var(--color-border, #d1d5db); border-radius: 12px; padding: 22px;
            text-align: center; cursor: pointer; transition: all .15s ease; color: var(--color-text-secondary, #6b7280);
        }
        .ad-image-drop:hover { border-color: var(--color-primary, #E07A5F); background: color-mix(in srgb, var(--color-primary, #E07A5F) 6%, transparent); }
        .ad-image-drop img { max-height: 160px; border-radius: 8px; margin: 0 auto; }
        .ad-interest-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .ad-chip {
            display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, var(--color-primary, #E07A5F) 12%, transparent);
            color: var(--color-primary, #E07A5F); border-radius: 9999px; padding: 4px 10px; font-size: 12px; font-weight: 600;
        }
        .ad-chip i { cursor: pointer; opacity: .7; }
        .ad-chip i:hover { opacity: 1; }
        .ad-interest-results {
            position: absolute; z-index: 40; background: var(--color-container-bg, #fff); border: 1px solid var(--color-border, #e5e7eb);
            border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.12); max-height: 240px; overflow-y: auto; width: 100%; margin-top: 4px;
        }
        .ad-interest-results .opt { padding: 9px 12px; cursor: pointer; font-size: 13px; }
        .ad-interest-results .opt:hover { background: var(--color-subtle-bg, #f3f4f6); }
        .ad-interest-results .opt small { color: var(--color-text-secondary, #9ca3af); }
        /* Vista previa estilo feed de Facebook */
        .fb-preview { position: sticky; top: 12px; }
        .fb-preview-title { font-size: 12px; font-weight: 700; color: var(--color-text-secondary, #6b7280); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 10px; }
        .fb-card { background: #fff; border: 1px solid #dadde1; border-radius: 12px; overflow: hidden; color: #050505; font-size: 14px; }
        .fb-card-head { display: flex; align-items: center; gap: 8px; padding: 12px; }
        .fb-avatar { width: 40px; height: 40px; border-radius: 50%; background: #E07A5F; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; }
        .fb-pagename { font-weight: 600; line-height: 1.2; }
        .fb-sponsored { font-size: 12px; color: #65676b; display: flex; align-items: center; gap: 4px; }
        .fb-primary { padding: 0 12px 10px; white-space: pre-wrap; word-break: break-word; }
        .fb-image { width: 100%; aspect-ratio: 1/1; background: #e4e6eb url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%23b0b3b8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>') center/48px no-repeat; display: flex; align-items: center; justify-content: center; }
        .fb-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .fb-foot { display: flex; align-items: center; gap: 12px; padding: 12px; background: #f7f8fa; border-top: 1px solid #dadde1; }
        .fb-foot-text { flex: 1; min-width: 0; }
        .fb-foot-domain { font-size: 12px; color: #65676b; }
        .fb-foot-headline { font-weight: 700; line-height: 1.25; }
        .fb-foot-desc { font-size: 13px; color: #65676b; }
        .fb-cta { background: #e4e6eb; color: #050505; font-weight: 600; border-radius: 6px; padding: 8px 14px; white-space: nowrap; font-size: 14px; }
    </style>
    <div class="ad-builder">
      <div class="ad-builder-form">
        <div class="campaign-form-section">
            <label class="font-bold">1. ¿Qué quieres lograr?</label>
            <div class="ad-objective-grid mt-2">
                <div class="ad-objective-card selected" data-objective="OUTCOME_ENGAGEMENT" onclick="onAdObjectiveChange(this)">
                    <div class="ttl"><i class="fab fa-whatsapp" style="color:#25D366;"></i> Mensajes</div>
                    <div class="desc">Más conversaciones nuevas en WhatsApp. Ideal para generar prospectos.</div>
                </div>
                <div class="ad-objective-card" data-objective="OUTCOME_SALES" onclick="onAdObjectiveChange(this)">
                    <div class="ttl"><i class="fas fa-cart-shopping" style="color:#E07A5F;"></i> Ventas</div>
                    <div class="desc">Optimiza hacia personas con intención de compra, también por WhatsApp.</div>
                </div>
            </div>
            <input type="hidden" id="ad-objective" value="OUTCOME_ENGAGEMENT">
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div class="campaign-form-section">
                <label class="font-bold" for="ad-account-select">Cuenta publicitaria</label>
                <select id="ad-account-select" onchange="onAdAccountChange()" class="!mb-0"><option value="">Cargando…</option></select>
            </div>
            <div class="campaign-form-section">
                <label class="font-bold" for="ad-page-select">Página de Facebook</label>
                <select id="ad-page-select" onchange="updateAdPreview()" class="!mb-0"><option value="">Selecciona una cuenta…</option></select>
            </div>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="ad-campaign-name">Nombre de la campaña</label>
            <input type="text" id="ad-campaign-name" placeholder="ej. Promo lámparas - junio" class="!mb-0">
            <div class="grid grid-cols-2 gap-3 mt-2">
                <div>
                    <label class="text-xs font-semibold text-gray-500" for="ad-adset-name">Nombre del conjunto</label>
                    <input type="text" id="ad-adset-name" placeholder="Automático" class="!mb-0">
                </div>
                <div>
                    <label class="text-xs font-semibold text-gray-500" for="ad-name">Nombre del anuncio</label>
                    <input type="text" id="ad-name" placeholder="Automático" class="!mb-0">
                </div>
            </div>
            <p class="text-xs text-gray-400 mt-1">Si dejas el conjunto y el anuncio en blanco, se nombran a partir de la campaña.</p>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="ad-wa-number">Número de WhatsApp</label>
            <input type="text" id="ad-wa-number" placeholder="5216181333519" oninput="this.value=this.value.replace(/[^0-9]/g,'')" class="!mb-0">
            <p class="text-xs text-gray-400">Con código de país, sin signos. Aquí llegarán los mensajes.</p>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold">Presupuesto y optimización</label>
            <div class="ad-seg mt-2">
                <button type="button" class="ad-seg-btn active" data-budget="campaign" onclick="setAdBudgetLevel(this,'campaign')">Presupuesto de la campaña ✦</button>
                <button type="button" class="ad-seg-btn" data-budget="adset" onclick="setAdBudgetLevel(this,'adset')">Presupuesto del conjunto</button>
            </div>
            <input type="hidden" id="ad-budget-level" value="campaign">
            <p class="text-xs text-gray-400 mt-1" id="ad-budget-hint">Meta reparte el presupuesto entre las mejores oportunidades de la campaña (Advantage+).</p>
            <div class="grid grid-cols-2 gap-4 mt-2">
                <div>
                    <label class="text-xs font-semibold text-gray-500" for="ad-daily-budget">Presupuesto diario (MXN)</label>
                    <input type="number" id="ad-daily-budget" min="1" step="1" value="100" class="!mb-0">
                </div>
                <div>
                    <label class="text-xs font-semibold text-gray-500" for="ad-optimization">Objetivo de rendimiento</label>
                    <select id="ad-optimization" class="!mb-0">
                        <option value="CONVERSATIONS" selected>Maximizar conversaciones</option>
                        <option value="LINK_CLICKS">Maximizar clics en el enlace</option>
                        <option value="REACH">Maximizar alcance</option>
                        <option value="IMPRESSIONS">Maximizar impresiones</option>
                    </select>
                </div>
            </div>
            <p class="text-xs text-gray-400 mt-1">Mínimo ~$10 MXN/día. "Conversaciones" es lo ideal para WhatsApp.</p>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold">2. ¿A quién se lo mostramos?</label>
            <div class="grid grid-cols-3 gap-3 mt-2">
                <div>
                    <label class="text-xs font-semibold text-gray-500">País</label>
                    <select id="ad-geo-country" class="!mb-0">
                        <option value="MX" selected>México</option>
                        <option value="US">Estados Unidos</option>
                        <option value="CO">Colombia</option>
                        <option value="AR">Argentina</option>
                        <option value="CL">Chile</option>
                        <option value="ES">España</option>
                    </select>
                </div>
                <div>
                    <label class="text-xs font-semibold text-gray-500">Edad</label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="number" id="ad-age-min" min="13" max="65" value="18" class="!mb-0" style="width:64px;">
                        <span class="text-gray-400">a</span>
                        <input type="number" id="ad-age-max" min="13" max="65" value="65" class="!mb-0" style="width:64px;">
                    </div>
                </div>
                <div>
                    <label class="text-xs font-semibold text-gray-500">Género</label>
                    <select id="ad-gender" class="!mb-0">
                        <option value="all">Todos</option>
                        <option value="male">Hombres</option>
                        <option value="female">Mujeres</option>
                    </select>
                </div>
            </div>
            <div class="mt-3" style="position:relative;">
                <label class="text-xs font-semibold text-gray-500">Ciudades o estados (opcional)</label>
                <input type="text" id="ad-place-search" placeholder="Busca lugares: Monterrey, Guadalajara, Jalisco…" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" data-form-type="other" oninput="searchAdPlaces(this.value)" onblur="hideAdPlaceResults()" class="!mb-0">
                <div id="ad-place-results" class="ad-interest-results hidden"></div>
                <div id="ad-place-chips" class="ad-interest-chips"></div>
                <p class="text-xs text-gray-400 mt-1">Vacío = todo el país de arriba. Agrega ciudades/estados para enfocar el anuncio a esas zonas.</p>
            </div>
            <div class="mt-3" style="position:relative;">
                <label class="text-xs font-semibold text-gray-500">Intereses (opcional)</label>
                <input type="text" id="ad-interest-search" placeholder="Busca intereses: decoración, hogar, regalos…" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" data-form-type="other" oninput="searchAdInterests(this.value)" onblur="hideAdInterestResults()" class="!mb-0">
                <div id="ad-interest-results" class="ad-interest-results hidden"></div>
                <div id="ad-interest-chips" class="ad-interest-chips"></div>
                <p class="text-xs text-gray-400 mt-1">Sin intereses = audiencia amplia (Meta decide). Agrega 1-3 para enfocar.</p>
            </div>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold">3. Diseña el anuncio</label>
            <label id="ad-image-drop" class="ad-image-drop mt-2" style="display:block;">
                <input type="file" id="ad-image" accept="image/*,video/*" onchange="onAdMediaChange(event)" hidden>
                <div id="ad-image-placeholder"><i class="fas fa-photo-film fa-2x mb-2"></i><br>Sube una <strong>imagen</strong> o <strong>video</strong> (cuadrado 1:1 recomendado)<br><span class="text-xs text-gray-400">Imagen JPG/PNG · Video MP4 hasta ~100&nbsp;MB</span></div>
                <img id="ad-image-preview" class="hidden" alt="imagen del anuncio">
                <video id="ad-video-preview" class="hidden" controls muted playsinline style="max-height:200px;border-radius:8px;margin:0 auto;display:block;"></video>
            </label>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="ad-primary-text">Texto principal *</label>
            <textarea id="ad-primary-text" rows="3" oninput="updateAdPreview()" placeholder="¿Buscas algo especial para tu hogar? 🏡 Escríbenos y te ayudamos a elegir. ✨"></textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
            <div class="campaign-form-section">
                <label class="font-bold" for="ad-headline">Título (opcional)</label>
                <input type="text" id="ad-headline" maxlength="40" oninput="updateAdPreview()" placeholder="Envíanos un mensaje" class="!mb-0">
            </div>
            <div class="campaign-form-section">
                <label class="font-bold" for="ad-cta">Botón</label>
                <select id="ad-cta" onchange="updateAdPreview()" class="!mb-0">
                    <option value="WHATSAPP_MESSAGE">Enviar mensaje</option>
                    <option value="LEARN_MORE">Más información</option>
                    <option value="SHOP_NOW">Comprar ahora</option>
                    <option value="ORDER_NOW">Ordenar ahora</option>
                    <option value="GET_QUOTE">Obtener cotización</option>
                </select>
            </div>
        </div>

        <div class="campaign-form-section">
            <label class="font-bold" for="ad-description">Descripción (opcional)</label>
            <input type="text" id="ad-description" maxlength="60" oninput="updateAdPreview()" placeholder="Atención por WhatsApp" class="!mb-0">
        </div>

        <div class="campaign-form-section">
            <label class="font-bold">4. Conversación (mensaje de bienvenida)</label>
            <p class="text-xs text-gray-400 !mb-2">Lo que verá la persona en WhatsApp al tocar el anuncio: un saludo y preguntas que puede tocar para empezar el chat.</p>
            <label class="text-xs font-semibold text-gray-500">Saludo</label>
            <textarea id="ad-greeting" rows="2" oninput="updateAdWelcomePreview()" placeholder="¡Hola! 👋 ¿Cómo podemos ayudarte?" class="!mb-2"></textarea>
            <label class="text-xs font-semibold text-gray-500">Preguntas frecuentes (máx. 4)</label>
            <div id="ad-faqs" class="space-y-2 mt-1"></div>
            <button type="button" id="ad-faq-add" onclick="addAdFaqRow()" class="btn btn-outline btn-sm mt-2"><i class="fas fa-plus mr-1"></i> Agregar pregunta</button>
        </div>

        <div class="campaign-form-section" style="background:color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent);border:1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 35%, transparent);border-radius:10px;padding:12px;">
            <p class="text-sm" style="margin:0;"><i class="fas fa-circle-info mr-1" style="color:var(--color-warning,#f59e0b);"></i> Al publicar, el anuncio queda <strong>EN VIVO</strong> y empezará a gastar tu presupuesto en cuanto Meta lo apruebe.</p>
        </div>

        <div class="campaign-form-section">
            <button id="create-ad-btn" onclick="handleCreateMetaAd()" class="btn btn-primary btn-lg">
                <i class="fas fa-rocket mr-2"></i> Publicar anuncio
            </button>
        </div>
      </div>

      <!-- Vista previa estilo Facebook -->
      <div class="fb-preview">
        <p class="fb-preview-title"><i class="fab fa-facebook mr-1" style="color:#1877F2;"></i> Vista previa</p>
        <div class="fb-card">
            <div class="fb-card-head">
                <div class="fb-avatar" id="ad-preview-avatar">D</div>
                <div>
                    <div class="fb-pagename" id="ad-preview-pagename">Tu página</div>
                    <div class="fb-sponsored">Patrocinado · <i class="fas fa-earth-americas"></i></div>
                </div>
            </div>
            <div class="fb-primary" id="ad-preview-primary"><span style="color:#90949c;">El texto principal aparecerá aquí…</span></div>
            <div class="fb-image" id="ad-preview-image"></div>
            <div class="fb-foot">
                <div class="fb-foot-text">
                    <div class="fb-foot-domain">WHATSAPP.COM</div>
                    <div class="fb-foot-headline" id="ad-preview-headline">Envíanos un mensaje</div>
                    <div class="fb-foot-desc" id="ad-preview-desc"></div>
                </div>
                <div class="fb-cta" id="ad-preview-cta">Enviar mensaje</div>
            </div>
        </div>
        <p class="text-xs text-gray-400 mt-2">Así se verá aproximadamente en el feed. La ubicación real la optimiza Meta.</p>

        <!-- Vista previa del chat de WhatsApp (Conversaciones) -->
        <p class="fb-preview-title mt-4"><i class="fab fa-whatsapp mr-1" style="color:#25D366;"></i> Conversación</p>
        <div style="background:#E5DDD5;border-radius:12px;padding:12px;">
            <div id="ad-welcome-greeting" style="background:#fff;border-radius:8px;padding:8px 10px;font-size:13px;color:#111;max-width:85%;box-shadow:0 1px 1px rgba(0,0,0,.1);">¡Hola! 👋 ¿Cómo podemos ayudarte?</div>
            <div id="ad-welcome-faqs" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;align-items:flex-end;"></div>
        </div>
      </div>
    </div>
`;

// Vista unificada de Campañas: sub-pestañas "Enviar" y "Crear plantilla"
const CampaignsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Campañas</h1>
        </div>

        <div class="campaign-tabs">
            <button class="campaign-tab active" data-ctab="enviar" onclick="switchCampaignTab('enviar')"><i class="fas fa-paper-plane mr-2"></i>Enviar campaña</button>
            <button class="campaign-tab" data-ctab="difusion" onclick="switchCampaignTab('difusion')"><i class="fas fa-rocket mr-2"></i>Difusión masiva</button>
            <button class="campaign-tab" data-ctab="crear" onclick="switchCampaignTab('crear')"><i class="fas fa-file-circle-plus mr-2"></i>Crear plantilla</button>
            <button class="campaign-tab" data-ctab="plantillas" onclick="switchCampaignTab('plantillas')"><i class="fas fa-list-check mr-2"></i>Plantillas</button>
            <button class="campaign-tab" data-ctab="crear-ad" onclick="switchCampaignTab('crear-ad')"><i class="fab fa-facebook mr-2"></i>Crear Ad</button>
            <button class="campaign-tab" data-ctab="resultados" onclick="switchCampaignTab('resultados')"><i class="fas fa-chart-pie mr-2"></i>Resultados</button>
        </div>

        <!-- SUB-PESTAÑA: Enviar -->
        <div class="campaign-pane active" data-cpane="enviar">
          <div class="campaign-pane-content">
            <div class="campaign-pane-header">
                <div class="campaign-pane-heading">
                    <h2 class="campaign-pane-title"><i class="fas fa-paper-plane"></i> Enviar campaña</h2>
                    <p class="campaign-pane-sub">Envía una plantilla aprobada a tus contactos por etiqueta o a un número específico.</p>
                </div>
            </div>
            <div class="max-w-2xl">
                <div class="campaign-form-section">
                    <label class="font-bold">1. Enviar a (elige una opción):</label>
                    <div class="mt-2 p-4 border rounded-lg bg-gray-50">
                        <label for="campaign-tag-select" class="text-sm font-semibold">Contactos con la etiqueta:</label>
                        <select id="campaign-tag-select" onchange="updateCampaignRecipientCount()" class="!mb-2"></select>
                        <p id="campaign-recipient-count" class="text-sm text-gray-500">0 destinatarios</p>
                    </div>
                    <p class="text-center my-3 font-bold text-gray-400">Ó</p>
                    <div class="p-4 border rounded-lg bg-gray-50">
                        <label for="campaign-phone-input" class="text-sm font-semibold">Un número de teléfono específico:</label>
                        <input type="text" id="campaign-phone-input" placeholder="Ej: 521..." class="!mb-0">
                    </div>
                </div>
                <div class="campaign-form-section">
                    <label for="campaign-template-select" class="font-bold">2. Plantilla de mensaje:</label>
                    <select id="campaign-template-select" onchange="onCampaignTemplateChange()" class="!mb-2"></select>
                </div>
                <div id="campaign-image-url-section" class="campaign-form-section hidden">
                    <label for="campaign-image-url-input" class="font-bold">3. URL de la imagen (esta plantilla lleva cabecera de imagen):</label>
                    <input type="text" id="campaign-image-url-input" placeholder="https://ejemplo.com/imagen.jpg" class="!mb-2">
                </div>
                <div class="campaign-form-section">
                    <button id="send-campaign-btn" onclick="handleSendUnifiedCampaign()" class="btn btn-primary btn-lg">
                        <i class="fas fa-paper-plane mr-2"></i> Enviar Campaña
                    </button>
                </div>
            </div>
          </div>
        </div>

        <!-- SUB-PESTAÑA: Difusión masiva -->
        <div class="campaign-pane" data-cpane="difusion">
            ${DifusionViewTemplate()}
        </div>

        <!-- SUB-PESTAÑA: Crear plantilla -->
        <div class="campaign-pane" data-cpane="crear">
          <div class="campaign-pane-content">
            <div class="campaign-pane-header">
                <div class="campaign-pane-heading">
                    <h2 class="campaign-pane-title"><i class="fas fa-file-circle-plus"></i> Crear plantilla</h2>
                    <p class="campaign-pane-sub">Diseña una plantilla de WhatsApp y envíala a revisión de Meta. Estará lista para usar cuando aparezca como aprobada.</p>
                </div>
            </div>
            ${CreateTemplateFormTemplate()}
          </div>
        </div>

        <!-- SUB-PESTAÑA: Plantillas (estatus tipo Meta) -->
        <div class="campaign-pane" data-cpane="plantillas">
          <div class="campaign-pane-content">
            <div class="campaign-pane-header">
                <div class="campaign-pane-heading">
                    <h2 class="campaign-pane-title"><i class="fas fa-list-check"></i> Plantillas</h2>
                    <p class="campaign-pane-sub">Todas tus plantillas de WhatsApp y su estatus en Meta (aprobada, en revisión o rechazada).</p>
                </div>
                <div class="campaign-pane-actions">
                    <button class="btn btn-secondary btn-sm" onclick="renderTemplatesStatus(true)"><i class="fas fa-sync-alt mr-2"></i>Actualizar</button>
                </div>
            </div>
            <div id="templates-status-container"><p class="text-gray-500">Cargando plantillas…</p></div>
          </div>
        </div>

        <!-- SUB-PESTAÑA: Crear Ad (anuncio click-to-WhatsApp) -->
        <div class="campaign-pane" data-cpane="crear-ad">
          <div class="campaign-pane-content">
            <div class="campaign-pane-header">
                <div class="campaign-pane-heading">
                    <h2 class="campaign-pane-title"><i class="fab fa-facebook"></i> Crear anuncio (Ads)</h2>
                    <p class="campaign-pane-sub">Crea un anuncio de Facebook/Instagram que abre un chat de WhatsApp, sin entrar al Administrador de Anuncios de Meta.</p>
                </div>
            </div>
            ${CreateAdFormTemplate()}
          </div>
        </div>

        <!-- SUB-PESTAÑA: Resultados (conversión) -->
        <div class="campaign-pane" data-cpane="resultados">
            ${ConversionCampanasViewTemplate()}
        </div>
    </div>
`;

const DifusionViewTemplate = () => `
    <div class="view-container p-4 sm:p-8">
        <style>
            .table-input, .custom-select {
                border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px;
                width: 100%; transition: all 0.2s ease;
            }
            .table-input:focus, .custom-select:focus {
                outline: none; border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
            }
            .table-input.verified { border-color: var(--color-success); background-color: color-mix(in srgb, var(--color-success) 8%, transparent); }
            .table-input.error { border-color: var(--color-danger); background-color: color-mix(in srgb, var(--color-danger) 8%, transparent); }
            .photo-cell { display: flex; align-items: center; justify-content: center; width: 120px; height: 80px; }
            .photo-uploader {
                width: 100%; height: 100%; border: 2px dashed #d1d5db; border-radius: 8px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: all 0.2s ease; position: relative;
            }
            .photo-uploader:hover, .photo-uploader.drag-over { border-color: var(--color-primary); background-color: color-mix(in srgb, var(--color-primary) 8%, transparent); }
            .photo-uploader i { font-size: 1.5rem; color: #9ca3af; }
            .photo-uploader .preview-img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
            .photo-uploader .delete-btn {
                position: absolute; top: -8px; right: -8px; background: #dc3545; color: white;
                border-radius: 50%; width: 24px; height: 24px; border: none; cursor: pointer;
                display: none; align-items: center; justify-content: center; z-index: 10;
            }
            .photo-uploader:hover .delete-btn { display: flex; }
            .photo-uploader input[type="file"] { display: none; }
            .status-tag { padding: 4px 12px; border-radius: 9999px; font-weight: 600; font-size: 0.8rem; }
            #quick-reply-dropdown { z-index: 50; max-height: 250px; overflow-y: auto; }
            .message-pill { cursor: grab; transition: all 0.2s ease; }
            .message-pill:active { cursor: grabbing; background-color: #F2CC8F; }
            .message-pill .remove-pill { cursor: pointer; opacity: 0.6; transition: opacity 0.2s; }
            .message-pill .remove-pill:hover { opacity: 1; }
            .sortable-ghost { opacity: 0.4; background: #e0e7ff; }
        </style>
        <div class="campaign-pane-content">
            <div class="campaign-pane-header">
                <div class="campaign-pane-heading">
                    <h2 class="campaign-pane-title"><i class="fas fa-rocket"></i> Envío masivo de fotos</h2>
                    <p class="campaign-pane-sub">Añade los pedidos, sube sus fotos y envíalas a todos tus clientes con un solo clic.</p>
                </div>
                <div class="campaign-pane-actions">
                    <span id="job-counter" class="font-semibold text-gray-600">0 Pedidos en la lista</span>
                    <button id="send-all-btn" class="btn btn-primary" disabled>
                        <i class="fas fa-paper-plane"></i> Enviar Todo
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div id="message-sequence-builder" class="border-b md:border-b-0 md:border-r pr-6 pb-6">
                    <h2 class="text-xl font-semibold text-gray-700 mb-3" style="font-family: var(--font-heading);">
                        <i class="fas fa-stream text-gray-400"></i>
                        Secuencia de Mensajes (&lt; 24h)
                    </h2>
                    <p class="text-sm text-gray-500 mb-4">Se enviará esta secuencia y la foto si el cliente contactó hace menos de 24 horas.</p>
                    <div id="selected-messages-container" class="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg min-h-[50px]"></div>
                    <div id="add-message-controls" class="relative mt-4">
                        <button id="add-message-btn" class="btn btn-subtle">
                            <i class="fas fa-plus"></i> Agregar Mensaje
                        </button>
                        <div id="quick-reply-dropdown" class="absolute hidden mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-xl"></div>
                    </div>
                </div>

                <div id="contingency-plan-builder">
                    <h2 class="text-xl font-semibold text-gray-700 mb-3" style="font-family: var(--font-heading);">
                        <i class="fas fa-history text-gray-400"></i>
                        Plan de Contingencia (&gt; 24h)
                    </h2>
                    <p class="text-sm text-gray-500 mb-4">Si el cliente contactó hace MÁS de 24h, se enviará esta plantilla. Al responder, recibirá la secuencia normal.</p>
                    <div>
                        <label for="contingency-template-select" class="font-semibold text-sm mb-2 block">Plantilla de Reactivación</label>
                        <select id="contingency-template-select" class="custom-select">
                            <option value="">-- Seleccionar plantilla --</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="overflow-x-auto border-t pt-6">
            <div class="table-responsive-wrapper">
                <table class="table w-full">
                    <thead>
                        <tr class="bg-gray-50">
                            <th class="w-12 text-center">#</th>
                            <th class="w-48">No. Pedido o Teléfono</th>
                            <th>Cliente</th>
                            <th class="text-center">Foto del Pedido</th>
                            <th>Estatus</th>
                            <th class="w-16"></th>
                        </tr>
                    </thead>
                    <tbody id="bulk-table-body">
                        <tr id="empty-state-row">
                            <td colspan="6" class="text-center text-gray-400 py-12">
                                <i class="fas fa-images text-4xl mb-4"></i>
                                <p class="font-semibold">Aún no hay pedidos en la lista.</p>
                                <p>Usa el botón "Agregar Fila" para empezar.</p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            </div>

            <div class="mt-6 flex justify-start">
                <button id="add-row-btn" class="btn btn-subtle">
                    <i class="fas fa-plus-circle"></i> Agregar Fila
                </button>
            </div>
        </div>
    </div>
`;

const MensajesAdsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Mensajes de Bienvenida por Anuncio</h1>
            <button onclick="openAdResponseModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Mensaje</button>
        </div>
        <p class="mb-6 text-gray-600">Configura respuestas automáticas para los clientes que llegan desde un anuncio de Facebook o Instagram. El sistema identificará el anuncio y enviará el mensaje correspondiente.</p>
        <table class="table">
            <thead>
                <tr>
                    <th>Nombre del Anuncio</th>
                    <th>IDs del Anuncio</th>
                    <th>Mensaje</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="ad-responses-table-body"></tbody>
        </table>
    </div>
`;



const ContactsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Contactos</h1>
             <div class="flex items-center gap-4">
                <button onclick="openEditContactModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Contacto</button>
            </div>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>WhatsApp</th>
                        <th>Correo Electrónico</th>
                        <th>Etiquetas</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="contacts-table-body"></tbody>
            </table>
        </div>
    </div>
`;

const ClientesViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Clientes</h1>
        </div>
        <div class="crm-tabs">
            <button class="crm-tab active" data-crmtab="clientes" onclick="switchCrmTab('clientes')">Clientes <span class="crm-tab-count" id="crm-count-clientes">·</span></button>
            <button class="crm-tab" data-crmtab="leads" onclick="switchCrmTab('leads')">Leads <span class="crm-tab-count" id="crm-count-leads">·</span></button>
            <button class="crm-tab" data-crmtab="contactos" onclick="switchCrmTab('contactos')">Contactos <span class="crm-tab-count" id="crm-count-contactos">·</span></button>
            <button class="crm-tab" data-crmtab="graficos" onclick="switchCrmTab('graficos')"><i class="fas fa-chart-column mr-1"></i> Gráficos</button>
        </div>
        <p id="crm-tab-hint" class="text-xs" style="color:var(--color-text-light);margin:0 0 12px 0;"></p>
        <div class="crm-toolbar" style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:1rem;">
            <div style="flex:1;min-width:220px;">
                <label for="crm-search" class="text-xs font-semibold block mb-1" style="color:var(--color-text-light);"><i class="fas fa-search mr-1"></i> Nombre o teléfono</label>
                <input type="text" id="crm-search" placeholder="Buscar..." oninput="renderCrmList()" class="!mb-0">
            </div>
            <div style="min-width:170px;">
                <label for="crm-status-filter" class="text-xs font-semibold block mb-1" style="color:var(--color-text-light);"><i class="fas fa-tag mr-1"></i> Estatus</label>
                <select id="crm-status-filter" onchange="renderCrmList()" class="!mb-0"></select>
            </div>
            <div id="crm-sort-wrap" style="min-width:190px;">
                <label for="crm-sort" class="text-xs font-semibold block mb-1" style="color:var(--color-text-light);"><i class="fas fa-sort-amount-down mr-1"></i> Ordenar por</label>
                <select id="crm-sort" onchange="renderCrmList()" class="!mb-0">
                    <option value="recent">Más reciente</option>
                    <option value="spent">Más ha comprado ($)</option>
                    <option value="orders"># de compras</option>
                    <option value="product">Producto</option>
                </select>
            </div>
            <button onclick="clearCrmFilters()" class="btn btn-subtle"><i class="fas fa-eraser mr-1"></i> Limpiar</button>
            <button onclick="refreshCrmView()" class="btn btn-subtle" title="Volver a leer del servidor"><i class="fas fa-sync-alt mr-1"></i> Actualizar</button>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead id="crm-thead"></thead>
                <tbody id="crm-tbody">
                    <tr><td colspan="7" class="text-center text-gray-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando…</td></tr>
                </tbody>
            </table>
        </div>
        <div id="crm-charts" style="display:none;"></div>
    </div>
`;

const QuickRepliesViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Respuestas Rápidas</h1>
            <button onclick="openQuickReplyModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Agregar Respuesta</button>
        </div>
        <div class="table-responsive-wrapper">
            <table class="table">
                <thead>
                    <tr>
                        <th>Atajo</th>
                        <th>Mensaje</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="quick-replies-table-body"></tbody>
            </table>
        </div>
    </div>
`;



const EnviosViewTemplate = () => `
    <div class="view-container">
        <div class="view-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
            <div>
                <h1>Envíos</h1>
                <p class="text-sm text-gray-500 mt-1">Pedidos con comprobante de pago validado (y líneas que agregues manualmente). La columna "Datos de envío" se llena cuando el cliente completa su formulario.</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" onclick="toggleEnvioManualForm()"><i class="fas fa-plus mr-2"></i>Agregar línea</button>
                <button class="btn btn-secondary btn-sm" onclick="renderEnviosView()"><i class="fas fa-sync-alt mr-2"></i>Actualizar</button>
            </div>
        </div>

        <div id="envio-manual-form" class="settings-card mt-3" style="display:none;">
            <h2 class="text-base font-bold mb-1">Agregar línea manual</h2>
            <p class="text-xs text-gray-500 mb-3">Solo el <b>número de pedido</b> es obligatorio; lo demás es opcional.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
                <div><label class="text-xs font-semibold text-gray-500">Número de pedido *</label><input id="em-order" type="text" placeholder="DH12345" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Monto pagado</label><input id="em-monto" type="text" placeholder="750" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Nombre</label><input id="em-nombre" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Dirección</label><input id="em-direccion" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Colonia</label><input id="em-colonia" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Entre calles</label><input id="em-entrecalles" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Referencia</label><input id="em-referencia" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Municipio</label><input id="em-ciudad" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Estado</label><input id="em-estado" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">C.P.</label><input id="em-cp" type="text" class="!mb-0"></div>
                <div><label class="text-xs font-semibold text-gray-500">Teléfono</label><input id="em-telefono" type="text" class="!mb-0"></div>
            </div>
            <div id="em-error" class="text-sm mt-2" style="color:#dc2626;"></div>
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button id="em-save" class="btn btn-primary btn-sm" onclick="saveEnvioManual()"><i class="fas fa-save mr-2"></i>Guardar línea</button>
                <button class="btn btn-outline btn-sm" onclick="toggleEnvioManualForm()">Cancelar</button>
            </div>
        </div>

        <div id="envios-container" class="mt-4"><p class="text-gray-500">Cargando envíos…</p></div>
    </div>
`;

const SettingsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Ajustes Generales</h1>
        </div>
        <div class="settings-tabs">
            <button class="settings-tab active" data-stab="apariencia" onclick="switchSettingsTab('apariencia')"><i class="fas fa-palette mr-2"></i>Apariencia</button>
            <button class="settings-tab" data-stab="empresa" onclick="switchSettingsTab('empresa')"><i class="fab fa-whatsapp mr-2"></i>Personalizar mi empresa</button>
            <button class="settings-tab" data-stab="usuarios" onclick="switchSettingsTab('usuarios')"><i class="fas fa-users mr-2"></i>Usuarios</button>
            <button class="settings-tab" data-stab="automatizacion" onclick="switchSettingsTab('automatizacion')"><i class="fas fa-robot mr-2"></i>Automatización</button>
            <button class="settings-tab" data-stab="integraciones" onclick="switchSettingsTab('integraciones')"><i class="fas fa-plug mr-2"></i>Integraciones</button>
            <button class="settings-tab" data-stab="herramientas" onclick="switchSettingsTab('herramientas')"><i class="fas fa-screwdriver-wrench mr-2"></i>Herramientas</button>
        </div>

        <div class="max-w-2xl">
            <div class="settings-pane active" data-spane="apariencia">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-1">Apariencia</h2>
                <p class="text-sm text-gray-500 mb-4">Elige el tema del CRM. Se guarda en este navegador.</p>
                <div class="theme-picker-grid">
                    ${(window.CRM_THEMES || []).map(t => {
                        const active = (window.getCurrentTheme ? window.getCurrentTheme() : 'dekoor') === t.id;
                        return `
                        <button type="button" data-theme-card="${t.id}" onclick="setTheme('${t.id}')" class="theme-card${active ? ' theme-card-active' : ''}">
                            <span class="theme-card-preview">
                                <span class="theme-card-strip" style="background:${t.swatches[2]}">
                                    <span class="theme-dot" style="background:${t.swatches[0]}"></span>
                                    <span class="theme-dot" style="background:${t.swatches[1]}"></span>
                                </span>
                            </span>
                            <span class="theme-card-meta">
                                <span class="theme-card-name">${t.name}</span>
                                <span class="theme-card-desc">${t.desc}</span>
                            </span>
                            <i class="fas fa-check-circle theme-card-check"></i>
                        </button>`;
                    }).join('')}
                </div>
            </div>
            </div>
            <div class="settings-pane" data-spane="empresa">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-1">Personalizar mi empresa</h2>
                <p class="text-sm text-gray-500 mb-4">El perfil de tu número de WhatsApp Business: lo que ven tus clientes en el chat.</p>
                <div id="business-profile-container"><p class="text-gray-400 text-sm">Cargando perfil de WhatsApp…</p></div>
            </div>
            </div>
            <div class="settings-pane" data-spane="usuarios">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-1">Usuarios y Operadores</h2>
                <p class="text-sm text-gray-500 mb-4">Consulta y edita la información de tu equipo: nombre, foto de perfil, rango y departamentos asignados.</p>
                <div id="users-list-container" class="space-y-3">
                    <p class="text-gray-400 text-sm">Cargando usuarios...</p>
                </div>
            </div>
            </div>
            <div class="settings-pane" data-spane="automatizacion">
            <div class="space-y-8">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Automatización</h2>
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="font-semibold">Mensaje de Ausencia</h3>
                        <p class="text-sm text-gray-500">Enviar una respuesta automática fuera del horario de atención.</p>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="away-message-toggle" onchange="handleAwayMessageToggle(this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-1"><i class="fab fa-facebook-messenger text-blue-500 mr-2"></i>Respuesta automática de Facebook</h2>
                <p class="text-sm text-gray-500 mb-4">Elige la respuesta rápida que se enviará automáticamente como primera respuesta a las conversaciones <strong>nuevas</strong> de Facebook Messenger. Déjala en "Predeterminada" para usar el saludo genérico.</p>
                <div id="messenger-welcome-combo" class="relative">
                    <!-- Modo guardado: muestra la selección actual como algo asentado (no editable) -->
                    <div id="messenger-welcome-display" class="flex items-center gap-3">
                        <div id="messenger-welcome-display-text" class="flex-1 truncate"
                             style="padding:10px 15px; border:1px solid var(--color-border); border-radius:var(--border-radius-md); background-color:var(--color-subtle-bg); color:var(--color-text-light); font-style:italic; font-size:0.95rem;">
                            Predeterminada (saludo genérico)
                        </div>
                        <button id="messenger-welcome-edit-btn" type="button" class="btn btn-outline flex-shrink-0">
                            <i class="fas fa-pen"></i> Cambiar
                        </button>
                    </div>
                    <!-- Modo edición: barra de búsqueda (oculta hasta pulsar "Cambiar") -->
                    <div id="messenger-welcome-edit" class="hidden items-start gap-3">
                        <div class="relative flex-1">
                            <input type="text" id="messenger-welcome-search" class="!mb-0" autocomplete="off"
                                   placeholder="Escribe para buscar una respuesta rápida...">
                            <select id="messenger-welcome-select" class="hidden">
                                <option value="">Predeterminada (saludo genérico)</option>
                            </select>
                            <ul id="messenger-welcome-options"
                                class="hidden absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg shadow-lg text-sm"
                                style="background-color:var(--color-container-bg); border:1px solid var(--color-border); color:var(--color-text);"></ul>
                        </div>
                        <button id="save-messenger-welcome-btn" class="btn btn-primary flex-shrink-0">Guardar</button>
                        <button id="messenger-welcome-cancel-btn" type="button" class="btn btn-outline flex-shrink-0">Cancelar</button>
                    </div>
                </div>
            </div>
            </div>
            </div>
            <div class="settings-pane" data-spane="integraciones">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Integraciones</h2>
                <div>
                    <label for="google-sheet-id-input" class="font-semibold">ID de Google Sheet para Cobertura</label>
                    <p class="text-sm text-gray-500 mb-3">Pega aquí el ID de tu hoja de cálculo con los códigos postales.</p>
                    <div class="flex items-center gap-3">
                        <input type="text" id="google-sheet-id-input" class="!mb-0" placeholder="Ej: 1aBcDeFgHiJkLmNoPqRsTuVwXyZ_1234567890">
                        <button id="save-google-sheet-id-btn" class="btn btn-primary flex-shrink-0">Guardar</button>
                    </div>
                </div>
            </div>
            </div>
            <div class="settings-pane" data-spane="herramientas">
            <div class="space-y-8">
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Herramientas de Prueba</h2>
                <form id="simulate-ad-form">
                    <div>
                        <label class="font-semibold">Simular Mensaje de Anuncio</label>
                        <p class="text-sm text-gray-500 mb-3">Prueba cómo responde el sistema a un nuevo mensaje de un anuncio. Usa un número de 12 o 13 dígitos (código de país + número).</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                            <div>
                                <label for="sim-phone-number" class="text-xs font-bold">Número de Teléfono (Ej: 521618...)</label>
                                <input type="text" id="sim-phone-number" class="!mb-0" placeholder="521..." required>
                            </div>
                            <div>
                                <label for="sim-ad-id" class="text-xs font-bold">ID del Anuncio</label>
                                <input type="text" id="sim-ad-id" class="!mb-0" placeholder="120..." required>
                            </div>
                        </div>
                         <div>
                            <label for="sim-message-text" class="text-xs font-bold">Texto del Mensaje</label>
                            <input type="text" id="sim-message-text" class="!mb-0" value="Hola, quiero más información." required>
                        </div>
                        <button id="simulate-ad-btn" type="submit" class="btn btn-secondary mt-4">
                            <i class="fas fa-paper-plane mr-2"></i> Enviar Simulación
                        </button>
                    </div>
                </form>
            </div>
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-1">Evento de compra de Meta</h2>
                <p class="text-sm text-gray-500 mb-4">Define en qué momento se envía el evento <strong>Purchase</strong> a Meta para cada pedido.</p>
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="font-semibold" id="purchase-trigger-label">Al cambiar a "Fabricar"</h3>
                        <p class="text-sm text-gray-500">
                            <strong>Encendido</strong>: se envía al cambiar el pedido a <strong>"Fabricar"</strong> (venta confirmada).<br>
                            <strong>Apagado</strong>: se envía al <strong>registrar</strong> el pedido.
                        </p>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="purchase-trigger-toggle" onchange="handlePurchaseTriggerToggle(this.checked)" checked>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-4">Mantenimiento</h2>
                <div>
                    <p class="text-sm text-gray-500 mb-3">Asigna todos los chats que actualmente no tienen un departamento al departamento por defecto "General".</p>
                    <button onclick="handleMigrateOrphans()" class="btn btn-secondary">
                        <i class="fas fa-random mr-2"></i> Migrar Chats Huérfanos a General
                    </button>
                </div>
            </div>
            </div>
            </div>
        </div>
    </div>
`;

const AITrainingViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1><i class="fas fa-brain mr-2"></i>Entrenamiento de IA</h1>
        </div>
        <div class="max-w-3xl space-y-8">
            <!-- Sección: Instrucciones del Bot -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">🧠 Instrucciones del Bot</h2>
                <p class="text-sm text-gray-500 mb-4">Define la personalidad, tono y reglas generales de la IA. Este texto se envía como contexto en cada conversación.</p>
                <textarea id="ai-bot-instructions" rows="8" class="w-full p-3 border border-gray-300 rounded-lg text-sm" placeholder="Ej: Eres el asistente virtual de Mi Empresa. Responde siempre en español, de forma amigable y profesional...">${state.aiBotInstructions || ''}</textarea>
                <div class="flex justify-end mt-3">
                    <button id="save-bot-instructions-btn" class="btn btn-primary">
                        <i class="fas fa-save mr-2"></i>Guardar Instrucciones
                    </button>
                </div>
            </div>

            <!-- Sección: Instrucciones de Post-Venta (Etapa 2) -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">📦 Instrucciones de Post-Venta (Etapa 2)</h2>
                <p class="text-sm text-gray-500 mb-3">Cuando el pedido está <strong>LISTO</strong> y se le manda al cliente la foto con los datos de pago (comando <strong>/cuatro</strong> o su frase "Ya tenemos tu pedido listo"), la IA pasa a esta etapa para gestionar el cobro, validar comprobantes y coordinar la entrega. El <strong>/final</strong> solo registra la venta (Pendientes IA); la IA sigue en etapa de venta mientras se fabrica. Es un prompt global (aplica a todos los productos). Sigue activa hasta que apagues la IA del contacto a mano.</p>
                <p class="text-xs text-gray-500 mb-3 p-2 rounded-lg" style="background:#fff7ed;border:1px solid #fed7aa;">💡 <strong>Nuevo pedido:</strong> si escribes tu propio texto, incluye que cuando el cliente quiera otro pedido la IA debe responder y escribir el comando <strong>/nuevopedido</strong> (regresa el chat a ventas). También puedes regresarlo a mano con el botón ámbar “Post-venta” en la cabecera del chat.</p>
                <label class="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700 cursor-pointer">
                    <input type="checkbox" id="postventa-enabled-toggle" class="h-4 w-4" ${state.postSaleStageActive !== false ? 'checked' : ''}>
                    Activar etapa 2 (post-venta) automáticamente tras /cuatro (pedido listo)
                </label>
                <textarea id="ai-postventa-instructions" rows="8" class="w-full p-3 border border-gray-300 rounded-lg text-sm" placeholder="Ej: Eres el asistente de post-venta. El cliente ya cerró su pedido; ayúdale con el pago, avísale cuando esté listo y coordina la entrega...">${state.aiPostventaInstructions || ''}</textarea>
                <p class="text-xs text-gray-400 mt-2">Si lo dejas vacío, se usa un texto por defecto de post-venta para que la IA nunca deje de responder.</p>
                <div class="flex justify-end mt-3">
                    <button id="save-postventa-instructions-btn" class="btn btn-primary">
                        <i class="fas fa-save mr-2"></i>Guardar Post-Venta
                    </button>
                </div>
            </div>

            <!-- Sección: Instrucciones por Departamento / Producto -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">🏢 Instrucciones del Bot por Departamento</h2>
                <p class="text-sm text-gray-500 mb-4">Define instrucciones específicas para cada producto o departamento. El bot las usará cuando el contacto esté asignado al departamento correspondiente, en lugar de las instrucciones generales de arriba.</p>
                <div id="department-prompts-container">
                    <div class="flex items-center justify-center py-8 text-gray-400">
                        <i class="fas fa-spinner fa-spin mr-2"></i> Cargando departamentos...
                    </div>
                </div>
            </div>

            <!-- Sección: Base de Conocimiento -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">📚 Base de Conocimiento</h2>
                <p class="text-sm text-gray-500 mb-4">Agrega preguntas frecuentes. La IA usará esta información para responder a tus clientes con precisión.</p>
                <div class="flex justify-end mb-4">
                    <button onclick="openKnowledgeModal()" class="btn btn-primary">
                        <i class="fas fa-plus mr-2"></i>Agregar Conocimiento
                    </button>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Tema</th>
                            <th>Respuesta</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="knowledge-base-table-body"></tbody>
                </table>
            </div>

            <!-- Sección: Uso de Tokens -->
            <div class="settings-card">
                <h2 class="text-xl font-bold mb-2">📊 Uso y Costos de IA</h2>
                <p class="text-sm text-gray-500 mb-4">Monitorea el consumo de tokens y el costo estimado de la IA. Precios basados en Gemini Flash.</p>
                
                <!-- Stats de Hoy -->
                <div class="mb-6">
                    <h3 class="font-semibold text-lg mb-3">📅 Hoy</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="bg-blue-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Peticiones</p>
                            <p id="usage-today-requests" class="text-2xl font-bold text-blue-600">-</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Entrada</p>
                            <p id="usage-today-input" class="text-2xl font-bold text-green-600">-</p>
                        </div>
                        <div class="bg-purple-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Salida</p>
                            <p id="usage-today-output" class="text-2xl font-bold text-purple-600">-</p>
                        </div>
                        <div class="bg-amber-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Costo Estimado</p>
                            <p id="usage-today-cost" class="text-2xl font-bold text-amber-600">-</p>
                        </div>
                    </div>
                </div>

                <!-- Stats del Mes -->
                <div>
                    <h3 class="font-semibold text-lg mb-3">📆 Este Mes</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div class="bg-blue-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Peticiones</p>
                            <p id="usage-month-requests" class="text-2xl font-bold text-blue-600">-</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Entrada</p>
                            <p id="usage-month-input" class="text-2xl font-bold text-green-600">-</p>
                        </div>
                        <div class="bg-purple-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Tokens Salida</p>
                            <p id="usage-month-output" class="text-2xl font-bold text-purple-600">-</p>
                        </div>
                        <div class="bg-amber-50 rounded-lg p-4 text-center">
                            <p class="text-xs text-gray-500 uppercase font-bold">Costo Estimado</p>
                            <p id="usage-month-cost" class="text-2xl font-bold text-amber-600">-</p>
                        </div>
                    </div>
                </div>

                <p class="text-xs text-gray-400 mt-4 text-right">* Costos estimados: $0.10 USD / 1M tokens entrada, $0.40 USD / 1M tokens salida (Gemini Flash)</p>
            </div>
        </div>
    </div>
`;


const AIChatSimulatorViewTemplate = () => `
    <div class="view-container flex flex-col h-full bg-gray-50">
        <div class="view-header flex-none bg-white p-4 border-b">
            <h1><i class="fas fa-robot text-purple-500 mr-2"></i> Simulador de Inteligencia Artificial</h1>
            <p class="text-sm text-gray-500 mt-1">Prueba la personalidad y respuestas de tu IA sin afectar contactos reales ni pagar costos de envío en WhatsApp.</p>
        </div>
        
        <div class="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4 overflow-hidden">
            <!-- Simulación de Pantalla de WhatsApp -->
            <div class="flex-1 bg-[#efeae2] rounded-t-xl border border-gray-300 shadow-inner flex flex-col relative overflow-hidden" style="background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png');">
                <!-- Chat Header -->
                <div class="bg-[#075e54] text-white p-3 flex items-center gap-3 z-10 shadow-md">
                    <div class="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#075e54]">
                        <i class="fas fa-robot text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-bold">Asistente IA (Pruebas)</h3>
                        <p class="text-xs text-white/80">en línea</p>
                    </div>
                    <button class="ml-auto hover:bg-white/20 p-2 rounded-full transition-colors" onclick="clearSimulatorChat()">
                        <i class="fas fa-trash-alt"></i> Limpiar Chat
                    </button>
                </div>
                
                <!-- Chat History -->
                <div id="simulator-chat-history" class="flex-1 overflow-y-auto p-4 space-y-3" 
                     ondragover="event.preventDefault(); this.classList.add('bg-[#dcf8c6]', 'bg-opacity-50')" 
                     ondragleave="event.preventDefault(); this.classList.remove('bg-[#dcf8c6]', 'bg-opacity-50')" 
                     ondrop="handleSimulatorDrop(event); this.classList.remove('bg-[#dcf8c6]', 'bg-opacity-50')">
                    <div class="text-center my-4">
                        <span class="bg-[#e1f3fb] text-[#1f2937] text-xs px-3 py-1 rounded-lg inline-block shadow-sm">
                            <i class="fas fa-lock mr-1"></i> Los mensajes y llamadas están cifrados de extremo a extremo.
                        </span>
                    </div>
                    <!-- Messages will appear here -->
                </div>
                
                <div id="simulator-typing-indicator" class="hidden absolute bottom-2 left-4 bg-white px-4 py-2 rounded-xl rounded-bl-sm shadow-md flex items-center gap-2 z-10 w-fit">
                    <div class="flex items-center gap-1">
                        <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                        <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                        <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                    </div>
                    <span id="simulator-timer-text" class="text-xs text-gray-500 ml-2">Esperando (20s)</span>
                    <button onclick="skipSimulatorTimer()" class="ml-2 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded transition-colors" title="Responder ahora">
                        <i class="fas fa-forward"></i>
                    </button>
                </div>
            </div>

            <!-- Chat Input -->
            <div id="simulator-token-bar" class="bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-1.5 border border-t-0 border-gray-300 flex items-center justify-between text-xs text-gray-500 font-mono">
                <div class="flex items-center gap-3">
                    <span><i class="fas fa-arrow-up text-orange-400"></i> Nuevos: <b id="simulator-input-tokens" class="text-gray-700">0</b></span>
                    <span><i class="fas fa-database text-purple-400"></i> Cacheados: <b id="simulator-cached-tokens" class="text-purple-600">0</b></span>
                    <span><i class="fas fa-arrow-down text-green-400"></i> Salida: <b id="simulator-output-tokens" class="text-gray-700">0</b></span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-gray-400"><i class="fas fa-coins"></i> Total: <b id="simulator-total-tokens" class="text-gray-600">0</b></span>
                    <span class="text-green-600 font-semibold"><i class="fas fa-dollar-sign"></i> Costo: <b id="simulator-cost">$0.000000</b></span>
                </div>
            </div>
            <div class="bg-[#f0f0f0] p-3 rounded-b-xl border border-t-0 border-gray-300 flex flex-col gap-2 shadow-md">
                <div class="flex items-center gap-2 pl-2">
                    <label class="text-xs font-bold text-gray-500">Enviar como:</label>
                    <select id="simulator-role-select" class="text-xs border border-gray-300 rounded p-1 bg-white text-gray-700 outline-none cursor-pointer hover:border-gray-400 focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]">
                        <option value="user">Cliente</option>
                        <option value="assistant">Agente de Dekoor</option>
                    </select>
                </div>
                <div class="flex items-end gap-2">
                    <input type="file" id="simulator-media-upload" accept="image/*, audio/*" class="hidden" onchange="handleSimulatorMediaUpload(event)">
                    <button class="text-gray-500 hover:text-gray-700 p-2" onclick="document.getElementById('simulator-media-upload').click()"><i class="fas fa-paperclip text-xl"></i></button>
                    <button class="text-gray-500 hover:text-gray-700 p-2"><i class="far fa-smile text-xl"></i></button>
                    <div class="flex-1 bg-white rounded-lg px-2 py-2 shadow-sm flex flex-col justify-center min-h-[44px]">
                        <div id="simulator-media-preview-container" class="hidden mb-2 relative inline-block w-fit">
                            <img id="simulator-image-preview" src="" class="hidden h-16 rounded border object-cover">
                            <audio id="simulator-audio-preview" controls class="hidden h-10 w-48 rounded"></audio>
                            <button onclick="removeSimulatorMedia()" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 shadow">&times;</button>
                        </div>
                        <textarea id="simulator-chat-input" class="w-full bg-transparent focus:outline-none resize-none max-h-32 text-[15px] px-2" rows="1" placeholder="Escribe un mensaje..." onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendSimulatorMessage(); }"></textarea>
                    </div>
                    <button id="simulator-send-btn" onclick="sendSimulatorMessage()" class="bg-[#00a884] text-white w-11 h-11 rounded-full flex items-center justify-center hover:bg-[#008f6f] transition-colors shadow-sm flex-shrink-0">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>
    </div>
`;


const MetricsViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Métricas de Mensajes</h1>
        </div>
        <div id="metrics-loading" class="text-center p-8">
            <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
            <p class="mt-4 text-gray-600">Cargando datos generales...</p>
        </div>
        <div id="metrics-content" class="hidden">
            <div class="metrics-grid mb-8">
                <div class="chart-container">
                    <h2>Mensajes Recibidos por Día (Últimos 30 días)</h2>
                    <canvas id="daily-messages-chart"></canvas>
                </div>
                <div class="chart-container">
                    <h2>Distribución de Mensajes por Etiqueta (Últimos 30 días)</h2>
                    <canvas id="tags-distribution-chart"></canvas>
                </div>
            </div>

            <div class="settings-card mt-8">
                <h2 class="text-xl font-bold mb-4">Mensajes Entrantes por Anuncio</h2>
                <p class="text-sm text-gray-500 mb-4">Selecciona un rango de fechas para ver cuántos mensajes iniciales provinieron de cada Ad ID.</p>
                <div class="flex flex-wrap items-end gap-4 mb-4">
                    <div>
                        <label for="ad-metrics-date-range" class="font-semibold text-xs">Rango de Fechas:</label>
                        <input type="text" id="ad-metrics-date-range" placeholder="Seleccionar rango..." readonly class="!mb-0 cursor-pointer">
                    </div>
                    <button id="load-ad-metrics-btn" class="btn btn-primary btn-sm"><i class="fas fa-sync-alt mr-2"></i>Cargar Datos</button>
                    <button id="clear-ad-metrics-filter-btn" class="btn btn-subtle btn-sm"><i class="fas fa-times mr-2"></i>Limpiar</button>
                </div>
                <div id="ad-metrics-results-container">
                    <div id="ad-metrics-loading" class="text-center text-gray-500 py-4 hidden">
                        <i class="fas fa-spinner fa-spin mr-2"></i> Cargando métricas de anuncios...
                    </div>
                    <div id="ad-metrics-no-data" class="text-center text-gray-500 py-4 hidden">
                        No se encontraron mensajes de anuncios para el período seleccionado.
                    </div>
                    <div id="ad-metrics-table-container" class="mt-4 hidden">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>ID del Anuncio (Ad ID)</th>
                                    <th>Número de Mensajes Recibidos</th>
                                </tr>
                            </thead>
                            <tbody id="ad-metrics-table-body">
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
`;

// --- Vista: Rescate IA (seguimiento de pedidos en proceso) ---
const OrderFollowupViewTemplate = () => `
    <div class="view-container">
        <div class="view-header">
            <h1>Rescate IA · Pedidos en proceso</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2 mb-4">
            <button class="btn btn-subtle btn-sm rescate-range-btn" data-days="1">Hoy</button>
            <button class="btn btn-subtle btn-sm rescate-range-btn active" data-days="7">7 días</button>
            <button class="btn btn-subtle btn-sm rescate-range-btn" data-days="30">30 días</button>
            <button id="rescate-refresh" class="btn btn-primary btn-sm"><i class="fas fa-sync-alt mr-2"></i>Actualizar</button>
        </div>

        <div id="rescate-loading" class="text-center p-8">
            <i class="fas fa-spinner fa-spin text-4xl" style="color:var(--color-text-light)"></i>
            <p class="mt-4" style="color:var(--color-text-light)">Cargando métricas de rescate...</p>
        </div>

        <div id="rescate-content" class="hidden">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;">
                ${['Contactados','Respondieron','Recuperados','$ recuperado'].map((label, i) => `
                <div style="background:var(--color-container-bg);border:1px solid var(--color-border);border-radius:14px;padding:16px;box-shadow:0 1px 3px var(--color-shadow);">
                    <div style="font-size:12px;color:var(--color-text-light);font-weight:600;text-transform:uppercase;letter-spacing:.03em;">${label}</div>
                    <div style="font-size:28px;font-weight:800;color:var(--color-text);line-height:1.2;margin-top:4px;" id="kpi-${['contacted','replied','converted','value'][i]}">—</div>
                    <div style="font-size:12px;color:var(--color-text-light);margin-top:2px;" id="kpi-${['contacted','replied','converted','value'][i]}-sub">&nbsp;</div>
                </div>`).join('')}
            </div>

            <div class="settings-card mt-6">
                <h2 class="text-xl font-bold mb-1">Tendencia</h2>
                <p class="text-sm mb-3" style="color:var(--color-text-light)">Contactados vs. recuperados por día en el rango seleccionado.</p>
                <div style="position:relative;height:260px;"><canvas id="rescate-trend-chart"></canvas></div>
            </div>

            <div class="settings-card mt-6">
                <h2 class="text-xl font-bold mb-1">Clientes contactados</h2>
                <p class="text-sm mb-3" style="color:var(--color-text-light)">Quién recibió mensaje del sistema y en qué quedó. Haz clic en una fila para abrir el chat.</p>
                <div class="flex flex-wrap gap-2 mb-3">
                    <button class="btn btn-subtle btn-sm rescate-status-btn active" data-status="">Todos</button>
                    <button class="btn btn-subtle btn-sm rescate-status-btn" data-status="contacted">Sin responder</button>
                    <button class="btn btn-subtle btn-sm rescate-status-btn" data-status="replied">Respondieron</button>
                    <button class="btn btn-subtle btn-sm rescate-status-btn" data-status="converted">Recuperados</button>
                </div>
                <div class="overflow-x-auto">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Cliente</th>
                                <th>Teléfono</th>
                                <th>Quedó pendiente</th>
                                <th>Msgs</th>
                                <th>Estado</th>
                                <th>Último contacto</th>
                            </tr>
                        </thead>
                        <tbody id="rescate-table-body"></tbody>
                    </table>
                    <div id="rescate-empty" class="text-center py-6 hidden" style="color:var(--color-text-light)">Sin registros en este rango.</div>
                </div>
            </div>
        </div>
    </div>
`;

// --- Vista unificada IA: sub-pestañas Entrenamiento · Simulador · Rescate ---
const AIHubViewTemplate = () => `
    <div class="ia-hub">
        <div class="ia-tabs">
            <button class="ia-tab active" data-iatab="entrenamiento" onclick="switchIaTab('entrenamiento')"><i class="fas fa-brain mr-2"></i>Entrenamiento IA</button>
            <button class="ia-tab" data-iatab="simulador" onclick="switchIaTab('simulador')"><i class="fas fa-robot mr-2"></i>Simulador IA</button>
            <button class="ia-tab" data-iatab="rescate" onclick="switchIaTab('rescate')"><i class="fas fa-hand-holding-heart mr-2"></i>Rescate IA</button>
        </div>
        <div class="ia-panes">
            <div class="ia-pane active" data-iapane="entrenamiento">${AITrainingViewTemplate()}</div>
            <div class="ia-pane" data-iapane="simulador">${AIChatSimulatorViewTemplate()}</div>
            <div class="ia-pane" data-iapane="rescate">${OrderFollowupViewTemplate()}</div>
        </div>
    </div>
`;

// --- PLANTILLAS DE COMPONENTES ---

const UserIcon = (contact, size = 'h-9 w-9') => {
    // Pedido pagado/confirmado → insignia de elefante con fondo navy
    if (contact && contact.purchaseStatus === 'completed') {
         return `<div class="${size} rounded-full flex-shrink-0 dekoor-avatar" title="Pedido pagado">
                <img src="/img/elefante-pagado.png?v=2" alt="Pagado" class="dekoor-avatar-img" loading="lazy">
            </div>`;
    }

    // Pedido registrado sin pagar → insignia de elefante con fondo claro
    if (contact && contact.purchaseStatus === 'registered') {
         return `<div class="${size} rounded-full flex-shrink-0 dekoor-avatar" title="Pedido registrado (sin pagar)">
                <img src="/img/elefante-registrado.png?v=2" alt="Registrado" class="dekoor-avatar-img" loading="lazy">
            </div>`;
    }

    if (contact && contact.profileImageUrl) {
        // Las URLs de foto de FB/IG (profile_pic) expiran. Mostramos las iniciales como
        // capa base y la foto encima; si la foto falla, se quita y quedan las iniciales.
        const imgTag = state.tags.find(t => t.key === contact.status);
        const imgBg = imgTag ? imgTag.color : '#d1d5db';
        const imgInitial = contact.name ? contact.name.charAt(0).toUpperCase() : '?';
        return `<div class="${size} rounded-full flex-shrink-0 relative" style="overflow:visible;">
                    <div class="w-full h-full rounded-full flex items-center justify-center text-white font-bold absolute inset-0" style="background-color:${imgBg};">${imgInitial}</div>
                    <img src="${contact.profileImageUrl}" alt="${contact.name || ''}" class="w-full h-full rounded-full object-cover absolute inset-0" loading="lazy" onerror="this.remove()">
                </div>`;
    }

    const contactStatusKey = contact.status;
    const tag = state.tags.find(t => t.key === contactStatusKey);
    const bgColor = tag ? tag.color : '#d1d5db';
    const initial = contact.name ? contact.name.charAt(0).toUpperCase() : '?';

    return `<div class="${size} rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold" style="background-color: ${bgColor};">
                ${initial}
            </div>`;
};

const ContactItemTemplate = (contact, isSelected, vsStyle = '') => {
    const typingText = contact.lastMessage || 'Sin mensajes.';

    let timeHTML = '';
    if (contact.lastMessageTimestamp) {
        const date = contact.lastMessageTimestamp;
        const timeString = isSameDay(new Date(), date)
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        timeHTML = `<span class="contact-time-label">${timeString}</span>`;
    }

    // En filtro de diseño, mostrar designUnreadCount; en vista normal, mostrar unreadCount
    const displayUnread = state.designReviewFilter ? (contact.designUnreadCount || 0) : (contact.unreadCount || 0);
    const unreadBadgeHTML = displayUnread > 0
        ? `<span class="unread-badge">${displayUnread}</span>`
        : '';

    const timeOrBadgeHTML = timeHTML + unreadBadgeHTML;

    const orderBadgeHTML = contact.lastOrderNumber
        ? `<span class="order-badge">DH${contact.lastOrderNumber}</span>`
        : '';
    
    // Departamento/campaña: punto de 8px junto al nombre (no barra vertical de color)
    const deptColor = (state._deptColorMap && state._deptColorMap.get(contact.assignedDepartmentId)) || null;
    const deptName = (deptColor && state.departments) ? (state.departments.find(d => d.id === contact.assignedDepartmentId)?.name || 'Campaña') : '';
    const deptDot = deptColor ? `<span class="dept-dot" style="background:${deptColor}" title="${deptName.replace(/"/g,'')}"></span>` : '';
    const itemStyle = `style="${vsStyle}"`;

    const mainContent = `
        <div class="flex-grow overflow-hidden ml-2">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-sm truncate flex items-center">
                    ${deptDot}<i class="${contact.channel === 'instagram' ? 'fab fa-instagram text-pink-500' : contact.channel === 'messenger' ? 'fab fa-facebook-messenger text-blue-500' : 'fab fa-whatsapp text-green-500'} mr-1 text-[10px]"></i>
                    <span class="truncate">${contact.name || 'Desconocido'}</span>
                    ${contact.botActive ? '<i class="fas fa-robot text-green-500 ml-1 text-[10px]" title="IA Activa"></i>' : ''}
                    ${contact.inDesignReview ? '<i class="fas fa-paint-brush text-gray-400 ml-1 text-[10px]" title="En diseño"></i>' : ''}
                </h3>
                <div class="contact-meta">
                     ${timeOrBadgeHTML}
                     <button type="button" class="preview-icon" onclick="event.stopPropagation(); openConversationPreview(event, '${contact.id}')" title="Ver conversación">
                        <i class="fas fa-eye"></i>
                     </button>
                     <button type="button" class="preview-icon" onclick="event.stopPropagation(); handleMarkAsUnread(event, '${contact.id}')" title="Marcar como no leído">
                        <i class="fas fa-envelope"></i>
                     </button>
                     <button type="button" class="preview-icon" onclick="event.stopPropagation(); handleArchiveChat(event, '${contact.id}')" title="${contact.archived ? 'Desarchivar chat' : 'Archivar chat'}">
                        <i class="fas fa-${contact.archived ? 'inbox' : 'box-archive'}"></i>
                     </button>
                </div>
            </div>
            <div class="flex justify-between items-center">
                <p class="text-xs truncate pr-2 text-gray-500">${typingText}</p>
                ${orderBadgeHTML}
            </div>
        </div>`;

    const onClickAction = `onclick="handleSelectContact('${contact.id}')"`;
    const aiActive = contact.botActive === true;
    const aiClass = aiActive ? 'ai-active' : '';

    return `<div ${onClickAction} class="contact-item flex items-center p-1.5 cursor-pointer ${isSelected ? 'selected' : ''} ${aiClass}" data-contact-id="${contact.id}" ${itemStyle}>
                ${UserIcon(contact)}
                ${mainContent}
            </div>`;
};

// Identificador legible del contacto según el canal:
// WhatsApp -> teléfono (+número); Instagram -> @usuario (o "Instagram" si no se obtuvo); Messenger -> "Facebook Messenger".
const ContactHandleTemplate = (contact) => {
    if (contact.channel === 'messenger') return 'Facebook Messenger';
    if (contact.channel === 'instagram') return contact.igUsername ? `@${contact.igUsername}` : 'Instagram';
    return `+${contact.id}`;
};

// Formatea un momento (ms) como etiqueta corta para la UI de programación:
// "hoy 17:00", "mañana 09:00" o "25/6 17:00".
const formatScheduleLabel = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (d.toDateString() === now.toDateString()) return `hoy ${time}`;
    if (d.toDateString() === tomorrow.toDateString()) return `mañana ${time}`;
    return `${d.getDate()}/${d.getMonth() + 1} ${time}`;
};

const MessageStatusIconTemplate = (status, readAt, error) => {
    const sentColor = '#9ca3af';
    const readColor = '#53bdeb';
    switch (status) {
        case 'failed': {
            // Razón amigable del fallo (guardada por el webhook de estados de Meta)
            let reason = 'Mensaje no entregado';
            if (error && error.code === 131047) {
                reason = 'No entregado: el cliente lleva más de 24h sin escribir. Usa una plantilla.';
            } else if (error && (error.title || error.detail)) {
                reason = `No entregado: ${error.detail || error.title}`;
            }
            const safeReason = String(reason).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return `<i class="fas fa-exclamation-circle message-status-icon" style="color: #ef4444;" title="${safeReason}"></i>`;
        }
        case 'pending': return `<i class="far fa-clock message-status-icon" style="color: ${sentColor};"></i>`;
        case 'queued': return `<i class="far fa-clock message-status-icon" style="color: #60a5fa;"></i>`;
        case 'scheduled': return `<i class="far fa-clock message-status-icon" style="color: #8b5cf6;"></i>`;
        case 'read': {
            const secs = readAt && typeof readAt.seconds === 'number' ? readAt.seconds : null;
            // Si tenemos la hora de lectura, la palomita es clickeable para mostrarla
            if (secs) {
                return `<i class="fas fa-check-double message-status-read message-status-read--clickable" style="color: ${readColor};" onclick="showReadReceipt(event, ${secs})" title="Ver hora de visto"></i>`;
            }
            return `<i class="fas fa-check-double message-status-read" style="color: ${readColor};"></i>`;
        }
        case 'delivered': return `<i class="fas fa-check-double" style="color: ${sentColor};"></i>`;
        case 'sent': return `<i class="fas fa-check" style="color: ${sentColor};"></i>`;
        default: return '';
    }
};

// Reescribe URLs storage.googleapis.com de nuestro bucket (privado: da 403 al público)
// hacia el proxy del backend, que firma una URL de lectura temporal. Las URLs con token
// de Firebase (firebasestorage.googleapis.com) y las rutas relativas pasan sin cambios.
const resolveMediaUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    const m = url.match(/^https?:\/\/storage\.googleapis\.com\/[^/]+\/(.+)$/i);
    if (!m) return url;
    return `${API_BASE_URL}/api/wa/file?path=${encodeURIComponent(m[1].split('?')[0])}`;
};

const RepliedMessagePreviewTemplate = (originalMessage, targetId = '') => {
    if (!originalMessage) return '';

    const authorName = originalMessage.from === state.selectedContactId
        ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente'
        : 'Tú';

    let textPreview = '';
    if ((originalMessage.type === 'image' || originalMessage.fileType?.startsWith('image/')) && originalMessage.fileUrl) {
        const caption = originalMessage.text && originalMessage.text !== '📷 Imagen' ? originalMessage.text : '';
        let captionHtml = caption ? `<div class="reply-media-text"><p class="reply-media-caption">${caption}</p></div>` : '';
        textPreview = `<div class="reply-media-preview"><img src="${resolveMediaUrl(originalMessage.fileUrl)}" alt="Miniatura de respuesta" class="reply-thumbnail">${captionHtml}</div>`;
    } else {
        let plainText = originalMessage.text || 'Mensaje';
        if (originalMessage.type === 'audio') plainText = '🎤 Mensaje de voz';
        else if (originalMessage.type === 'video' || originalMessage.fileType?.startsWith('video/')) plainText = '🎥 Video';
        else if (originalMessage.type === 'location') plainText = '📍 Ubicación';
        else if (originalMessage.fileType) plainText = '📄 Documento';
        textPreview = `<p class="reply-text">${plainText}</p>`;
    }

    const targetAttr = targetId ? ` data-target-id="${targetId}"` : '';
    return `<div class="reply-preview"${targetAttr} title="Ir al mensaje original"><p class="reply-author">${authorName}</p>${textPreview}</div>`;
};

const MessageBubbleTemplate = (message) => {
    const isSent = message.from !== state.selectedContactId;
    const time = message.timestamp && typeof message.timestamp.seconds === 'number'
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    let contentHTML = '';
    let bubbleExtraClass = '';
    let timeAndStatusHTML = `<div class="text-xs text-right mt-1 opacity-70 flex justify-end items-center space-x-2"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status, message.readAt, message.error) : ''}</div>`;

    const defaultTexts = ['📷 Imagen', '🎥 Video', '🎵 Audio', '📄 Documento', 'Sticker'];
    
    const hasText = message.text &&
                    !defaultTexts.includes(message.text) &&
                    !/^(🎤|🎵|📷|🎥|📄|Sticker)/.test(message.text);

    // Si la subida del medio a Storage falló, el backend deja un proxy en
    // mediaProxyUrl. Lo usamos como respaldo de fileUrl. Los mensajes viejos
    // guardaron el proxy con prefijo /api por error; la ruta real es /webhook.
    let effectiveFileUrl = message.fileUrl || message.mediaProxyUrl || null;
    if (effectiveFileUrl && effectiveFileUrl.startsWith('/api/wa/media/')) {
        effectiveFileUrl = effectiveFileUrl.replace('/api/wa/media/', '/webhook/wa/media/');
    }

    if (effectiveFileUrl && message.fileType) {
        if (message.type === 'sticker') {
            const fullStickerUrl = resolveMediaUrl(effectiveFileUrl.startsWith('http') ? effectiveFileUrl : `${API_BASE_URL}${effectiveFileUrl}`);
            contentHTML += `<img src="${fullStickerUrl}" alt="Sticker" class="chat-sticker-preview">`;
        } else if (message.fileType.startsWith('image/')) {
            bubbleExtraClass = 'has-image';
            const bubbleBgColor = isSent ? 'var(--color-bubble-sent-bg)' : 'var(--color-bubble-received-bg)';
            const fullImageUrl = resolveMediaUrl(effectiveFileUrl.startsWith('http') ? effectiveFileUrl : `${API_BASE_URL}${effectiveFileUrl}`);
            contentHTML += `<div style="background-color: ${bubbleBgColor}" class="rounded-lg overflow-hidden"><img src="${fullImageUrl}" alt="Imagen enviada" class="chat-image-preview" onclick="openImageModal('${fullImageUrl}')">${hasText ? `<div class="p-2 pt-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>` : ''}<div class="time-overlay"><span>${time}</span>${isSent ? MessageStatusIconTemplate(message.status, message.readAt, message.error) : ''}</div></div>`;
            timeAndStatusHTML = '';
        } else if (message.fileType.startsWith('video/')) {
            bubbleExtraClass = 'has-video';
            // El cache-buster ?v= solo aplica a URLs remotas. Las URLs locales blob:/data:
            // (previsualización optimista al enviar) no admiten query string: si se les
            // pega ?v= el navegador no las encuentra (ERR_FILE_NOT_FOUND).
            const isLocalPreview = effectiveFileUrl.startsWith('blob:') || effectiveFileUrl.startsWith('data:');
            const separator = effectiveFileUrl.includes('?') ? '&' : '?';
            const videoUrl = (message.timestamp && !isLocalPreview)
                ? `${effectiveFileUrl}${separator}v=${message.timestamp.seconds}`
                : effectiveFileUrl;
            const fullVideoUrl = resolveMediaUrl(videoUrl.startsWith('http') ? videoUrl : `${API_BASE_URL}${videoUrl}`);
            contentHTML += `<video controls playsinline preload="metadata" class="video rounded-lg mb-1" src="${fullVideoUrl}" onclick="event.stopPropagation()">Tu navegador no soporta videos.</video>`;
            if(hasText) contentHTML += `<div class="px-1"><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
        } else if (message.fileType.startsWith('audio/')) {
             const audioSrc = resolveMediaUrl(effectiveFileUrl.startsWith('http') ? effectiveFileUrl : `${API_BASE_URL}${effectiveFileUrl}`);
             contentHTML += `<audio controls preload="metadata" class="chat-audio-player"><source src="${audioSrc}" type="${message.fileType}">Tu navegador no soporta audio.</audio>`;
        } else if (message.type === 'document' || message.fileType.startsWith('application/') || message.fileType.startsWith('text/')) {
            const fullDocUrl = resolveMediaUrl(effectiveFileUrl.startsWith('http') ? effectiveFileUrl : `${API_BASE_URL}${effectiveFileUrl}`);
            contentHTML += `<a href="${fullDocUrl}" target="_blank" rel="noopener noreferrer" class="document-link"><i class="fas fa-file-alt document-icon"></i><span class="document-text">${message.document?.filename || message.text || 'Ver Documento'}</span></a>`;
        }
    } else if (message.type === 'location' && message.location) {
        const { latitude, longitude, name, address } = message.location;
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
        contentHTML += `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="block text-blue-600 hover:underline"><div class="font-semibold"><i class="fas fa-map-marker-alt mr-2 text-red-500"></i>${name || 'Ubicación'}</div>${address ? `<p class="text-xs text-gray-500 mt-1">${address}</p>` : ''}<p class="text-xs mt-1">Toca para ver en el mapa</p></a>`;
    } else if (message.type === 'sticker') {
        contentHTML += `<div class="sticker-fallback"><i class="far fa-sticky-note"></i><span>Sticker</span></div>`;
    } else if (message.text) {
         contentHTML += `<div><p class="break-words">${formatWhatsAppText(message.text)}</p></div>`;
    }

    // Footer y botones de plantilla (solo se muestran si vienen de un envio de template)
    let templateFooterHTML = '';
    if (message.templateFooter) {
        templateFooterHTML = `<div class="template-footer">${formatWhatsAppText(message.templateFooter)}</div>`;
    }
    let templateButtonsHTML = '';
    if (Array.isArray(message.templateButtons) && message.templateButtons.length > 0) {
        templateButtonsHTML = '<div class="template-buttons">' + message.templateButtons.map(b => {
            const label = b.text || b.type || 'Botón';
            if (b.type === 'URL' && b.url) {
                const safeUrl = b.url.replace(/\{\{1\}\}/g, '');
                return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="template-button template-button-url"><i class="fas fa-external-link-alt"></i> ${label}</a>`;
            }
            if (b.type === 'PHONE_NUMBER' && b.phone_number) {
                return `<a href="tel:${b.phone_number}" class="template-button template-button-phone"><i class="fas fa-phone"></i> ${label}</a>`;
            }
            return `<span class="template-button template-button-reply"><i class="fas fa-reply"></i> ${label}</span>`;
        }).join('') + '</div>';
    }
    if (templateFooterHTML || templateButtonsHTML) {
        contentHTML += templateFooterHTML + templateButtonsHTML;
    }

    let replyPreviewHTML = '';
    if (message.context && message.context.id) {
        const originalMessage = state.messages.find(m => m.id === message.context.id);
        replyPreviewHTML = RepliedMessagePreviewTemplate(originalMessage, message.context.id);
    }

    const copyButtonHTML = message.text ? `<button class="message-action-btn" onclick="copyFormattedText('${message.text.replace(/'/g, '\\\'')}', this)" title="Copiar"><i class="far fa-copy"></i></button>` : '';

    // Messenger no permite que la página reaccione a los mensajes (limitación de Meta),
    // así que ocultamos la barra de reacciones para esos contactos.
    const selectedChannel = state.contacts.find(c => c.id === state.selectedContactId)?.channel || 'whatsapp';
    const reactionBarHTML = selectedChannel === 'messenger' ? '' : `
             <div class="reaction-bar">
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '👍')">👍</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '❤️')">❤️</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😂')">😂</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '😢')">😢</button>
                <button class="reaction-emoji-btn" onclick="handleSelectReaction(event, '${message.docId}', '🙏')">🙏</button>
             </div>`;

    const actionsHTML = `
        <div class="message-actions">
             ${reactionBarHTML}
             <button class="message-action-btn" onclick="handleStartReply(event, '${message.docId}')" title="Responder"><i class="fas fa-reply"></i></button>
             <button class="message-action-btn" onclick="handleForwardMessage(event, '${message.docId}')" title="Reenviar"><i class="fas fa-share"></i></button>
             ${copyButtonHTML}
        </div>
    `;

    const reactionHTML = message.reaction ? `<div class="reactions-container ${isSent ? '' : 'received-reaction'}">${message.reaction}</div>` : '';

    const bubbleAlignment = isSent ? 'sent' : 'received';
    let bubbleClasses = isSent ? 'sent' : 'received';
    if (message.status === 'queued') bubbleClasses += ' message-queued';
    if (message.status === 'scheduled') bubbleClasses += ' message-scheduled';

    // Badge "Programado · HH:MM" con botón para cancelar, dentro de la burbuja.
    const scheduledMsForBadge = message.status === 'scheduled'
        ? (message.scheduledAt && message.scheduledAt.seconds ? message.scheduledAt.seconds * 1000
            : (typeof message.scheduledAt === 'number' ? message.scheduledAt
                : (message.timestamp && message.timestamp.seconds ? message.timestamp.seconds * 1000 : null)))
        : null;
    const scheduledBadgeHTML = message.status === 'scheduled'
        ? `<div class="scheduled-badge"><i class="far fa-clock"></i><span>Programado · ${formatScheduleLabel(scheduledMsForBadge)}</span><button class="scheduled-cancel-btn" onclick="cancelScheduledMessage('${message.docId}')" title="Cancelar envío programado"><i class="fas fa-times"></i></button></div>`
        : '';

    const msgIdAttr = message.id ? ` data-msg-id="${message.id}"` : '';
    return `
        <div class="message-group ${bubbleAlignment}${message.reaction ? ' has-reaction' : ''}" data-doc-id="${message.docId}"${msgIdAttr}>
            <div class="message-bubble ${bubbleClasses} ${bubbleExtraClass}">
                ${replyPreviewHTML}
                ${contentHTML}
                ${scheduledBadgeHTML}
                ${timeAndStatusHTML}
                ${reactionHTML}
                ${actionsHTML}
            </div>
        </div>`;
};

const NoteItemTemplate = (note) => {
    const time = note.timestamp ? new Date(note.timestamp.seconds * 1000).toLocaleString('es-ES') : 'Fecha desconocida';
    const isEditing = state.isEditingNote === note.id;

    return isEditing
        ? `<div class="note-item">
             <textarea id="edit-note-input-${note.id}" class="!mb-2" rows="3">${note.text}</textarea>
             <div class="flex justify-end gap-2">
               <button class="btn btn-subtle btn-sm" onclick="toggleEditNote(null)">Cancelar</button>
               <button class="btn btn-primary btn-sm" onclick="handleUpdateNote('${note.id}')">Guardar</button>
             </div>
           </div>`
        : `<div class="note-item">
             <p>${note.text}</p>
             <div class="note-meta">
               <span>${time}</span>
               <div class="note-actions">
                 <button onclick="toggleEditNote('${note.id}')" title="Editar nota"><i class="fas fa-pencil-alt"></i></button>
                 <button onclick="handleDeleteNote('${note.id}')" title="Eliminar nota"><i class="fas fa-trash-alt"></i></button>
               </div>
             </div>
           </div>`;
};

const LocalFilePreviewTemplate = (files) => {
    if (!Array.isArray(files)) files = [files];
    const items = files.map((file, index) => {
        const objectURL = URL.createObjectURL(file);
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        const isAudio = file.type.startsWith('audio/');
        const sizeMB = file.size / (1024 * 1024);
        const sizeText = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`;
        const shortName = file.name.length > 18 ? file.name.substring(0, 15) + '...' : file.name;
        let thumb;
        if (isImage) {
            thumb = `<img src="${objectURL}" alt="Vista previa" class="file-thumb">`;
        } else if (isVideo) {
            thumb = `<div class="file-thumb file-thumb-icon video"><i class="fas fa-play"></i></div>`;
        } else if (isAudio) {
            thumb = `<div class="file-thumb file-thumb-icon audio"><i class="fas fa-music"></i></div>`;
        } else {
            thumb = `<div class="file-thumb file-thumb-icon doc"><i class="fas fa-file-alt"></i></div>`;
        }
        return `<div class="file-preview-item">
            <button type="button" class="file-remove-btn" onclick="removeStagedFile(${index})" title="Quitar"><i class="fas fa-times"></i></button>
            ${thumb}
            <div class="file-preview-info">
                <span class="file-preview-name">${shortName}</span>
                <span class="file-preview-size">${sizeText}</span>
            </div>
        </div>`;
    }).join('');
    return `<div class="file-preview-grid">${items}</div>`;
};

const RemoteFilePreviewTemplate = (file) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');
    let previewElement;
    if (isImage) {
        previewElement = `<img src="${file.url}" alt="Vista previa">`;
    } else if (isVideo) {
        previewElement = `<video src="${file.url}" alt="Vista previa"></video>`;
    } else if (isAudio) {
        previewElement = `<div class="p-3"><i class="fas fa-music text-2xl text-gray-500"></i></div>`;
    } else {
        previewElement = `<div class="p-3"><i class="fas fa-file text-2xl text-gray-500"></i></div>`;
    }
    return ` <div class="file-preview-content"> <div id="cancel-file-btn" onclick="cancelStagedFile()"><i class="fas fa-times"></i></div> ${previewElement} <div class="ml-3 text-sm text-gray-600 truncate"> <p class="font-semibold">${file.name || 'Archivo adjunto'}</p></div> </div>`;
};

const StatusButtonsTemplate = (contact) => {
    let buttonsHtml = '<div class="status-btn-group">';

    // Botón especial para Pendientes IA (siempre visible)
    const isIAActive = contact.status === 'pendientes_ia';
    buttonsHtml += `<button
                        onclick="handleStatusChange('${contact.id}', 'pendientes_ia')"
                        class="status-btn ${isIAActive ? 'active' : ''}"
                        style="--btn-color: #8b5cf6;"
                        title="Marcar como Pendiente de Revisión IA"
                    >
                        <i class="fas fa-robot text-[10px] mr-1"></i> Pendientes IA
                    </button>`;

    // Verificar si algún tag del dropdown está activo
    const activeTag = state.tags.find(t => t.key === contact.status);
    const dropdownLabel = activeTag ? activeTag.label : '<i class="fas fa-ellipsis-h"></i>';

    // Dropdown con los demás tags
    let dropdownItems = '';
    state.tags.forEach(tag => {
        const isActive = contact.status === tag.key;
        dropdownItems += `<button
                            onclick="handleStatusChange('${contact.id}', '${tag.key}'); closeStatusDropdown();"
                            class="status-dropdown-item ${isActive ? 'active' : ''}"
                            style="--btn-color: ${tag.color};"
                        >
                            <span class="status-dropdown-dot" style="background-color: ${tag.color};"></span>
                            ${tag.label}
                        </button>`;
    });

    buttonsHtml += `<div class="status-dropdown-wrapper">
        <button class="status-btn status-dropdown-toggle ${activeTag ? 'active' : ''}"
                style="--btn-color: ${activeTag ? activeTag.color : '#6b7280'};"
                onclick="toggleStatusDropdown(event)">
            ${dropdownLabel}
        </button>
        <div class="status-dropdown-menu hidden">
            ${dropdownItems}
        </div>
    </div>`;

    buttonsHtml += '</div>';
    return buttonsHtml;
};

// Control compacto de etiqueta para el header del chat: un icono de etiqueta
// junto al nombre que abre el dropdown de tags (reemplaza a los "tres puntos").
const HeaderTagControlTemplate = (contact) => {
    const activeTag = state.tags.find(t => t.key === contact.status);
    const iconColor = activeTag ? activeTag.color : 'var(--color-text-light)';

    const dropdownItems = state.tags.map(tag => {
        const isActive = contact.status === tag.key;
        return `<button
                    onclick="handleStatusChange('${contact.id}', '${tag.key}'); closeStatusDropdown();"
                    class="status-dropdown-item ${isActive ? 'active' : ''}"
                    style="--btn-color: ${tag.color};">
                    <span class="status-dropdown-dot" style="background-color: ${tag.color};"></span>
                    ${tag.label}
                </button>`;
    }).join('');

    return `<div class="status-dropdown-wrapper header-tag-control">
        <button class="header-tag-btn ${activeTag ? 'active' : ''}" style="color: ${iconColor};"
                onclick="toggleStatusDropdown(event)"
                title="${activeTag ? 'Etiqueta: ' + activeTag.label : 'Asignar etiqueta'}">
            <i class="fas fa-tag"></i>
        </button>
        <div class="status-dropdown-menu hidden">${dropdownItems}</div>
    </div>`;
};

// Toggle "Pendientes IA" para el panel derecho (movido desde el header del chat).
const PendingAiToggleTemplate = (contact) => {
    const isIAActive = contact.status === 'pendientes_ia';
    return `<button onclick="handleStatusChange('${contact.id}', 'pendientes_ia')"
                class="pending-ai-toggle ${isIAActive ? 'active' : ''}"
                title="${isIAActive ? 'Quitar de Pendientes IA' : 'Marcar como Pendiente de Revisión IA'}">
                <i class="fas fa-robot mr-2"></i>
                <span>Pendientes de revisión IA</span>
                ${isIAActive ? '<i class="fas fa-check ml-auto"></i>' : ''}
            </button>`;
};

const ReplyContextBarTemplate = (message) => {
    if (!message) return '';
    const authorName = message.from === state.selectedContactId ? state.contacts.find(c => c.id === state.selectedContactId)?.name || 'Cliente' : 'Tú';
    const textPreview = message.text || (message.fileType ? `📷 Archivo` : '');
    return `
        <button id="cancel-reply-btn" onclick="cancelReply()"><i class="fas fa-times"></i></button>
        <div class="reply-preview !p-0 !border-l-2 !m-0">
            <p class="reply-author">Respondiendo a ${authorName}</p>
            <p class="reply-text">${textPreview}</p>
        </div>
    `;
};

// Extrae milisegundos de un timestamp de Firestore en cualquiera de sus formas
// (Timestamp en vivo con .toDate(), serializado {_seconds}, {seconds}, Date o string ISO).
const referralTimeMs = (ts) => {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') { const t = Date.parse(ts); return isNaN(t) ? 0 : t; }
    return 0;
};

const formatReferralDate = (ts) => {
    const ms = referralTimeMs(ts);
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

const AdReferralBannerTemplate = (contact) => {
    if (!contact) return '';

    // Usar el historial completo si existe; si no, caer al adReferral único (retrocompatibilidad).
    let referrals = (Array.isArray(contact.adReferralHistory) && contact.adReferralHistory.length)
        ? [...contact.adReferralHistory]
        : (contact.adReferral ? [contact.adReferral] : []);

    referrals = referrals.filter(r => r && r.source_id);
    if (referrals.length === 0) return '';

    // Ordenar cronológicamente (más antiguo primero). Las entradas sin fecha (anteriores a esta función)
    // tienen tiempo 0, por lo que quedan al inicio: son las más antiguas.
    referrals.sort((a, b) => referralTimeMs(a.firstSeenAt) - referralTimeMs(b.firstSeenAt));

    const isMulti = referrals.length > 1;

    const rows = referrals.map((ref, i) => {
        const isPost = ref.source_type === 'post';
        const typeLabel = isPost ? 'Publicación' : 'Anuncio';
        const name = ref.ad_name || ref.headline || ref.body || '';
        const dateStr = formatReferralDate(ref.firstSeenAt);
        const url = ref.source_url || '';

        const orderNum = isMulti ? `<span class="ad-referral-seq">${i + 1}</span>` : '';
        const numberBadge = `<span class="ad-referral-number" title="ID del ${typeLabel.toLowerCase()} en Meta">#${ref.source_id}</span>`;
        const nameHTML = name ? `<span class="ad-referral-name" title="${name}">${name}</span>` : '';
        const dateHTML = dateStr ? `<span class="ad-referral-date">${dateStr}</span>` : '';
        const linkHTML = url
            ? `<a href="${url}" target="_blank" class="ad-referral-link" title="Ver ${typeLabel.toLowerCase()} original"><i class="fas fa-external-link-alt"></i></a>`
            : '';

        return `
            <div class="ad-referral-item">
                ${orderNum}
                <div class="ad-referral-item-text">
                    ${numberBadge}
                    ${nameHTML}
                    ${dateHTML}
                </div>
                ${linkHTML}
            </div>`;
    }).join('');

    // Etiqueta de cabecera: tipo del primer origen, o "anuncios" si hay varios de distintos tipos.
    const firstIsPost = referrals[0].source_type === 'post';
    const headerLabel = isMulti
        ? `Origen: Meta · ${referrals.length} anuncios`
        : `Origen: Meta ${firstIsPost ? 'Publicación' : 'Anuncio'}`;
    const headerIcon = firstIsPost ? 'fa-share-square' : 'fa-bullhorn';

    return `
        <div class="ad-referral-banner ${isMulti ? 'ad-referral-banner-multi' : ''}">
            <button type="button" class="ad-referral-header" onclick="this.closest('.ad-referral-banner').classList.toggle('expanded')" title="Ver anuncios de origen">
                <span class="ad-referral-icon"><i class="fas ${headerIcon}"></i></span>
                <span class="ad-referral-label">${headerLabel}</span>
                <i class="fas fa-chevron-down ad-referral-chevron"></i>
            </button>
            <div class="ad-referral-list">${rows}</div>
        </div>
    `;
};

// Insignia de "pedido en proceso" en el header del chat. Lee de un caché en state
// que llena fetchOrderPending(contactId) al seleccionar el chat (sobrevive re-renders).
function OrderPendingBadge(contact) {
    if (!contact) return '';
    const cache = (typeof state !== 'undefined' && state.orderPendingByContact) || {};
    const info = cache[contact.id];
    if (!info) return '';
    const id = String(contact.id).replace(/'/g, "\\'");
    const pillBase = 'display:inline-flex;align-items:center;gap:4px;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;';
    const iconBtn = 'background:none;border:none;color:#fff;cursor:pointer;padding:0 0 0 4px;font-size:11px;line-height:1;';

    // Apagado manual por el operador: pill silenciada + botón para reactivar.
    if (info.optOut) {
        return `<span class="order-pending-pill" title="Recordatorios de pedido apagados para este chat" style="${pillBase}background:var(--color-text-secondary,#6b7280);"><i class="fas fa-bell-slash"></i> Recordatorios apagados<button onclick="event.stopPropagation(); toggleOrderFollowupOptOut('${id}', false)" title="Reactivar recordatorios de pedido" style="${iconBtn}"><i class="fas fa-rotate-left"></i></button></span>`;
    }

    if (!info.exists) return '';
    if (info.status === 'converted') {
        const ord = info.orderNumber ? ` ${String(info.orderNumber).replace(/</g, '&lt;')}` : '';
        return `<span class="order-pending-pill" title="Pedido recuperado por seguimiento IA" style="${pillBase}background:var(--color-success);"><i class="fas fa-check"></i> Recuperado${ord}</span>`;
    }
    if (!info.pendiente) return '';
    const color = info.status === 'replied' ? 'var(--color-primary)' : 'var(--color-info)';
    const pend = String(info.pendiente).replace(/</g, '&lt;');
    return `<span class="order-pending-pill" title="Seguimiento IA · quedó pendiente" style="${pillBase}background:${color};"><i class="fas fa-hourglass-half"></i> ${pend}<button onclick="event.stopPropagation(); toggleOrderFollowupOptOut('${id}', true)" title="Apagar recordatorios de pedido para este chat" style="${iconBtn}"><i class="fas fa-bell-slash"></i></button></span>`;
}

// Insignia de "recordatorio programado" en el header del chat. Lee de un caché en
// state que llena fetchReminder(contactId) al seleccionar el chat. Clic = editar.
function ReminderBadge(contact) {
    if (!contact) return '';
    const cache = (typeof state !== 'undefined' && state.reminderByContact) || {};
    const info = cache[contact.id];
    if (!info || !info.exists || info.status !== 'scheduled') return '';
    let label = '';
    if (info.remindDate) {
        const m = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const p = String(info.remindDate).split('-'); // YYYY-MM-DD
        if (p.length === 3) label = `${parseInt(p[2], 10)} ${m[parseInt(p[1], 10) - 1] || ''}`;
    }
    const src = info.source === 'ai' ? ' · IA' : '';
    return `<button type="button" onclick="openReminderModal('${contact.id}')" class="order-pending-pill" title="Recordatorio programado${src} — clic para ver o editar" style="display:inline-flex;align-items:center;gap:4px;background:#4f46e5;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;border:none;cursor:pointer;"><i class="fas fa-calendar-check"></i> ${label}</button>`;
}

const ChatWindowTemplate = (contact) => {
    const emptyChat = `<div class="flex-1 flex flex-col items-center justify-center text-gray-500 bg-opacity-50 bg-white"><i class="fas fa-comments text-8xl mb-4 text-gray-300"></i><h2 class="text-xl font-semibold">Selecciona un chat para empezar</h2><p>Mantén tu CRM conectado y organizado.</p></div>`;
    if (!contact) { return emptyChat; }

    // --- Departamento: punto de color de 8px (no franja de color en el header) ---
    let headerStyle = '';
    let deptDotHTML = '';
    if (contact.assignedDepartmentId) {
        const department = state.departments.find(d => d.id === contact.assignedDepartmentId);
        if (department && department.color) {
            deptDotHTML = `<span class="dept-dot" style="background:${department.color}" title="${(department.name || 'Departamento').replace(/"/g,'')}"></span>`;
        }
    }
    // --- Fin lógica de departamento ---

    const isSessionExpired = state.isSessionExpired;

    const scheduleInfo = state.scheduleByContact && state.scheduleByContact[contact.id];
    const scheduleActive = !!(scheduleInfo && scheduleInfo.scheduledAt && scheduleInfo.scheduledAt > Date.now());

    const sessionExpiredNotification = isSessionExpired
        ? `<div class="session-expired-banner">
             <i class="fas fa-lock mr-2"></i> Chat cerrado. Envía una plantilla para reactivar.
           </div>`
        : '';

    const isMobileWidth = typeof window !== 'undefined' && window.innerWidth <= 768;
    const placeholderText = isSessionExpired
        ? (isMobileWidth ? 'Ventana de 24h cerrada' : 'La ventana de 24h ha cerrado. Los mensajes se encolarán.')
        : (isMobileWidth ? 'Mensaje' : 'Escribe un mensaje o usa / para respuestas rápidas...');

    // Autocorrector ortográfico (IA): ON por defecto, recordando la preferencia en localStorage.
    const spellcheckOn = (typeof localStorage === 'undefined') || localStorage.getItem('crm_spellcheck_enabled') !== '0';

    const footerContent = `
        <form id="message-form" class="flex items-center space-x-3">
             <label for="file-input" class="cursor-pointer p-2 chat-icon-btn"><i class="fas fa-paperclip text-xl"></i></label>
             <input type="file" id="file-input" onchange="handleFileInputChange(event)" accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" multiple>
             <button type="button" id="emoji-toggle-btn" onclick="toggleEmojiPicker()" class="p-2 chat-icon-btn"><i class="far fa-smile text-xl"></i></button>
             ${contact.channel !== 'messenger' ? '<button type="button" id="template-toggle-btn" onclick="toggleTemplatePicker()" class="p-2 chat-icon-btn" title="Enviar plantilla"><i class="fas fa-scroll"></i></button>' : ''}
             <button type="button" id="schedule-toggle-btn" onclick="toggleScheduleMode()" class="p-2 chat-icon-btn ${scheduleActive ? 'schedule-active' : ''}" title="Programar envío"><i class="fas fa-clock text-xl"></i></button>
             <button type="button" id="spellcheck-toggle-btn" onclick="toggleSpellcheck()" class="p-2 chat-icon-btn ${spellcheckOn ? 'spellcheck-active' : ''}" title="Autocorrector de ortografía (IA) — corrige mientras escribes"><i class="fas fa-spell-check text-xl"></i></button>
             <textarea id="message-input" placeholder="${placeholderText}" class="flex-1 !mb-0" rows="1"></textarea>
             <button type="submit" class="btn btn-primary rounded-full w-12 h-12 p-0"><i class="fas fa-paper-plane text-lg"></i></button>
        </form>`;

    const mainContent = `<div class="relative flex-1 flex flex-col min-h-0">
             <main id="messages-container" class="flex-1 p-4 overflow-y-auto">
                <div id="sticky-date-header" class="date-separator"></div>
                <div id="messages-content"></div>
                <!-- Espaciador para que el indicador flotante no tape el último mensaje -->
                <div id="ai-typing-spacer" class="h-16 hidden"></div>
             </main>
             <div id="ai-typing-indicator" class="hidden absolute bottom-4 left-4 bg-white px-4 py-2 rounded-xl rounded-bl-sm shadow-md flex items-center gap-2 z-10 w-fit border border-gray-100">
                <div class="flex items-center gap-1">
                    <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                    <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></span>
                    <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
                </div>
                <span id="ai-timer-text" class="text-xs text-gray-500 ml-2 font-medium">Esperando (20s)</span>
                <div class="flex items-center gap-1 ml-2">
                    <button id="ai-skip-btn" onclick="skipAiWait()" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded transition-colors" title="Responder ahora">
                        <i class="fas fa-forward"></i>
                    </button>
                    <button id="ai-cancel-btn" onclick="cancelAiResponse()" class="hidden text-xs bg-red-100 hover:bg-red-200 text-red-600 px-2 py-0.5 rounded transition-colors" title="Cancelar respuesta">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
             </div>
           </div>`;

    const notesBadge = state.notes.length > 0 ? `<span class="note-count-badge">${state.notes.length}</span>` : '';
    const replyContextBarHTML = state.replyingToMessage ? `<div id="reply-context-bar">${ReplyContextBarTemplate(state.replyingToMessage)}</div>` : '';
    const scheduleBarHTML = scheduleActive
        ? `<div id="schedule-context-bar" class="schedule-context-bar">
                <i class="fas fa-clock"></i>
                <span class="schedule-context-text">Los mensajes se enviarán <strong>${formatScheduleLabel(scheduleInfo.scheduledAt)}</strong></span>
                <button type="button" onclick="openScheduleModal()" class="schedule-context-action" title="Cambiar hora">Cambiar</button>
                <button type="button" onclick="cancelScheduleMode()" class="schedule-context-action schedule-context-cancel" title="Desactivar programación">Cancelar</button>
           </div>`
        : '';

    const isBotActiveForContact = contact.botActive === true;
    const isPostVentaContact = contact.aiStage === 'postventa';
    // En etapa 2 (post-venta) el robot se muestra ámbar para distinguirlo de la venta (verde).
    const botColorClass = isBotActiveForContact ? (isPostVentaContact ? 'text-amber-500' : 'text-green-500') : 'text-gray-400';
    const botTitle = isBotActiveForContact
        ? (isPostVentaContact ? 'IA en post-venta (etapa 2) — clic para desactivar' : 'Desactivar IA para este chat')
        : 'Activar IA para este chat';
    const botToggleHTML = `
        <button
            onclick="handleBotToggle('${contact.id}', ${!isBotActiveForContact})"
            class="p-2 rounded-full hover:bg-gray-200 transition-colors ${botColorClass}"
            title="${botTitle}">
            <i class="fas fa-robot text-xl"></i>
        </button>
    `;
    // Badge de etapa 2 junto al nombre (solo si el bot sigue activo en post-venta).
    // Clic = regresar el chat a la etapa de venta (cuando el cliente quiere un nuevo pedido).
    const postVentaBadge = (isBotActiveForContact && isPostVentaContact)
        ? `<button type="button" onclick="handleStageReset('${contact.id}')" class="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap cursor-pointer hover:brightness-95" style="background:#fff7ed;color:#b45309;border:1px solid #fed7aa;" title="IA en post-venta — clic para regresar a venta (nuevo pedido)"><i class="fas fa-box"></i>Post-venta<i class="fas fa-rotate-left opacity-60 ml-0.5"></i></button>`
        : '';

    // Botón para activar la POST-VENTA a mano (sin mandarle /final al cliente). Pasa el chat
    // a etapa 2 y enciende la IA. Solo se muestra cuando el contacto NO está ya en post-venta.
    const activatePostventaHTML = !isPostVentaContact
        ? `<button onclick="handleActivatePostventa('${contact.id}')" class="p-2 rounded-full hover:bg-amber-50 transition-colors text-gray-400 hover:text-amber-500 ml-2" title="Activar post-venta (cobro/validación) y encender la IA — NO le envía ningún mensaje al cliente"><i class="fas fa-box text-xl"></i></button>`
        : '';

    // --- Botón de Revisión de Diseño ---
    const isInDesign = contact.inDesignReview === true;
    const designToggleHTML = `
        <button onclick="handleDesignToggle('${contact.id}', ${!isInDesign})"
            class="p-2 rounded-full hover:bg-gray-200 transition-colors ${isInDesign ? 'text-purple-500' : 'text-gray-400'} ml-2"
            title="${isInDesign ? 'Regresar de diseño' : 'Enviar a diseño'}">
            <i class="fas fa-paint-brush text-xl"></i>
        </button>
    `;

    // --- NUEVO: Botón de Transferencia de Chat ---
    const transferButtonHTML = `
        <button onclick="openTransferModal('${contact.id}')" class="p-2 rounded-full hover:bg-gray-200 transition-colors text-gray-500 ml-2" title="Transferir Chat">
            <i class="fas fa-exchange-alt"></i>
        </button>
    `;

    const clearHistoryButtonHTML = `
        <button onclick="handleClearChatHistory('${contact.id}')" class="p-2 rounded-full hover:bg-red-50 transition-colors text-red-500 ml-2" title="Borrar Historial de Chat">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;

    // --- Botón: programar recordatorio a fecha futura (plantilla + IA) ---
    const reminderButtonHTML = `
        <button onclick="openReminderModal('${contact.id}')" class="p-2 rounded-full hover:bg-indigo-50 transition-colors text-gray-400 hover:text-indigo-500 ml-2" title="Programar recordatorio a fecha futura (se manda con plantilla; la IA redacta el texto)">
            <i class="fas fa-calendar-plus text-xl"></i>
        </button>
    `;

    return `
        <div id="drag-drop-overlay-chat" class="drag-overlay hidden">
            <div class="drag-overlay-content">
                <i class="fas fa-file-import text-5xl mb-4"></i>
                <p>Suelta para adjuntar el archivo</p>
            </div>
        </div>
        <header class="chat-header chat-header-slim flex items-center space-x-2" ${headerStyle}>
            <button id="chat-back-btn" onclick="closeChatOnMobile()" class="md:hidden chat-back-btn-mobile" aria-label="Volver a la lista de chats"><i class="fas fa-arrow-left"></i></button>
            <div class="flex-shrink-0 chat-header-avatar">${UserIcon(contact)}</div>
            <div class="flex-grow flex items-center min-w-0" style="gap: 6px;">
                <h2 class="text-base font-semibold cursor-pointer truncate" style="color: var(--color-text);" onclick="openContactDetails()">${contact.name}</h2>
                ${HeaderTagControlTemplate(contact)}
                ${postVentaBadge}
                <span id="order-pending-host" class="flex-shrink-0">${OrderPendingBadge(contact)}</span>
                <span id="reminder-host" class="flex-shrink-0">${ReminderBadge(contact)}</span>
            </div>
            <div class="flex items-center pr-2 chat-header-actions">
                ${designToggleHTML}
                ${botToggleHTML}
                ${activatePostventaHTML}
                ${reminderButtonHTML}
                ${transferButtonHTML}
                ${clearHistoryButtonHTML}
            </div>
        </header>

        ${mainContent}
        <div id="file-preview-container"></div>
        <footer class="chat-footer relative">
            <div id="drag-drop-overlay-footer" class="drag-overlay-footer hidden">
                <div class="drag-overlay-content">
                    <i class="fas fa-file-import text-3xl mb-2"></i>
                    <p>Suelta aquí para adjuntar</p>
                </div>
            </div>
            ${sessionExpiredNotification}
            ${replyContextBarHTML}
            ${scheduleBarHTML}
            <div id="quick-reply-picker" class="picker-container hidden"></div>
            <div id="template-picker" class="picker-container hidden"></div>
            <div id="upload-progress" class="text-center text-sm text-yellow-600 mb-2 hidden"></div>
            ${footerContent}
            <div id="emoji-picker" class="hidden"></div>
        </footer>`;
};

const ContactDetailsSidebarTemplate = (contact) => {
    if (!contact) return '';

    // Chip de campaña/departamento (punto + texto) bajo el teléfono
    const deptColor = (state._deptColorMap && state._deptColorMap.get(contact.assignedDepartmentId)) || null;
    const deptName = (deptColor && state.departments) ? (state.departments.find(d => d.id === contact.assignedDepartmentId)?.name || 'Campaña') : '';
    const deptChip = deptColor ? `<p class="text-xs text-gray-500 mt-2 flex items-center justify-center"><span class="dept-dot" style="background:${deptColor}"></span>${deptName.replace(/[<>]/g,'')}</p>` : '';

    const activeTab = state.contactPanelTab || 'perfil';
    const notesCount = (state.notes && state.notes.length) ? state.notes.length : 0;
    const notesBadge = notesCount > 0 ? `<span class="cdetails-tab-badge" id="notes-tab-badge">${notesCount}</span>` : `<span class="cdetails-tab-badge hidden" id="notes-tab-badge"></span>`;

    return `
        <div class="h-full flex flex-col">
            <header class="p-4 flex items-center justify-between border-b border-gray-200">
                <h3 class="font-semibold text-lg">Detalles del contacto</h3>
                <button onclick="closeContactDetails()" class="text-gray-500 hover:text-gray-800"><i class="fas fa-times"></i></button>
            </header>

            <!-- Menú de pestañas con iconos -->
            <nav class="cdetails-tabs">
                <button class="cdetails-tab ${activeTab === 'perfil' ? 'active' : ''}" data-tab="perfil" onclick="switchContactPanelTab('perfil')" title="Perfil">
                    <i class="fas fa-user"></i><span>Perfil</span>
                </button>
                <button class="cdetails-tab ${activeTab === 'pedidos' ? 'active' : ''}" data-tab="pedidos" onclick="switchContactPanelTab('pedidos')" title="Pedidos">
                    <i class="fas fa-box"></i><span>Pedidos</span>
                </button>
                <button class="cdetails-tab ${activeTab === 'notas' ? 'active' : ''}" data-tab="notas" onclick="switchContactPanelTab('notas')" title="Notas">
                    <i class="fas fa-sticky-note"></i><span>Notas</span>${notesBadge}
                </button>
            </nav>

            <div class="flex-1 overflow-y-auto">
                <!-- PESTAÑA: PERFIL -->
                <div class="cdetails-pane ${activeTab === 'perfil' ? 'active' : ''}" data-pane="perfil">
                    <div class="p-6">
                        <div class="text-center mb-6">
                            ${UserIcon(contact, 'h-24 w-24 mx-auto')}
                            <h2 class="text-2xl font-bold mt-4">${contact.name || 'Desconocido'}</h2>
                            <p class="text-gray-500">${ContactHandleTemplate(contact)}</p>
                            ${deptChip}
                            <p class="text-sm text-gray-500 mt-1">${contact.email || ''}</p>
                            <p class="text-sm text-gray-500 mt-1"><em>${contact.nickname || ''}</em></p>
                        </div>

                        ${PendingAiToggleTemplate(contact)}
                        ${AdReferralBannerTemplate(contact)}
                    </div>
                </div>

                <!-- PESTAÑA: PEDIDOS -->
                <div class="cdetails-pane ${activeTab === 'pedidos' ? 'active' : ''}" data-pane="pedidos">
                    <div class="p-6">
                        <div id="order-history-container">
                            <h4 class="cdetails-section-title">Historial de Pedidos</h4>
                            <div id="contact-orders-list" class="space-y-2">
                                <!-- El contenido se cargará dinámicamente -->
                            </div>
                        </div>

                        <div class="mt-6 border-t pt-6 space-y-2">
                           <!-- Acción primaria (única, naranja) -->
                           <button onclick="abrirModalPedido()" class="btn btn-primary w-full btn-sm"><i class="fas fa-plus-circle mr-2"></i>Registrar Nuevo Pedido</button>

                           <!-- Secundarias (borde) -->
                           <button onclick="handleMarkAsPurchase()" class="btn btn-outline w-full btn-sm"><i class="fas fa-shopping-cart mr-2"></i>Registrar Compra (Meta)</button>
                           <button onclick="handleSendViewContent()" class="btn btn-outline w-full btn-sm"><i class="fas fa-eye mr-2"></i>Enviar 'Contenido Visto' (Meta)</button>

                           <!-- Grupo: Solicitar envío -->
                           <p class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pt-3 pb-1">Solicitar envío</p>
                           <button onclick="handleEnviarFormularioEnvio()" class="btn btn-outline w-full btn-sm"><i class="fas fa-truck-fast mr-2"></i>Formulario de envío (Nacional)</button>
                           <button onclick="handlePedirDatosMty()" class="btn btn-outline w-full btn-sm"><i class="fas fa-map-marker-alt mr-2"></i>MTY</button>
                           <button onclick="handlePedirDatosDgo()" class="btn btn-outline w-full btn-sm"><i class="fas fa-motorcycle mr-2"></i>DGO</button>

                           <!-- Pago (neutro, no destructivo) -->
                           <button onclick="handleGenerarOxxo()" class="btn btn-outline w-full btn-sm"><i class="fas fa-store mr-2"></i>Generar Pago OXXO</button>
                        </div>
                    </div>
                </div>

                <!-- PESTAÑA: NOTAS -->
                <div class="cdetails-pane ${activeTab === 'notas' ? 'active' : ''}" data-pane="notas">
                    <div class="p-6">
                        <div id="sidebar-notes-container">
                            <div class="flex justify-between items-center mb-3">
                                <h4 class="cdetails-section-title !mb-0">Notas Internas</h4>
                                <button onclick="toggleSidebarNoteInput()" class="text-primary hover:opacity-80 p-1" title="Agregar nota" style="color: var(--color-primary);">
                                    <i class="fas fa-plus"></i>
                                </button>
                            </div>
                            <div id="sidebar-note-input-container" class="hidden mb-3 bg-gray-50 p-2 rounded border border-gray-100">
                                <textarea id="sidebar-note-input" class="w-full p-2 text-xs border rounded mb-2 focus:ring-1 focus:ring-blue-400 outline-none" rows="2" placeholder="Escribe una nota interna..."></textarea>
                                <div class="flex justify-end gap-2">
                                    <button onclick="toggleSidebarNoteInput()" class="text-[10px] text-gray-400 hover:text-gray-600">Cancelar</button>
                                    <button onclick="handleSaveSidebarNote()" class="btn btn-primary !py-1 !px-2 !text-[10px] rounded">Guardar</button>
                                </div>
                            </div>
                            <div id="sidebar-notes-list" class="min-h-[40px] transition-all duration-300">
                                <!-- Las notas se cargarán aquí -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const DateSeparatorTemplate = (dateString) => {
    return `<div class="date-separator date-separator-anchor">${dateString}</div>`;
};

// --- Productos configurables ---
// La lista de productos de los selects de pedidos se gestiona en la colección
// Firestore `crm_products` (ver listenForProducts en api-service.js) y se edita
// desde el modal "Editar productos". Esta constante es solo el fallback inicial
// que se usa mientras aún no se cargan productos desde Firestore.
const DEFAULT_PRODUCTS = ['Spiderman', 'Rex', 'Guerreras', 'Muerto', 'Corazón', 'Mario', 'Sonic', 'Especial'];

// Devuelve los nombres de producto actuales (desde el estado global, con fallback).
function getProductNames() {
    const fromState = (typeof state !== 'undefined' && Array.isArray(state.products))
        ? state.products.map(p => p && p.name).filter(Boolean)
        : [];
    return fromState.length ? fromState : DEFAULT_PRODUCTS.slice();
}

// Construye el HTML de <option> para un select de producto, preservando el valor
// seleccionado aunque ya no exista en la lista (p. ej. pedidos antiguos).
function buildProductOptionsHTML(selectedValue) {
    const names = getProductNames();
    if (selectedValue && !names.includes(selectedValue)) names.unshift(selectedValue);
    return names.map(n =>
        `<option value="${escapeHtml(n)}"${n === selectedValue ? ' selected' : ''}>${escapeHtml(n)}</option>`
    ).join('');
}

// Clave normalizada de un producto (sin acentos, minúsculas) para comparar y
// deduplicar por nombre. Reutiliza normalizeForSearch (ui-manager) si ya cargó.
function normalizeProductKey(name) {
    if (typeof normalizeForSearch === 'function') return normalizeForSearch(name).trim();
    return String(name == null ? '' : name).trim().toLowerCase();
}

// Convierte un lastUsedAt (Timestamp de Firestore, {seconds}, o ISO) a milisegundos.
function productLastUsedMillis(p) {
    const t = p && p.lastUsedAt;
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();   // Firestore Timestamp
    if (typeof t.seconds === 'number') return t.seconds * 1000;  // Timestamp plano
    const ms = Date.parse(t);                                    // string/ISO
    return isNaN(ms) ? 0 : ms;
}

// Devuelve los productos ordenados por USO MÁS RECIENTE primero y deduplicados
// por nombre. Criterio: lastUsedAt desc (los recién usados suben a la cima),
// y como desempate 'order' desc (los recién agregados). Así, si acabas de usar un
// producto que estaba abajo, la próxima vez aparece hasta arriba.
function getProductsSorted() {
    const products = (typeof state !== 'undefined' && Array.isArray(state.products))
        ? state.products.slice()
        : [];
    products.sort((a, b) => {
        const byUsed = productLastUsedMillis(b) - productLastUsedMillis(a);
        if (byUsed) return byUsed;
        return (Number(b.order) || 0) - (Number(a.order) || 0);
    });
    const seen = new Set();
    const unique = [];
    for (const p of products) {
        const key = normalizeProductKey(p && p.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
    }
    return unique;
}

// Devuelve los nombres de producto ordenados por uso más reciente (ver arriba).
// Si aún no hay productos en el estado, cae al fallback DEFAULT_PRODUCTS.
function getProductNamesRecent() {
    const sorted = getProductsSorted();
    if (sorted.length) return sorted.map(p => p.name).filter(Boolean);
    return getProductNames().slice().reverse();
}

// Devuelve el precio configurado de un producto por nombre, o null si no tiene.
function getProductPrice(name) {
    const key = normalizeProductKey(name);
    if (!key) return null;
    const products = (typeof state !== 'undefined' && Array.isArray(state.products)) ? state.products : [];
    const match = products.find(p => normalizeProductKey(p && p.name) === key && p.price != null && p.price !== '');
    return match ? Number(match.price) : null;
}

// Combobox de producto con buscador y "ver más" (reemplaza el <select> nativo).
// Mantiene un <input type="hidden"> con la clase legacy (order-item-product /
// edit-order-item-product) para que la lógica de guardado siga leyendo .value.
function ProductPickerTemplate(selectedValue, inputClass) {
    const value = selectedValue || '';
    const labelText = value || 'Selecciona un producto';
    return `
    <div class="product-picker" data-expanded="0">
        <input type="hidden" class="product-picker-input ${inputClass}" value="${escapeHtml(value)}">
        <button type="button" class="product-picker-trigger${value ? '' : ' is-placeholder'}">
            <span class="product-picker-value">${escapeHtml(labelText)}</span>
            <i class="fas fa-chevron-down product-picker-caret"></i>
        </button>
        <div class="product-picker-panel" hidden>
            <div class="product-picker-search">
                <i class="fas fa-search"></i>
                <input type="text" class="product-picker-search-input" placeholder="Buscar producto..." autocomplete="off">
            </div>
            <ul class="product-picker-list" role="listbox"></ul>
            <button type="button" class="product-picker-more" hidden></button>
        </div>
    </div>`;
}

// Fila editable de un producto dentro del gestor de productos.
const ProductManagerRowTemplate = (product) => {
    const priceVal = (product.price != null && product.price !== '') ? escapeHtml(String(product.price)) : '';
    return `
    <div class="product-manager-row" data-product-id="${escapeHtml(product.id)}">
        <input type="text" class="product-name-edit" value="${escapeHtml(product.name || '')}"
               data-original="${escapeHtml(product.name || '')}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
               onblur="saveProductName('${escapeHtml(product.id)}', this)">
        <div class="product-price-wrap" title="Precio del producto">
            <span class="product-price-currency">$</span>
            <input type="number" class="product-price-edit" placeholder="Precio" step="0.01" min="0"
                   value="${priceVal}" data-original-price="${priceVal}"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
                   onblur="saveProductPrice('${escapeHtml(product.id)}', this)">
        </div>
        <button type="button" class="product-delete-btn" title="Eliminar producto"
                onclick="deleteProductEntry('${escapeHtml(product.id)}', this)">
            <i class="fas fa-trash-alt"></i>
        </button>
    </div>
`;
};

// Modal para gestionar (agregar / renombrar / eliminar) la lista de productos.
const ProductsManagerModalTemplate = () => `
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width:480px;">
        <button onclick="closeProductsManager()" class="modal-close-btn" title="Cerrar">&times;</button>
        <h2><i class="fas fa-box-open"></i> Editar productos</h2>
        <p style="margin-top:-10px;margin-bottom:18px;font-size:0.85rem;color:#6b7280;">
            Agrega nuevos productos (con precio), renombra o edita el precio (clic en el campo) o elimina. Los cambios se aplican en todos los dispositivos.
        </p>
        <div class="products-manager-add">
            <input type="text" id="new-product-name-input" placeholder="Nombre del nuevo producto..."
                   autocomplete="off"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('new-product-price-input').focus();}">
            <div class="product-price-wrap" title="Precio del nuevo producto">
                <span class="product-price-currency">$</span>
                <input type="number" id="new-product-price-input" class="product-price-edit" placeholder="Precio"
                       value="750" step="0.01" min="0" autocomplete="off"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();submitNewProduct();}">
            </div>
            <button type="button" class="btn btn-primary" onclick="submitNewProduct()" style="white-space:nowrap;">
                <i class="fas fa-plus"></i> Agregar
            </button>
        </div>
        <div id="products-manager-tools"></div>
        <div id="products-manager-list" class="products-manager-list"></div>
    </div>
`;

const NewOrderItemRowTemplate = (index, isFirst = false) => {
    const defaultProduct = getProductNamesRecent()[0] || '';
    const defaultPrice = getProductPrice(defaultProduct);
    const priceValue = defaultPrice != null ? defaultPrice : '';
    return `
    <div class="order-item-row" data-item-index="${index}">
        <div class="order-item-header">
            <span class="order-item-number">Producto ${index + 1}</span>
            <button type="button" class="order-item-remove-btn" onclick="removeOrderItem(${index})" style="${isFirst ? 'display:none;' : ''}">
                <i class="fas fa-times"></i> Quitar
            </button>
        </div>
        <div class="order-item-fields">
            <div class="form-item">
                <label>Producto (*):</label>
                ${ProductPickerTemplate(defaultProduct, 'order-item-product')}
            </div>
            <div class="form-item">
                <label>Cantidad (*):</label>
                <input type="number" class="order-item-quantity" min="1" step="1" value="1" required>
            </div>
            <div class="form-item">
                <label>Precio unitario (MXN):</label>
                <input type="number" class="order-item-price" step="0.01" placeholder="Ej: 750.00" value="${priceValue}">
            </div>
            <div class="form-item form-item-full">
                <label>Detalles del Producto:</label>
                <textarea class="order-item-details" placeholder="Describe los detalles específicos (nombre, color, etc.)..."></textarea>
            </div>
        </div>
    </div>
`;
};

const NewOrderModalTemplate = () => `
    <div id="new-order-modal" class="modal-overlay">
        <div class="modal-content" id="modalContentNuevoPedido">
            <div id="nuevoPedidoContainer">
                 <h2 id="modalTitle"><i class="fas fa-pencil-alt"></i> Registrar Nuevo Pedido</h2>
                 <form id="formularioNuevoPedido">
                     <div class="form-actions-top">
                          <div id="mensajeErrorPedido"></div>
                          <button type="submit" id="btnGuardarPedido" class="icon-action-btn icon-action-btn-primary" title="Guardar pedido"><i class="fas fa-save"></i></button>
                          <button type="button" onclick="closeNewOrderModal()" class="icon-action-btn" title="Cancelar"><i class="fas fa-times"></i></button>
                     </div>
                     <div class="form-grid">
                         <div class="form-item">
                             <label for="pedidoTelefono">Teléfono (*):</label>
                             <input type="tel" id="pedidoTelefono" placeholder="Ej: 521..." required>
                         </div>

                         <div class="form-item form-item-full">
                             <div id="order-items-container">
                                ${NewOrderItemRowTemplate(0, true)}
                             </div>
                             <button type="button" id="add-order-item-btn" class="add-order-item-btn" onclick="addOrderItem()">
                                <i class="fas fa-plus"></i> Agregar otro producto
                             </button>
                             <button type="button" class="edit-products-btn" onclick="openProductsManager()" title="Agregar, renombrar o eliminar productos de la lista">
                                <i class="fas fa-cog"></i> Editar productos
                             </button>
                         </div>

                        <div class="form-item form-item-full">
                               <label for="pedidoComentarios">Comentarios Adicionales:</label>
                               <textarea id="pedidoComentarios" placeholder="Añade cualquier otra nota relevante sobre el pedido..."></textarea>
                        </div>

                          <div class="form-item form-item-full">
                               <label for="pedidoFotoFile">Fotos del Pedido (Clic derecho o Ctrl+C para copiar):</label>
                               <div class="file-input-container" id="fileInputContainerProducto" tabindex="0">
                                   <input type="file" id="pedidoFotoFile" accept="image/*" multiple>
                                   <div class="file-input-header">
                                       <label for="pedidoFotoFile" class="custom-file-upload">
                                           <i class="fas fa-upload"></i> Seleccionar
                                       </label>
                                       <span>O arrastra y suelta imágenes aquí</span>
                                   </div>
                                   <div class="previews-container" id="fotosPreviewContainer">
                                       </div>
                               </div>
                          </div>

                         <div class="form-item form-item-full">
                            <label for="pedidoFotoPromocionFile">Fotos de la Promoción (Clic derecho o Ctrl+C para copiar):</label>
                            
                            <!-- NEW CHECKBOX CONTAINER -->
                            <div class="checkbox-container" id="mismaFotoContainer" style="display: none;">
                                <input type="checkbox" id="mismaFotoCheckbox">
                                <label for="mismaFotoCheckbox">Usar la(s) misma(s) foto(s) del pedido</label>
                            </div>
                            
                            <div class="file-input-container" id="fileInputContainerPromocion" tabindex="0">
                                <input type="file" id="pedidoFotoPromocionFile" accept="image/*" multiple>
                                <div class="file-input-header">
                                    <label for="pedidoFotoPromocionFile" class="custom-file-upload">
                                        <i class="fas fa-upload"></i> Seleccionar
                                    </label>
                                    <span>O arrastra y suelta imágenes aquí</span>
                                </div>
                                <div class="previews-container" id="promoFotosPreviewContainer">
                                    </div>
                            </div>
                        </div>
                        <div class="form-item form-item-full">
                            <label for="pedidoDatosPromocion">Detalles de la Promoción:</label>
                            <textarea id="pedidoDatosPromocion" placeholder="Describe la promoción aplicada, si existe..."></textarea>
                        </div>

                        <!-- Tracking de campaña (opcional) -->
                        <div class="form-item form-item-full" style="background:#f8f9fa;padding:14px;border-radius:10px;border:1px solid #e2e8f0;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <input type="checkbox" id="pedidoVieneDeCampana" style="width:16px;height:16px;cursor:pointer;" onchange="togglePedidoCampanaSection(false)">
                                <i class="fas fa-bullhorn" style="color:var(--color-primary);"></i>
                                <label for="pedidoVieneDeCampana" style="font-weight:600;cursor:pointer;margin:0;">¿Viene de una campaña?</label>
                            </div>
                            <div id="pedidoCampanaSelectors" style="margin-top:12px;grid-template-columns:1fr 1fr;gap:10px;display:none;">
                                <div>
                                    <label for="pedidoCampanaId" style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Campaña *</label>
                                    <select id="pedidoCampanaId" onchange="onPedidoCampanaChange(false)" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:white;margin-top:4px;">
                                        <option value="">Sin campañas activas</option>
                                    </select>
                                </div>
                                <div>
                                    <label for="pedidoPlantillaOrigen" style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Plantilla origen *</label>
                                    <select id="pedidoPlantillaOrigen" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:white;margin-top:4px;">
                                        <option value="">Elige campaña primero</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                     </div>
                 </form>
            </div>
        </div>
    </div>
`;

const OrderConfirmationModalTemplate = (orderNumber) => {
    // Normalizar: acepta 'DH1234' o '1234'
    const raw = String(orderNumber || '');
    const label = raw.startsWith('DH') ? raw : `DH${raw}`;
    return `
    <div id="order-confirmation-modal" class="modal-backdrop">
        <div class="modal-content !max-w-md !p-8 text-center">
            <div class="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2 class="text-2xl font-bold text-gray-800 mb-4">¡Pedido Registrado!</h2>
            <p class="text-gray-600 mb-8">El pedido ha sido guardado exitosamente con el número:</p>

            <div class="flex items-center justify-center gap-3 bg-slate-100 p-4 rounded-2xl mb-8 group cursor-pointer hover:bg-slate-200 transition-colors" onclick="copyOrderNumber('${label}', this)">
                <span id="numeroPedidoConfirmacion" class="text-3xl font-black text-primary tracking-wider">${label}</span>
                <div class="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-400 group-hover:text-primary transition-colors">
                    <i class="fas fa-copy"></i>
                </div>
            </div>

            <button onclick="closeOrderConfirmationModal()" class="w-full py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 transition-all active:scale-95 shadow-lg">
                Cerrar
            </button>
        </div>
    </div>
    `;
};

const ConversationPreviewModalTemplate = (contact) => `
    <div id="conversation-preview-modal" class="modal-backdrop" onclick="closeConversationPreviewModal()">
        <div class="modal-content !p-0 !max-w-3xl !w-full" onclick="event.stopPropagation()">
            <div id="preview-chat-panel" class="h-full flex flex-col relative">
                <header class="chat-header p-2 shadow-sm flex items-center justify-between space-x-2">
                    <div class="flex items-center space-x-2">
                        <div class="flex-shrink-0 pt-0.5">${UserIcon(contact)}</div>
                        <div class="flex-grow">
                            <h2 class="text-base font-semibold" style="color: var(--color-text);">${contact.name}</h2>
                            <p class="text-xs text-gray-500">${ContactHandleTemplate(contact)}</p>
                        </div>
                    </div>
                    <button class="image-modal-close !relative !top-0 !right-0" onclick="closeConversationPreviewModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </header>
                <main id="preview-messages-container" class="relative flex-1 p-4 overflow-y-auto">
                     <div id="preview-loading-spinner" class="h-16 flex items-center justify-center">
                        <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
                     </div>
                    <div id="preview-messages-content"></div>
                </main>
            </div>
        </div>
    </div>
`;

const OrderHistoryItemTemplate = (order) => {
    const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
    const estatus = order.estatus || 'Sin estatus';

    const statusOptionsHTML = state.orderStatuses
        .map(status => `<option value="${status.key}" ${estatus === status.key ? 'selected' : ''} style="color: ${status.color}; font-weight: 600;">${status.label}</option>`)
        .join('');

    const currentStatusStyle = state.orderStatuses.find(s => s.key === estatus) || { color: '#e9ecef' };

    // Soportar pedidos con múltiples productos (items embebidos)
    const formatItemDisplay = (it) => {
        const qty = Number(it.cantidad) || 1;
        return qty > 1 ? `${it.producto} ×${qty}` : it.producto;
    };
    const formatItemTitle = (it) => {
        const qty = Number(it.cantidad) || 1;
        const qtyTxt = qty > 1 ? ` ×${qty}` : '';
        return `${it.producto}${qtyTxt}${it.precio ? ` ($${it.precio})` : ''}`;
    };
    let productoDisplay;
    let productoTitle;
    let totalPrecio = 0;
    if (Array.isArray(order.items) && order.items.length > 0) {
        totalPrecio = order.items.reduce((sum, it) => {
            const qty = Math.max(1, Number(it.cantidad) || 1);
            return sum + (Number(it.precio) || 0) * qty;
        }, 0);
        if (order.items.length === 1) {
            productoDisplay = formatItemDisplay(order.items[0]);
            productoTitle = formatItemTitle(order.items[0]);
        } else if (order.items.length <= 3) {
            productoDisplay = order.items.map(formatItemDisplay).join(' + ');
            productoTitle = order.items.map(formatItemTitle).join(', ');
        } else {
            productoDisplay = `${order.items.length} productos`;
            productoTitle = order.items.map(formatItemTitle).join(', ');
        }
    } else {
        totalPrecio = Number(order.precio) || 0;
        productoDisplay = order.producto || '';
        productoTitle = order.producto || '';
    }
    const precioDisplay = totalPrecio > 0 ? `$${totalPrecio.toLocaleString('es-MX')}` : '';

    return `
        <div class="order-history-item">
            <div class="order-history-row">
                <button class="order-number" onclick="openOrderEditModal('${order.id}')">
                    DH${order.consecutiveOrderNumber}
                </button>
                <span class="order-date">${orderDate}${precioDisplay ? ` · <strong>${precioDisplay}</strong>` : ''}</span>
            </div>
            <div class="order-history-row">
                <span class="order-product" title="${escapeHtml(productoTitle)}">${escapeHtml(productoDisplay)}</span>
            </div>
            <div class="order-history-row">
                <select
                    class="order-history-status-select"
                    data-order-id="${order.id}"
                    onchange="handleOrderStatusChange('${order.id}', this.value, this)"
                    style="background-color: ${currentStatusStyle.color}20; color: ${currentStatusStyle.color}; border-color: ${currentStatusStyle.color}50;"
                >
                    ${statusOptionsHTML}
                </select>
            </div>
            <div class="order-history-row">
                <button class="order-edit-btn" onclick="openOrderEditModal('${order.id}')">
                    <i class="fas fa-pen"></i> Editar pedido
                </button>
            </div>
        </div>
    `;
};

const EditOrderItemRowTemplate = (index, item, isFirst = false) => {
    return `
    <div class="order-item-row" data-item-index="${index}">
        <div class="order-item-header">
            <span class="order-item-number">Producto ${index + 1}</span>
            <button type="button" class="order-item-remove-btn" onclick="removeEditOrderItem(${index})" style="${isFirst ? 'display:none;' : ''}">
                <i class="fas fa-times"></i> Quitar
            </button>
        </div>
        <div class="order-item-fields">
            <div class="form-item">
                <label>Producto (*):</label>
                ${ProductPickerTemplate(item.producto, 'edit-order-item-product')}
            </div>
            <div class="form-item">
                <label>Cantidad (*):</label>
                <input type="number" class="edit-order-item-quantity" min="1" step="1" value="${Math.max(1, Number(item.cantidad) || 1)}" required>
            </div>
            <div class="form-item">
                <label>Precio unitario (MXN):</label>
                <input type="number" class="edit-order-item-price" step="0.01" placeholder="Ej: 275.00" value="${item.precio ?? ''}">
            </div>
            <div class="form-item form-item-full">
                <label>Detalles del Producto:</label>
                <textarea class="edit-order-item-details" placeholder="Describe los detalles específicos...">${(item.datosProducto || '').replace(/</g, '&lt;')}</textarea>
            </div>
        </div>
    </div>
    `;
};

const OrderEditModalTemplate = (order) => `
    <div id="order-edit-modal" class="modal-overlay">
        <div class="modal-content">
            <button onclick="closeOrderEditModal()" class="modal-close-btn" title="Cerrar">&times;</button>
            <div id="editPedidoContainer">
                 <h2 id="editModalTitle"><i class="fas fa-edit"></i> Editar Pedido DH${order.consecutiveOrderNumber}</h2>
                 <form id="edit-order-form">
                     <div class="form-grid">
                         <div class="form-item">
                             <label for="edit-order-phone">Teléfono (*):</label>
                             <input type="tel" id="edit-order-phone" placeholder="Ej: 521..." required>
                         </div>

                         <div class="form-item form-item-full">
                             <div id="edit-order-items-container"></div>
                             <button type="button" id="add-edit-order-item-btn" class="add-order-item-btn" onclick="addEditOrderItem()">
                                <i class="fas fa-plus"></i> Agregar otro producto
                             </button>
                             <button type="button" class="edit-products-btn" onclick="openProductsManager()" title="Agregar, renombrar o eliminar productos de la lista">
                                <i class="fas fa-cog"></i> Editar productos
                             </button>
                         </div>

                          <div class="form-item form-item-full">
                               <label for="edit-order-photo-file">Fotos del Pedido (Arrastra o pega imágenes):</label>
                               <div class="file-input-container" id="edit-order-file-input-container-product" tabindex="0">
                                   <input type="file" id="edit-order-photo-file" accept="image/*" multiple>
                                   <div class="file-input-header">
                                       <label for="edit-order-photo-file" class="custom-file-upload">
                                           <i class="fas fa-upload"></i> Seleccionar
                                       </label>
                                       <span>o arrastra y suelta aquí</span>
                                   </div>
                                   <div class="previews-container" id="edit-order-photos-preview-container"></div>
                               </div>
                          </div>

                         <div class="form-item form-item-full">
                            <label for="edit-order-promo-photo-file">Fotos de la Promoción:</label>
                            <div class="checkbox-container" id="edit-order-same-photo-container" style="display: none;">
                                <input type="checkbox" id="edit-order-same-photo-checkbox">
                                <label for="edit-order-same-photo-checkbox">Usar la(s) misma(s) foto(s) del pedido</label>
                            </div>
                            <div class="file-input-container" id="edit-order-file-input-container-promo" tabindex="0">
                                <input type="file" id="edit-order-promo-photo-file" accept="image/*" multiple>
                                <div class="file-input-header">
                                    <label for="edit-order-promo-photo-file" class="custom-file-upload">
                                        <i class="fas fa-upload"></i> Seleccionar
                                    </label>
                                    <span>o arrastra y suelta aquí</span>
                                </div>
                                <div class="previews-container" id="edit-order-promo-photos-preview-container"></div>
                            </div>
                        </div>
                        <div class="form-item form-item-full">
                            <label for="edit-order-promo-details">Detalles de la Promoción:</label>
                            <textarea id="edit-order-promo-details" placeholder="Describe la promoción aplicada, si existe..."></textarea>
                        </div>

                        <div class="form-item form-item-full">
                               <label for="edit-order-comments">Comentarios Adicionales:</label>
                               <textarea id="edit-order-comments" placeholder="Añade cualquier otra nota relevante sobre el pedido..."></textarea>
                        </div>

                        <!-- Tracking de campaña (opcional) -->
                        <div class="form-item form-item-full" style="background:#f8f9fa;padding:14px;border-radius:10px;border:1px solid #e2e8f0;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <input type="checkbox" id="editPedidoVieneDeCampana" style="width:16px;height:16px;cursor:pointer;" onchange="togglePedidoCampanaSection(true)">
                                <i class="fas fa-bullhorn" style="color:var(--color-primary);"></i>
                                <label for="editPedidoVieneDeCampana" style="font-weight:600;cursor:pointer;margin:0;">¿Viene de una campaña?</label>
                            </div>
                            <div id="editPedidoCampanaSelectors" style="margin-top:12px;grid-template-columns:1fr 1fr;gap:10px;display:none;">
                                <div>
                                    <label for="editPedidoCampanaId" style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Campaña *</label>
                                    <select id="editPedidoCampanaId" onchange="onPedidoCampanaChange(true)" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:white;margin-top:4px;">
                                        <option value="">Sin campañas activas</option>
                                    </select>
                                </div>
                                <div>
                                    <label for="editPedidoPlantillaOrigen" style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Plantilla origen *</label>
                                    <select id="editPedidoPlantillaOrigen" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:white;margin-top:4px;">
                                        <option value="">Elige campaña primero</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                     </div>
                     <div id="edit-order-error-message"></div>
                     <div class="form-actions">
                          <button type="button" onclick="closeOrderEditModal()"><i class="fas fa-times"></i> Cancelar</button>
                          <button type="submit" id="order-update-btn"><i class="fas fa-save"></i> Guardar Cambios</button>
                     </div>
                 </form>
            </div>
        </div>
    </div>
`;

// =====================================================================
// === TRACKING DE CAMPAÑAS (vista, modal de campaña, helpers)        ===
// =====================================================================

const ConversionCampanasViewTemplate = () => `
    <div class="view-container campaign-pane-content">
        <div class="campaign-pane-header">
            <div class="campaign-pane-heading">
                <h2 class="campaign-pane-title"><i class="fas fa-chart-pie"></i> Resultados de campañas</h2>
                <p class="campaign-pane-sub">Conversión automática por plantilla de WhatsApp. Las compras se atribuyen por teléfono dentro de la ventana posterior al envío — sin tagueo manual.</p>
            </div>
        </div>

        <!-- Resultados automáticos por plantilla -->
        <div class="auto-results-section">
            <div class="auto-results-toolbar">
                <label for="auto-results-from">Desde</label>
                <input type="date" id="auto-results-from">
                <label for="auto-results-to">Hasta</label>
                <input type="date" id="auto-results-to">
                <button onclick="renderAutoTemplateResults(true)" class="btn btn-subtle btn-sm"><i class="fas fa-sync-alt mr-1"></i> Actualizar</button>
                <span id="auto-results-meta" style="font-size:0.72rem;color:var(--color-text-light);"></span>
            </div>
            <div id="auto-template-results" class="auto-results-table-wrap">
                <div class="auto-results-empty"><i class="fas fa-spinner fa-spin"></i> Cargando resultados…</div>
            </div>
        </div>

        <!-- Campañas manuales (avanzado, colapsable) -->
        <div style="margin-top:8px;">
            <button class="manual-campaigns-toggle" onclick="toggleManualCampaigns()">
                <i class="fas fa-chevron-right chev" id="manual-campaigns-chev"></i>
                Campañas manuales
                <span style="font-weight:400;font-size:0.78rem;color:var(--color-text-light);">— rangos y plantillas definidas a mano, con tagueo desde "Registrar Pedido"</span>
            </button>
            <div id="manual-campaigns-body" class="hidden" style="margin-top:12px;">
                <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
                    <button onclick="openCampanaFormModal(null)" class="btn btn-primary btn-sm"><i class="fas fa-plus mr-1"></i> Nueva campaña</button>
                </div>
                <div id="conversion-campanas-list"></div>
            </div>
        </div>
    </div>
`;

const CampanaKPIRowTemplate = (k) => {
    const pct = k.contactados > 0 ? ((k.pagados / k.contactados) * 100).toFixed(1) + '%' : '—';
    const ticket = k.pagados > 0 ? '$' + Math.round(k.monto / k.pagados).toLocaleString('es-MX') : '—';
    const monto = '$' + Math.round(k.monto).toLocaleString('es-MX');
    return `
        <tr>
            <td style="padding:8px 10px;font-weight:500;">${escapeHtml(k.plantilla)}</td>
            <td style="padding:8px 10px;text-align:right;color:#6b7280;">${k.contactados}</td>
            <td style="padding:8px 10px;text-align:right;color:#6b7280;">${k.pedidos}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:600;">${k.pagados}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--color-primary);">${pct}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:600;">${monto}</td>
            <td style="padding:8px 10px;text-align:right;color:#6b7280;">${ticket}</td>
        </tr>
    `;
};

const CampanaCardTemplate = (c, kpis) => {
    const isOpen = !!state.campanaExpandState[c.id];
    const ini = c.fecha_inicio?.toDate ? c.fecha_inicio.toDate() : (c.fecha_inicio?._seconds ? new Date(c.fecha_inicio._seconds * 1000) : null);
    const fin = c.fecha_fin?.toDate ? c.fecha_fin.toDate() : (c.fecha_fin?._seconds ? new Date(c.fecha_fin._seconds * 1000) : null);
    const fmt = d => d ? d.toLocaleDateString('es-MX', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const rango = fin ? `${fmt(ini)} → ${fmt(fin)}` : `${fmt(ini)} → en curso`;
    const totalPct = kpis.totalContactados > 0 ? ((kpis.totalPagados / kpis.totalContactados) * 100).toFixed(1) + '%' : '—';
    const totalMonto = '$' + Math.round(kpis.totalMonto).toLocaleString('es-MX');
    const isActiva = c.estatus === 'activa';
    const estatusColor = isActiva ? 'var(--color-primary)' : '#9ca3af';
    const estatusBg = isActiva ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : '#e5e7eb';

    return `
        <div class="campana-card" style="background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;">
                <button onclick="toggleCampanaExpand('${c.id}')" style="background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;">
                    <i class="fas fa-chevron-${isOpen ? 'down' : 'right'}"></i>
                </button>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <h3 style="font-size:15px;font-weight:700;margin:0;">${escapeHtml(c.nombre || '(sin nombre)')}</h3>
                        <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;padding:2px 8px;border-radius:9999px;background:${estatusBg};color:${estatusColor};">${c.estatus || 'activa'}</span>
                    </div>
                    <p style="font-size:12px;color:#6b7280;margin:2px 0 0 0;">${rango}</p>
                </div>
                <div style="display:flex;align-items:center;gap:18px;font-size:12px;color:#6b7280;flex-wrap:wrap;">
                    <div style="text-align:right;">
                        <div style="font-weight:700;color:#111827;">${kpis.totalPagados} / ${kpis.totalContactados}</div>
                        <div style="font-size:10px;">Pagados / Contact.</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700;color:var(--color-primary);">${totalPct}</div>
                        <div style="font-size:10px;">Conversión</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700;color:#111827;">${totalMonto}</div>
                        <div style="font-size:10px;">Cobrado</div>
                    </div>
                </div>
            </div>
            ${isOpen ? `
            <div style="border-top:1px solid #f1f5f9;padding:16px 18px;background:#fafbfc;">
                ${kpis.plantillas.length === 0 ? `
                    <p style="font-size:12px;color:#9ca3af;font-style:italic;">Esta campaña no tiene plantillas configuradas todavía.</p>
                ` : `
                <div style="overflow-x:auto;">
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                    <thead>
                        <tr style="border-bottom:1px solid #e2e8f0;">
                            <th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Plantilla</th>
                            <th style="text-align:right;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Contactados</th>
                            <th style="text-align:right;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Pedidos</th>
                            <th style="text-align:right;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Pagados</th>
                            <th style="text-align:right;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Conversión</th>
                            <th style="text-align:right;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Cobrado</th>
                            <th style="text-align:right;padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Ticket prom.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${kpis.plantillas.map(CampanaKPIRowTemplate).join('')}
                        <tr style="background:#f1f5f9;font-weight:700;">
                            <td style="padding:10px;">TOTAL</td>
                            <td style="padding:10px;text-align:right;">${kpis.totalContactados}</td>
                            <td style="padding:10px;text-align:right;">${kpis.totalPedidos}</td>
                            <td style="padding:10px;text-align:right;">${kpis.totalPagados}</td>
                            <td style="padding:10px;text-align:right;color:var(--color-primary);">${totalPct}</td>
                            <td style="padding:10px;text-align:right;">${totalMonto}</td>
                            <td style="padding:10px;text-align:right;color:#6b7280;">${kpis.totalPagados > 0 ? '$' + Math.round(kpis.totalMonto / kpis.totalPagados).toLocaleString('es-MX') : '—'}</td>
                        </tr>
                    </tbody>
                </table>
                </div>
                `}
                ${c.notas ? `<p style="margin-top:12px;font-size:12px;color:#6b7280;font-style:italic;"><strong style="font-style:normal;">Notas:</strong> ${escapeHtml(c.notas)}</p>` : ''}
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">
                    <button onclick="openCampanaFormModal('${c.id}')" class="btn btn-subtle" style="font-size:12px;padding:6px 12px;"><i class="fas fa-edit"></i> Editar</button>
                    <button onclick="handleToggleCampanaEstatus('${c.id}')" class="btn btn-subtle" style="font-size:12px;padding:6px 12px;"><i class="fas fa-${isActiva ? 'lock' : 'lock-open'}"></i> ${isActiva ? 'Cerrar' : 'Reabrir'}</button>
                    <button onclick="handleExportCampanaCSV('${c.id}')" class="btn btn-subtle" style="font-size:12px;padding:6px 12px;"><i class="fas fa-download"></i> Exportar CSV</button>
                    <button onclick="handleDeleteCampana('${c.id}')" class="btn btn-subtle" style="font-size:12px;padding:6px 12px;color:#dc3545;"><i class="fas fa-trash"></i> Eliminar</button>
                </div>
            </div>
            ` : ''}
        </div>
    `;
};

const CampanaFormModalTemplate = (campana) => {
    const isEdit = !!campana;
    const nombre = campana?.nombre || '';
    const ini = campana?.fecha_inicio?.toDate ? campana.fecha_inicio.toDate() : (campana?.fecha_inicio?._seconds ? new Date(campana.fecha_inicio._seconds * 1000) : null);
    const fin = campana?.fecha_fin?.toDate ? campana.fecha_fin.toDate() : (campana?.fecha_fin?._seconds ? new Date(campana.fecha_fin._seconds * 1000) : null);
    const dateValue = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
    const estatus = campana?.estatus || 'activa';
    const notas = campana?.notas || '';
    const plantillas = campana?.plantillas || {};
    const plantillaEntries = Object.entries(plantillas);

    const rowsHtml = (plantillaEntries.length === 0 ? [['', { contactados: 0, notas: '' }]] : plantillaEntries).map(([key, val], idx) => `
        <div class="campana-plantilla-row" data-row-idx="${idx}" style="display:grid;grid-template-columns:5fr 2fr auto 4fr auto;gap:8px;align-items:center;padding:8px;background:#f8f9fa;border-radius:8px;margin-bottom:8px;">
            <input type="text" class="campana-plantilla-nombre" value="${escapeHtml(key)}" placeholder="Nombre plantilla" list="meta-templates-list" autocomplete="off" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
            <input type="number" min="0" class="campana-plantilla-contactados" value="${val.contactados || 0}" placeholder="0" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
            <button type="button" onclick="detectContactadosForRow(this)" title="Detectar automaticamente cuantos contactos recibieron esta plantilla en el rango de fechas" style="background:var(--color-primary);border:none;color:white;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px;white-space:nowrap;">
                <i class="fas fa-search"></i> Detectar
            </button>
            <input type="text" class="campana-plantilla-notas" value="${escapeHtml(val.notas || '')}" placeholder="Notas (opcional)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
            <button type="button" onclick="removeCampanaPlantillaRow(this)" style="background:none;border:none;color:#6b7280;cursor:pointer;padding:6px;" title="Quitar"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');

    // Datalist con plantillas Meta para autocompletado del input "Nombre plantilla"
    const templates = Array.isArray(state.templates) ? state.templates : [];
    const datalistHtml = `<datalist id="meta-templates-list">${
        templates.map(t => `<option value="${escapeHtml(t.name)}">${t.language ? escapeHtml(t.language) : ''}</option>`).join('')
    }</datalist>`;

    return `
        <div id="campana-form-modal" class="modal-backdrop" onclick="closeCampanaFormModal()">
            <div class="modal-content" onclick="event.stopPropagation()" style="max-width:720px;">
                ${datalistHtml}
                <h2><i class="fas fa-bullhorn" style="color:var(--color-primary);"></i> ${isEdit ? 'Editar Campaña' : 'Nueva Campaña'}</h2>
                <form id="campana-form" data-campana-id="${campana?.id || ''}">
                    <div style="margin-bottom:14px;">
                        <label for="campana-nombre">Nombre *</label>
                        <input type="text" id="campana-nombre" value="${escapeHtml(nombre)}" placeholder="Ej: Mayo 2026 - Promoción Base" required>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;">
                        <div>
                            <label for="campana-fecha-inicio">Fecha inicio *</label>
                            <input type="date" id="campana-fecha-inicio" value="${dateValue(ini)}" required>
                        </div>
                        <div>
                            <label for="campana-fecha-fin">Fecha fin <span style="font-weight:400;color:#9ca3af;font-size:11px;">(opcional)</span></label>
                            <input type="date" id="campana-fecha-fin" value="${dateValue(fin)}" title="Déjala vacía si la campaña sigue en curso sin fecha de cierre planeada">
                        </div>
                        <div>
                            <label for="campana-estatus">Estatus</label>
                            <select id="campana-estatus" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:white;">
                                <option value="activa" ${estatus === 'activa' ? 'selected' : ''}>Activa</option>
                                <option value="cerrada" ${estatus === 'cerrada' ? 'selected' : ''}>Cerrada</option>
                            </select>
                        </div>
                    </div>
                    <div style="margin-bottom:14px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <label style="margin:0;">Plantillas usadas</label>
                            <button type="button" onclick="addCampanaPlantillaRow()" style="background:none;border:none;color:var(--color-primary);font-weight:600;font-size:12px;cursor:pointer;">
                                <i class="fas fa-plus"></i> Agregar plantilla
                            </button>
                        </div>
                        <p style="font-size:11px;color:#6b7280;margin:0 0 4px 0;">
                            <i class="fas fa-info-circle"></i> Empieza a escribir y se autocompletan las plantillas aprobadas en Meta (${templates.length} disponibles).
                        </p>
                        <p style="font-size:11px;color:#6b7280;margin:0 0 8px 0;">
                            <i class="fas fa-magic" style="color:var(--color-primary);"></i> Llena el nombre y luego haz click en <strong style="color:var(--color-primary);">Detectar</strong> para contar automáticamente cuántos contactos recibieron la plantilla (necesita fecha de inicio).
                        </p>
                        <div style="display:grid;grid-template-columns:5fr 2fr auto 4fr auto;gap:8px;padding:0 8px 4px 8px;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">
                            <div>Nombre plantilla Meta</div>
                            <div style="text-align:center;" title="Cuántos teléfonos recibieron esta plantilla">Tel. enviados</div>
                            <div style="width:78px;"></div>
                            <div>Notas</div>
                            <div style="width:28px;"></div>
                        </div>
                        <div id="campana-plantillas-container">${rowsHtml}</div>
                    </div>
                    <div style="margin-bottom:14px;">
                        <label for="campana-notas">Notas</label>
                        <textarea id="campana-notas" rows="2" placeholder="Contexto adicional...">${escapeHtml(notas)}</textarea>
                    </div>
                    <div id="campana-form-error" style="color:#dc3545;font-size:13px;margin-bottom:10px;"></div>
                    <div class="flex justify-end gap-3 mt-4">
                        <button type="button" onclick="closeCampanaFormModal()" class="btn btn-subtle">Cancelar</button>
                        <button type="submit" class="btn btn-primary" id="campana-save-btn"><i class="fas fa-save mr-2"></i> ${isEdit ? 'Guardar cambios' : 'Crear campaña'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;
};

// Nota: `escapeHtml` ya está definido globalmente en ui-manager.js — los templates de arriba lo usan.
