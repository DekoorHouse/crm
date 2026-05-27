"use client";

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase/config";

export type EstatusCampana = "activa" | "cerrada";

export interface CampanaPlantilla {
  contactados: number;
  notas: string;
}

export interface Campana {
  id: string;
  nombre: string;
  fecha_inicio: Timestamp | null;
  fecha_fin: Timestamp | null;
  estatus: EstatusCampana;
  plantillas: Record<string, CampanaPlantilla>;
  notas: string;
  creada_por: string;
  creada_en: Timestamp | null;
  actualizada_en?: Timestamp | null;
}

export interface CampanaInput {
  nombre: string;
  fecha_inicio: Date;
  fecha_fin: Date;
  estatus: EstatusCampana;
  plantillas: Record<string, CampanaPlantilla>;
  notas: string;
}

export async function createCampana(data: CampanaInput): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("No autenticado");

  const payload = {
    nombre: data.nombre.trim(),
    fecha_inicio: Timestamp.fromDate(data.fecha_inicio),
    fecha_fin: Timestamp.fromDate(data.fecha_fin),
    estatus: data.estatus,
    plantillas: data.plantillas,
    notas: data.notas.trim(),
    creada_por: user.email ?? user.uid,
    creada_en: serverTimestamp(),
    actualizada_en: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "campanas"), payload);
  return ref.id;
}

export async function updateCampana(id: string, data: Partial<CampanaInput>): Promise<void> {
  const payload: Record<string, unknown> = { actualizada_en: serverTimestamp() };
  if (data.nombre !== undefined) payload.nombre = data.nombre.trim();
  if (data.fecha_inicio !== undefined) payload.fecha_inicio = Timestamp.fromDate(data.fecha_inicio);
  if (data.fecha_fin !== undefined) payload.fecha_fin = Timestamp.fromDate(data.fecha_fin);
  if (data.estatus !== undefined) payload.estatus = data.estatus;
  if (data.plantillas !== undefined) payload.plantillas = data.plantillas;
  if (data.notas !== undefined) payload.notas = data.notas.trim();
  await updateDoc(doc(db, "campanas", id), payload);
}

export async function deleteCampana(id: string): Promise<void> {
  await deleteDoc(doc(db, "campanas", id));
}

export async function closeCampana(id: string): Promise<void> {
  await updateDoc(doc(db, "campanas", id), {
    estatus: "cerrada",
    actualizada_en: serverTimestamp(),
  });
}

export async function reopenCampana(id: string): Promise<void> {
  await updateDoc(doc(db, "campanas", id), {
    estatus: "activa",
    actualizada_en: serverTimestamp(),
  });
}

export function mapCampanaDoc(id: string, d: Record<string, unknown>): Campana {
  const plantillasRaw = (d.plantillas as Record<string, unknown>) || {};
  const plantillas: Record<string, CampanaPlantilla> = {};
  Object.entries(plantillasRaw).forEach(([k, v]) => {
    const p = v as Record<string, unknown>;
    plantillas[k] = {
      contactados: typeof p?.contactados === "number" ? p.contactados : 0,
      notas: typeof p?.notas === "string" ? p.notas : "",
    };
  });

  return {
    id,
    nombre: (d.nombre as string) || "",
    fecha_inicio: (d.fecha_inicio as Timestamp) || null,
    fecha_fin: (d.fecha_fin as Timestamp) || null,
    estatus: ((d.estatus as string) === "cerrada" ? "cerrada" : "activa") as EstatusCampana,
    plantillas,
    notas: (d.notas as string) || "",
    creada_por: (d.creada_por as string) || "",
    creada_en: (d.creada_en as Timestamp) || null,
    actualizada_en: (d.actualizada_en as Timestamp) || null,
  };
}

export function formatRangoFechas(c: Campana): string {
  const fmt = (t: Timestamp | null) => {
    if (!t) return "—";
    return t.toDate().toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  };
  return `${fmt(c.fecha_inicio)} → ${fmt(c.fecha_fin)}`;
}
