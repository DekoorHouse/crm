"use client";

import { useState, useEffect, useRef } from "react";
import CrudModal from "@/components/crm/CrudModal";
import { db } from "@/lib/firebase/config";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot,
  query,
} from "firebase/firestore";
import toast from "react-hot-toast";
import { useDepartments } from "@/lib/hooks/useDepartments";

interface KnowledgeItem {
  id: string;
  topic: string;
  answer: string;
}

function KbModal({ item, onClose }: { item: KnowledgeItem | null; onClose: () => void }) {
  const [topic, setTopic] = useState(item?.topic ?? "");
  const [answer, setAnswer] = useState(item?.answer ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!topic.trim() || !answer.trim()) return;
    setSaving(true);
    try {
      if (item) {
        await updateDoc(doc(db, "ai_knowledge_base", item.id), { topic: topic.trim(), answer: answer.trim() });
      } else {
        await addDoc(collection(db, "ai_knowledge_base"), { topic: topic.trim(), answer: answer.trim() });
      }
      toast.success(item ? "Actualizado" : "Creado");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrudModal
      title={item ? "Editar Conocimiento" : "Nuevo Conocimiento"}
      onClose={onClose}
      onSubmit={handleSave}
      saving={saving}
      canSave={!!topic.trim() && !!answer.trim()}
    >
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
          Tema / Pregunta *
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Ej: Que productos tienen?"
          className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">
          Respuesta *
        </label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Tenemos lamparas personalizadas, cuadros..."
          rows={5}
          className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none"
        />
      </div>
    </CrudModal>
  );
}

function DepartmentPromptsSection() {
  const { departments, loading: deptsLoading } = useDepartments();
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [originalPrompts, setOriginalPrompts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (deptsLoading) return;
    if (departments.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all(
      departments.map((d) =>
        getDoc(doc(db, "ai_department_prompts", d.id))
          .then((snap) => ({ id: d.id, prompt: (snap.data()?.prompt as string) || "" }))
          .catch(() => ({ id: d.id, prompt: "" }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      results.forEach((r) => {
        map[r.id] = r.prompt;
      });
      setPrompts(map);
      setOriginalPrompts(map);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [departments, deptsLoading]);

  async function handleSave(deptId: string) {
    setSaving((s) => ({ ...s, [deptId]: true }));
    try {
      await setDoc(
        doc(db, "ai_department_prompts", deptId),
        { prompt: prompts[deptId] || "", updatedAt: serverTimestamp() },
        { merge: true }
      );
      setOriginalPrompts((o) => ({ ...o, [deptId]: prompts[deptId] || "" }));
      toast.success("Instrucciones guardadas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving((s) => ({ ...s, [deptId]: false }));
    }
  }

  function toggleExpand(deptId: string) {
    setExpanded((e) => ({ ...e, [deptId]: !e[deptId] }));
  }

  if (loading || deptsLoading) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-6">
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 p-6 mb-6">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            corporate_fare
          </span>
          Instrucciones del Bot por Departamento
        </h3>
        <p className="text-xs text-on-surface-variant mt-1">
          Define instrucciones específicas para cada producto/departamento. El bot las usará cuando el contacto esté
          asignado al departamento correspondiente, en lugar de las instrucciones generales de Ajustes.
        </p>
      </div>

      {departments.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-on-surface-variant">
            No hay departamentos. Crea uno en{" "}
            <a href="/crm/departamentos" className="text-primary font-semibold hover:underline">
              Departamentos
            </a>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {departments.map((dept) => {
            const isExpanded = expanded[dept.id] ?? false;
            const currentValue = prompts[dept.id] ?? "";
            const isDirty = currentValue !== (originalPrompts[dept.id] ?? "");
            const hasPrompt = !!(originalPrompts[dept.id] ?? "").trim();

            return (
              <div key={dept.id} className="border border-outline-variant/10 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpand(dept.id)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-surface-container-low/50 hover:bg-surface-container-low transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-md flex-shrink-0" style={{ backgroundColor: dept.color }} />
                    <span className="text-sm font-semibold text-on-surface">{dept.name}</span>
                    {hasPrompt && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Configurado
                      </span>
                    )}
                    {isDirty && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">
                        Sin guardar
                      </span>
                    )}
                  </div>
                  <span
                    className="material-symbols-outlined text-on-surface-variant"
                    style={{ fontSize: 20 }}
                  >
                    {isExpanded ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="p-4 space-y-3">
                    <textarea
                      value={currentValue}
                      onChange={(e) =>
                        setPrompts((p) => ({ ...p, [dept.id]: e.target.value }))
                      }
                      rows={8}
                      placeholder={`Instrucciones del bot para "${dept.name}"...`}
                      className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none font-mono"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleSave(dept.id)}
                        disabled={saving[dept.id] || !isDirty}
                        className="px-4 py-2 text-sm font-bold text-on-primary bg-primary rounded-xl hover:opacity-90 disabled:opacity-40 transition-all"
                      >
                        {saving[dept.id] ? "Guardando..." : "Guardar instrucciones"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KnowledgeBaseSection() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const q = query(collection(db, "ai_knowledge_base"));
    unsubRef.current = onSnapshot(q, (snap) => {
      setItems(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            topic: (data.topic as string) || "",
            answer: (data.answer as string) || "",
          };
        })
      );
      setLoading(false);
    });
    return () => unsubRef.current?.();
  }, []);

  async function handleDelete(item: KnowledgeItem) {
    if (!confirm("¿Eliminar este elemento?")) return;
    try {
      await deleteDoc(doc(db, "ai_knowledge_base", item.id));
      toast.success("Eliminado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant/10 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/10">
        <div>
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              school
            </span>
            Base de Conocimiento
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            Pares de pregunta / respuesta que la IA puede usar como referencia
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="bg-primary text-on-primary px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Nuevo
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant/30 mb-2 block">
            school
          </span>
          <p className="text-sm text-on-surface-variant">No hay elementos</p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="bg-surface-container-low/50 border-b border-outline-variant/10">
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Tema
              </th>
              <th className="text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Respuesta
              </th>
              <th className="text-right px-5 py-3 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-outline-variant/5 hover:bg-surface-container-low/30 transition-colors"
              >
                <td className="px-5 py-3">
                  <span className="text-sm font-semibold text-on-surface">{item.topic}</span>
                </td>
                <td className="px-5 py-3">
                  <p className="text-sm text-on-surface-variant truncate max-w-[350px]">{item.answer}</p>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => {
                        setEditing(item);
                        setModalOpen(true);
                      }}
                      className="p-1.5 text-on-surface-variant/60 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                      title="Editar"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        edit
                      </span>
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="p-1.5 text-on-surface-variant/60 hover:text-error hover:bg-error-container/20 rounded-lg transition-all"
                      title="Eliminar"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        delete
                      </span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen && <KbModal item={editing} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

export default function EntrenamientoIaPage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold font-headline text-on-surface">Entrenamiento IA</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Configura las instrucciones del bot por departamento y su base de conocimiento
        </p>
      </div>
      <DepartmentPromptsSection />
      <KnowledgeBaseSection />
    </div>
  );
}
