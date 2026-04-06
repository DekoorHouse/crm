"use client";

import { useState, useCallback } from "react";
import CrudPage from "@/components/crm/CrudPage";
import CrudModal from "@/components/crm/CrudModal";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, doc, updateDoc, deleteDoc } from "firebase/firestore";
import toast from "react-hot-toast";

interface KnowledgeItem {
  id: string;
  topic: string;
  answer: string;
}

function KbModal({ item, onClose, onSaved }: { item: KnowledgeItem | null; onClose: () => void; onSaved: () => void }) {
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
      onSaved(); onClose();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    finally { setSaving(false); }
  }

  return (
    <CrudModal title={item ? "Editar Conocimiento" : "Nuevo Conocimiento"} onClose={onClose} onSubmit={handleSave} saving={saving} canSave={!!topic.trim() && !!answer.trim()}>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Tema / Pregunta *</label>
        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej: Que productos tienen?" className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant ml-1">Respuesta *</label>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Tenemos lamparas personalizadas, cuadros..." rows={5} className="w-full bg-surface-container-low rounded-xl px-4 py-2.5 text-sm text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50 resize-none" />
      </div>
    </CrudModal>
  );
}

export default function EntrenamientoIaPage() {
  const mapDoc = useCallback((id: string, d: Record<string, unknown>) => ({
    id, topic: (d.topic as string) || "", answer: (d.answer as string) || "",
  }), []);

  return (
    <CrudPage<KnowledgeItem>
      title="Entrenamiento IA"
      description="Base de conocimiento para las respuestas de la IA"
      icon="school"
      firestoreCollection="ai_knowledge_base"
      mapDoc={mapDoc}
      columns={[
        { key: "topic", label: "Tema", render: (k) => <span className="text-sm font-semibold text-on-surface">{k.topic}</span> },
        { key: "answer", label: "Respuesta", render: (k) => <p className="text-sm text-on-surface-variant truncate max-w-[350px]">{k.answer}</p> },
      ]}
      renderForm={(item, onClose, onSaved) => <KbModal item={item} onClose={onClose} onSaved={onSaved} />}
      onDelete={async (k) => { await deleteDoc(doc(db, "ai_knowledge_base", k.id)); }}
    />
  );
}
