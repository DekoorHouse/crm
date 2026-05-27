"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Order } from "@/lib/api/types";
import { PRODUCT_OPTIONS } from "@/lib/utils/productConfig";
import Select from "@/components/ui/Select";
import type { SelectOption } from "@/components/ui/Select";
import { createOrder, updateOrder } from "@/lib/firebase/firestore";
import { processPhotos } from "@/lib/firebase/storage";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { mapCampanaDoc, type Campana } from "@/lib/api/campanas";
import toast from "react-hot-toast";

interface PhotoItem {
  file?: File;
  url?: string;
  isNew: boolean;
  preview: string;
}

interface OrderModalProps {
  order?: Order | null; // null = create mode, Order = edit mode
  onClose: () => void;
  onSaved: () => void;
}

const PRODUCT_SELECT_OPTIONS: SelectOption[] = [
  { value: "", label: "Seleccionar..." },
  ...PRODUCT_OPTIONS.map((p) => ({ value: p, label: p })),
];

export default function OrderModal({ order, onClose, onSaved }: OrderModalProps) {
  const isEditing = !!order;
  const [producto, setProducto] = useState(order?.producto ?? "");
  const [telefono, setTelefono] = useState(order?.telefono ?? "");
  const [precio, setPrecio] = useState(order?.precio ? String(order.precio) : "");
  const [datosProducto, setDatosProducto] = useState(order?.datosProducto ?? "");
  const [datosPromocion, setDatosPromocion] = useState(order?.datosPromocion ?? "");
  const [comentarios, setComentarios] = useState(order?.comentarios ?? "");
  const [useSamePhotos, setUseSamePhotos] = useState(false);

  const [orderPhotos, setOrderPhotos] = useState<PhotoItem[]>(
    () => (order?.fotoUrls ?? []).map((url) => ({ url, isNew: false, preview: url }))
  );
  const [promoPhotos, setPromoPhotos] = useState<PhotoItem[]>(
    () => (order?.fotoPromocionUrls ?? []).map((url) => ({ url, isNew: false, preview: url }))
  );

  // Campaña tracking (opcional)
  const [campanasActivas, setCampanasActivas] = useState<Campana[]>([]);
  const [campanaIdActual, setCampanaIdActual] = useState<string>(order?.campana_id ?? "");
  const [plantillaOrigen, setPlantillaOrigen] = useState<string>(order?.plantilla_origen ?? "");
  const [vieneDeCampana, setVieneDeCampana] = useState<boolean>(
    !!(order?.campana_id && order.campana_id.length > 0)
  );

  const [saving, setSaving] = useState(false);
  const [savingText, setSavingText] = useState("");
  const [error, setError] = useState("");

  const orderFileRef = useRef<HTMLInputElement>(null);
  const promoFileRef = useRef<HTMLInputElement>(null);

  // Listener de campañas activas (para mostrar en el selector si el usuario marca el checkbox)
  useEffect(() => {
    const q = query(collection(db, "campanas"), where("estatus", "==", "activa"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => mapCampanaDoc(d.id, d.data()));
        // Si estamos editando un pedido cuya campaña ya está cerrada, la incluimos también
        // para no perder el tag retroactivo al re-guardar.
        if (order?.campana_id && !list.find((c) => c.id === order.campana_id)) {
          // Cargar esa campaña una sola vez vía snapshot adicional sería overkill; en su lugar
          // marcamos un placeholder con el id para que el Select muestre algo si es necesario.
          list.push({
            id: order.campana_id,
            nombre: `(campaña cerrada · ${order.campana_id.slice(0, 6)})`,
            fecha_inicio: null,
            fecha_fin: null,
            estatus: "cerrada",
            plantillas: order.plantilla_origen ? { [order.plantilla_origen]: { contactados: 0, notas: "" } } : {},
            notas: "",
            creada_por: "",
            creada_en: null,
          });
        }
        setCampanasActivas(list);
      },
      (err) => {
        console.warn("[OrderModal] Error cargando campañas activas:", err);
      }
    );
    return () => unsub();
  }, [order?.campana_id, order?.plantilla_origen]);

  // Handle paste for photos
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) addOrderPhoto(file);
        }
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  function addOrderPhoto(file: File) {
    const preview = URL.createObjectURL(file);
    setOrderPhotos((prev) => [...prev, { file, isNew: true, preview }]);
  }

  function addPromoPhoto(file: File) {
    const preview = URL.createObjectURL(file);
    setPromoPhotos((prev) => [...prev, { file, isNew: true, preview }]);
  }

  function handleFilesSelected(files: FileList | null, type: "order" | "promo") {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (type === "order") addOrderPhoto(file);
      else addPromoPhoto(file);
    });
  }

  function handleDrop(e: React.DragEvent, type: "order" | "promo") {
    e.preventDefault();
    handleFilesSelected(e.dataTransfer.files, type);
  }

  const removePhoto = useCallback((index: number, type: "order" | "promo") => {
    if (type === "order") {
      setOrderPhotos((prev) => prev.filter((_, i) => i !== index));
    } else {
      setPromoPhotos((prev) => prev.filter((_, i) => i !== index));
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!producto) { setError("¡Debes seleccionar un producto!"); return; }
    if (!telefono.trim()) { setError("¡El número de teléfono es obligatorio!"); return; }

    setSaving(true);

    try {
      // Upload photos
      setSavingText("Subiendo fotos...");
      const finalPhotos = useSamePhotos ? orderPhotos : promoPhotos;
      const finalOrderUrls = await processPhotos(orderPhotos, order?.fotoUrls ?? [], "pedidos");
      const finalPromoUrls = await processPhotos(finalPhotos, order?.fotoPromocionUrls ?? [], "promociones");

      // Campaña: solo se guardan si el checkbox está marcado Y se seleccionaron ambos.
      // Si se desmarca el checkbox al editar, se limpian los campos (pasan a null).
      const campana_id =
        vieneDeCampana && campanaIdActual ? campanaIdActual : null;
      const plantilla_origen_final =
        vieneDeCampana && plantillaOrigen ? plantillaOrigen : null;

      if (vieneDeCampana && (!campanaIdActual || !plantillaOrigen)) {
        setSaving(false);
        setSavingText("");
        setError("Si marcaste que viene de campaña, selecciona campaña y plantilla.");
        return;
      }

      const data = {
        producto,
        telefono: telefono.trim(),
        precio: Number(precio) || 0,
        datosProducto: datosProducto.trim(),
        datosPromocion: datosPromocion.trim(),
        comentarios: comentarios.trim(),
        fotoUrls: finalOrderUrls,
        fotoPromocionUrls: finalPromoUrls,
        campana_id,
        plantilla_origen: plantilla_origen_final,
      };

      if (isEditing && order) {
        setSavingText("Actualizando...");
        await updateOrder(order.id, data);
        toast.success("Pedido actualizado");
      } else {
        setSavingText("Guardando...");
        await createOrder(data);
        toast.success("¡Pedido registrado!", { icon: "🎉" });
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar pedido");
    } finally {
      setSaving(false);
      setSavingText("");
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-container-lowest rounded-3xl shadow-xl max-w-[750px] w-full mx-4 max-h-[90vh] flex flex-col border border-outline-variant/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-bold font-headline text-on-surface">
            {isEditing ? "Editar Pedido" : "Registrar Nuevo Pedido"}
          </h2>
          <button onClick={onClose} className="p-1.5 text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-all">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Row: Producto + Telefono + Precio */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Producto *</label>
              <Select
                value={producto}
                onChange={setProducto}
                options={PRODUCT_SELECT_OPTIONS}
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Teléfono *</label>
              <input
                type="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="5512345678"
                className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 placeholder:text-on-surface-variant/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Precio (MXN)</label>
              <input
                type="number"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="650.00"
                step="0.01"
                className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 placeholder:text-on-surface-variant/50"
              />
            </div>
          </div>

          {/* Order Photos */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Fotos del Pedido</label>
            <div
              onDrop={(e) => handleDrop(e, "order")}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => orderFileRef.current?.click()}
              className="border-2 border-dashed border-outline-variant/30 rounded-xl p-4 text-center cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all"
            >
              <span className="material-symbols-outlined text-2xl text-on-surface-variant/40 mb-1">cloud_upload</span>
              <p className="text-xs text-on-surface-variant">Haz clic o arrastra imágenes aquí</p>
              <input ref={orderFileRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFilesSelected(e.target.files, "order")} />
            </div>
            {orderPhotos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto py-2">
                {orderPhotos.map((photo, i) => (
                  <div key={i} className="relative flex-shrink-0 group">
                    <img src={photo.preview} alt="" className="w-20 h-20 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i, "order")}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-error text-on-error rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Datos Producto */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Detalles del Producto</label>
            <textarea
              value={datosProducto}
              onChange={(e) => setDatosProducto(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 resize-none placeholder:text-on-surface-variant/50"
              placeholder="Medidas, colores, materiales..."
            />
          </div>

          {/* Promo Photos */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Fotos de la Promoción</label>
              {orderPhotos.length > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useSamePhotos}
                    onChange={(e) => setUseSamePhotos(e.target.checked)}
                    className="rounded text-primary focus:ring-primary/20"
                  />
                  <span className="text-[10px] text-on-surface-variant font-medium">Usar mismas fotos</span>
                </label>
              )}
            </div>
            {!useSamePhotos && (
              <>
                <div
                  onDrop={(e) => handleDrop(e, "promo")}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => promoFileRef.current?.click()}
                  className="border-2 border-dashed border-outline-variant/30 rounded-xl p-4 text-center cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all"
                >
                  <span className="material-symbols-outlined text-2xl text-on-surface-variant/40 mb-1">cloud_upload</span>
                  <p className="text-xs text-on-surface-variant">Haz clic o arrastra imágenes aquí</p>
                  <input ref={promoFileRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFilesSelected(e.target.files, "promo")} />
                </div>
                {promoPhotos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto py-2">
                    {promoPhotos.map((photo, i) => (
                      <div key={i} className="relative flex-shrink-0 group">
                        <img src={photo.preview} alt="" className="w-20 h-20 rounded-lg object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i, "promo")}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-error text-on-error rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Datos Promocion */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Detalles de la Promoción</label>
            <textarea
              value={datosPromocion}
              onChange={(e) => setDatosPromocion(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 resize-none placeholder:text-on-surface-variant/50"
              placeholder="Descuento, texto promocional..."
            />
          </div>

          {/* Comentarios */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Comentarios Adicionales</label>
            <textarea
              value={comentarios}
              onChange={(e) => setComentarios(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-surface-container-low border-none rounded-xl text-sm text-on-surface focus:ring-primary/20 resize-none placeholder:text-on-surface-variant/50"
              placeholder="Notas internas, instrucciones especiales..."
            />
          </div>

          {/* Campaña (opcional) */}
          <div className="space-y-2 rounded-xl bg-surface-container-low/60 px-4 py-3 border border-outline-variant/15">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={vieneDeCampana}
                onChange={(e) => {
                  setVieneDeCampana(e.target.checked);
                  if (!e.target.checked) {
                    setCampanaIdActual("");
                    setPlantillaOrigen("");
                  }
                }}
                className="rounded text-primary focus:ring-primary/20"
              />
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>campaign</span>
              <span className="text-sm font-semibold text-on-surface">¿Viene de una campaña?</span>
            </label>

            {vieneDeCampana && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Campaña *</label>
                  <Select
                    value={campanaIdActual}
                    onChange={(v) => {
                      setCampanaIdActual(v);
                      // Si la campaña cambia, limpiar la plantilla seleccionada para evitar inconsistencia
                      setPlantillaOrigen("");
                    }}
                    placeholder={campanasActivas.length === 0 ? "Sin campañas activas" : "Seleccionar campaña..."}
                    options={[
                      { value: "", label: "Seleccionar campaña..." },
                      ...campanasActivas.map((c) => ({ value: c.id, label: c.nombre })),
                    ]}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Plantilla origen *</label>
                  <Select
                    value={plantillaOrigen}
                    onChange={setPlantillaOrigen}
                    placeholder="Seleccionar plantilla..."
                    options={(() => {
                      const camp = campanasActivas.find((c) => c.id === campanaIdActual);
                      const keys = camp ? Object.keys(camp.plantillas) : [];
                      return [
                        { value: "", label: keys.length === 0 ? "Elige campaña primero" : "Seleccionar plantilla..." },
                        ...keys.map((k) => ({ value: k, label: k })),
                      ];
                    })()}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-error-container/30 text-on-error-container text-sm px-4 py-3 rounded-xl font-medium">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 rounded-xl text-sm font-bold text-on-primary bg-primary hover:opacity-90 transition-all disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                {savingText}
              </>
            ) : (
              "Guardar Pedido"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
