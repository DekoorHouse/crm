"use client";

import { useState, useEffect, useRef } from "react";
import type { Contact } from "@/lib/api/contacts";
import { skipAi, cancelAi, markAsPurchase, fetchContactOrders } from "@/lib/api/contacts";
import { db } from "@/lib/firebase/config";
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import toast from "react-hot-toast";

interface Note { id: string; text: string; timestamp: unknown; }
interface Order { id: string; consecutiveOrderNumber: number; producto: string; estatus: string; precio: number; createdAt?: string | null; }

interface ContactDetailsProps {
  contact: Contact;
  onClose: () => void;
  onNewOrder?: () => void;
  onStatusChange?: (orderId: string, newStatus: string) => void;
}

function formatOrderDate(createdAt?: string | null): string {
  if (!createdAt) return "";
  return new Date(createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export default function ContactDetails({ contact, onClose, onNewOrder, onStatusChange }: ContactDetailsProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const unsubNotes = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubNotes.current?.();
    const q = query(collection(db, "contacts_whatsapp", contact.id, "notes"), orderBy("timestamp", "desc"));
    unsubNotes.current = onSnapshot(q, (snap) => {
      setNotes(snap.docs.map((d) => ({ id: d.id, text: d.data().text || "", timestamp: d.data().timestamp })));
    });
    return () => unsubNotes.current?.();
  }, [contact.id]);

  useEffect(() => {
    fetchContactOrders(contact.id).then((o) => setOrders(o as Order[])).catch(() => {});
  }, [contact.id]);

  async function addNote() {
    if (!newNote.trim()) return;
    await addDoc(collection(db, "contacts_whatsapp", contact.id, "notes"), { text: newNote.trim(), timestamp: serverTimestamp() });
    setNewNote("");
  }

  async function deleteNote(noteId: string) {
    await deleteDoc(doc(db, "contacts_whatsapp", contact.id, "notes", noteId));
  }

  async function saveNote(noteId: string) {
    await updateDoc(doc(db, "contacts_whatsapp", contact.id, "notes", noteId), { text: editText });
    setEditingNote(null);
  }

  async function toggleBot() {
    try {
      if (contact.botActive) { await cancelAi(contact.id); toast.success("IA desactivada"); }
      else { await skipAi(contact.id); toast.success("IA activada"); }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
  }

  async function handleMarkPurchase() {
    const value = prompt("Valor de la compra (MXN):");
    if (!value) return;
    try {
      await markAsPurchase(contact.id, parseFloat(value));
      toast.success("Compra registrada y evento enviado a Meta");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
  }

  return (
    <aside className="w-80 h-full flex flex-col border-l border-outline-variant/15 bg-surface-container-lowest flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between">
        <h3 className="text-sm font-bold text-on-surface">Detalles del contacto</h3>
        <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Avatar + name */}
        <div className="px-4 py-5 text-center border-b border-outline-variant/10">
          <div className="relative inline-block mb-3">
            <div className="w-16 h-16 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-bold text-2xl mx-auto">
              {(contact.name || contact.id).charAt(0).toUpperCase()}
            </div>
            {/* Purchase crown */}
            {contact.purchaseStatus && (
              <div className={`absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center ${
                contact.purchaseStatus === "completed" ? "bg-primary" : "bg-surface-container-high"
              }`}>
                <span className="material-symbols-outlined text-on-primary" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>
                  workspace_premium
                </span>
              </div>
            )}
            {/* Online indicator */}
            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-primary border-2 border-surface-container-lowest" />
          </div>
          <p className="text-base font-bold text-on-surface">{contact.name || contact.id}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">+{contact.id}</p>
          {contact.email && <p className="text-xs text-on-surface-variant">{contact.email}</p>}
        </div>

        {/* Orders history */}
        <div className="px-4 py-4 border-b border-outline-variant/10">
          <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-3">Historial de pedidos</p>
          {orders.length === 0 ? (
            <p className="text-xs text-on-surface-variant/50 italic">Sin pedidos registrados.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => (
                <div key={order.id} className="bg-surface-container-low/50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-primary">DH{order.consecutiveOrderNumber}</span>
                    <span className="text-[10px] text-on-surface-variant">{formatOrderDate(order.createdAt)}</span>
                  </div>
                  <p className="text-xs text-on-surface">{order.producto}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <button
                      onClick={(e) => {
                        if (onStatusChange) {
                          // Simple status cycle for now
                          const statuses = ["Sin estatus", "Foto enviada", "Esperando pago", "Pagado", "Diseñado", "Fabricar", "Corregir", "Corregido", "Mns Amenazador", "Cancelado"];
                          const idx = statuses.indexOf(order.estatus);
                          const next = statuses[(idx + 1) % statuses.length];
                          onStatusChange(order.id, next);
                        }
                      }}
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest transition-colors cursor-pointer"
                    >
                      {order.estatus} <span className="text-on-surface-variant/40">&#9662;</span>
                    </button>
                    {order.precio > 0 && (
                      <span className="text-xs font-bold text-on-surface">${order.precio.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="px-4 py-4 border-b border-outline-variant/10">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Notas internas</p>
            <button onClick={() => document.getElementById("note-input")?.focus()}
              className="p-1 text-on-surface-variant hover:text-primary rounded-lg">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <input id="note-input" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Agregar nota..."
                onKeyDown={(e) => e.key === "Enter" && addNote()}
                className="flex-1 bg-surface-container-low rounded-lg px-3 py-1.5 text-xs text-on-surface border-none focus:ring-0 focus:outline-none placeholder:text-on-surface-variant/50" />
              {newNote.trim() && (
                <button onClick={addNote} className="p-1.5 bg-primary text-on-primary rounded-lg">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>send</span>
                </button>
              )}
            </div>
            {notes.length === 0 && (
              <p className="text-xs text-on-surface-variant/50 italic text-center py-2">Sin notas internas.</p>
            )}
            {notes.map((note) => (
              <div key={note.id} className="bg-surface-container-low/50 rounded-lg p-2.5 group">
                {editingNote === note.id ? (
                  <div className="flex gap-1">
                    <input value={editText} onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveNote(note.id)}
                      className="flex-1 bg-surface-container-low rounded px-2 py-1 text-xs border-none focus:ring-0 focus:outline-none" autoFocus />
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
          </div>
        </div>
      </div>

      {/* Action buttons (fixed at bottom) */}
      <div className="px-3 py-3 border-t border-outline-variant/10 space-y-1.5">
        <button onClick={handleMarkPurchase}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold bg-primary text-on-primary hover:opacity-90 transition-all">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>shopping_cart</span>
          Registrar Compra (Meta)
        </button>
        <button onClick={toggleBot}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all ${
            contact.botActive
              ? "bg-error-container/20 text-error hover:bg-error-container/30"
              : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
          }`}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>smart_toy</span>
          {contact.botActive ? "Desactivar IA" : "Activar IA"}
        </button>
        {onNewOrder && (
          <button onClick={onNewOrder}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-all">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_circle</span>
            Registrar Nuevo Pedido
          </button>
        )}
      </div>
    </aside>
  );
}
