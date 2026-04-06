"use client";

import { useState, useEffect, useRef } from "react";
import type { Contact } from "@/lib/api/contacts";
import { updateContact, transferContact, skipAi, cancelAi, fetchContactOrders } from "@/lib/api/contacts";
import { db } from "@/lib/firebase/config";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import toast from "react-hot-toast";

interface Note { id: string; text: string; timestamp: unknown; }
interface Order { id: string; consecutiveOrderNumber: number; producto: string; estatus: string; precio: number; }

interface ContactDetailsProps {
  contact: Contact;
  onClose: () => void;
}

export default function ContactDetails({ contact, onClose }: ContactDetailsProps) {
  const [tab, setTab] = useState<"info" | "notes" | "orders">("info");
  const [notes, setNotes] = useState<Note[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const unsubNotes = useRef<(() => void) | null>(null);

  // Load notes
  useEffect(() => {
    unsubNotes.current?.();
    const q = query(collection(db, "contacts_whatsapp", contact.id, "notes"), orderBy("timestamp", "desc"));
    unsubNotes.current = onSnapshot(q, (snap) => {
      setNotes(snap.docs.map((d) => ({ id: d.id, text: d.data().text || "", timestamp: d.data().timestamp })));
    });
    return () => unsubNotes.current?.();
  }, [contact.id]);

  // Load orders
  useEffect(() => {
    fetchContactOrders(contact.id).then((o) => setOrders(o as Order[])).catch(() => {});
  }, [contact.id]);

  async function addNote() {
    if (!newNote.trim()) return;
    await addDoc(collection(db, "contacts_whatsapp", contact.id, "notes"), { text: newNote.trim(), timestamp: serverTimestamp() });
    setNewNote("");
    toast.success("Nota agregada");
  }

  async function saveNote(noteId: string) {
    await updateDoc(doc(db, "contacts_whatsapp", contact.id, "notes", noteId), { text: editText });
    setEditingNote(null);
    toast.success("Nota actualizada");
  }

  async function deleteNote(noteId: string) {
    await deleteDoc(doc(db, "contacts_whatsapp", contact.id, "notes", noteId));
    toast.success("Nota eliminada");
  }

  async function toggleBot() {
    try {
      if (contact.botActive) {
        await cancelAi(contact.id);
        toast.success("IA desactivada");
      } else {
        await skipAi(contact.id);
        toast.success("IA activada");
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
  }

  return (
    <aside className="w-72 h-full flex flex-col border-l border-outline-variant/15 bg-surface-container-lowest flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between">
        <h3 className="text-sm font-bold text-on-surface">Detalles</h3>
        <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
        </button>
      </div>

      {/* Contact info */}
      <div className="px-4 py-4 border-b border-outline-variant/10 text-center">
        <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-xl mx-auto mb-2">
          {(contact.name || contact.id).charAt(0).toUpperCase()}
        </div>
        <p className="text-sm font-bold text-on-surface">{contact.name || contact.id}</p>
        <p className="text-xs text-on-surface-variant">{contact.id}</p>
        {contact.email && <p className="text-xs text-on-surface-variant mt-0.5">{contact.email}</p>}
      </div>

      {/* Quick actions */}
      <div className="px-3 py-2 border-b border-outline-variant/10 flex gap-1">
        <button onClick={toggleBot} title={contact.botActive ? "Desactivar IA" : "Activar IA"}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
            contact.botActive ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-container-low"
          }`}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>smart_toy</span>
          IA
        </button>
        <button title="Revision diseno"
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
            contact.inDesignReview ? "bg-secondary/10 text-secondary" : "text-on-surface-variant hover:bg-surface-container-low"
          }`}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>palette</span>
          Diseno
        </button>
        {contact.purchaseStatus && (
          <div className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-primary/10 text-primary">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>shopping_cart</span>
            {contact.purchaseStatus === "completed" ? "Compra" : "Registro"}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant/10">
        {(["info", "notes", "orders"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
              tab === t ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"
            }`}>
            {t === "info" ? "Info" : t === "notes" ? `Notas (${notes.length})` : `Pedidos (${orders.length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "info" && (
          <div className="space-y-3 text-xs">
            <div><span className="text-on-surface-variant">Canal:</span> <span className="font-semibold text-on-surface ml-1">{contact.channel}</span></div>
            <div><span className="text-on-surface-variant">Etiqueta:</span> <span className="font-semibold text-on-surface ml-1">{contact.status || "Sin etiqueta"}</span></div>
            {contact.lastOrderNumber && (
              <div><span className="text-on-surface-variant">Ultimo pedido:</span> <span className="font-semibold text-primary ml-1">DH{contact.lastOrderNumber}</span></div>
            )}
            {contact.assignedDepartmentId && (
              <div><span className="text-on-surface-variant">Departamento:</span> <span className="font-semibold text-on-surface ml-1">{contact.assignedDepartmentId}</span></div>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="space-y-2">
            <div className="flex gap-1">
              <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Nueva nota..."
                onKeyDown={(e) => e.key === "Enter" && addNote()}
                className="flex-1 bg-surface-container-low rounded-lg px-3 py-1.5 text-xs text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
              <button onClick={addNote} disabled={!newNote.trim()} className="p-1.5 bg-primary text-on-primary rounded-lg disabled:opacity-40">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              </button>
            </div>
            {notes.map((note) => (
              <div key={note.id} className="bg-surface-container-low/50 rounded-lg p-2.5 group">
                {editingNote === note.id ? (
                  <div className="flex gap-1">
                    <input value={editText} onChange={(e) => setEditText(e.target.value)} className="flex-1 bg-surface-container-low rounded px-2 py-1 text-xs border-none focus:ring-0 focus:outline-none" />
                    <button onClick={() => saveNote(note.id)} className="text-primary"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span></button>
                    <button onClick={() => setEditingNote(null)} className="text-on-surface-variant"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span></button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-on-surface">{note.text}</p>
                    <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingNote(note.id); setEditText(note.text); }} className="text-on-surface-variant/50 hover:text-primary">
                        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit</span>
                      </button>
                      <button onClick={() => deleteNote(note.id)} className="text-on-surface-variant/50 hover:text-error">
                        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>delete</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {notes.length === 0 && <p className="text-xs text-on-surface-variant/50 text-center py-4">Sin notas</p>}
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-2">
            {orders.map((order) => (
              <div key={order.id} className="bg-surface-container-low/50 rounded-lg p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">DH{order.consecutiveOrderNumber}</span>
                  <span className="text-[10px] font-semibold text-on-surface-variant">{order.estatus}</span>
                </div>
                <p className="text-xs text-on-surface mt-0.5">{order.producto}</p>
                {order.precio > 0 && <p className="text-xs font-bold text-on-surface mt-0.5">${order.precio.toLocaleString()}</p>}
              </div>
            ))}
            {orders.length === 0 && <p className="text-xs text-on-surface-variant/50 text-center py-4">Sin pedidos</p>}
          </div>
        )}
      </div>
    </aside>
  );
}
