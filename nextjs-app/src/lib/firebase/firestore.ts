"use client";

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./config";
import { auth } from "./config";

interface OrderData {
  producto: string;
  telefono: string;
  precio: number;
  datosProducto: string;
  datosPromocion: string;
  comentarios: string;
  fotoUrls: string[];
  fotoPromocionUrls: string[];
}

export async function createOrder(data: OrderData): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("No autenticado");

  const orderCounterRef = doc(db, "counters", "orders");
  const pedidosRef = collection(db, "pedidos");

  // Transaction to get consecutive order number
  const newOrderNumber = await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(orderCounterRef);
    const currentCounter = counterDoc.exists()
      ? counterDoc.data().lastOrderNumber || 0
      : 0;
    const nextOrderNumber = currentCounter < 1000 ? 1001 : currentCounter + 1;
    transaction.set(orderCounterRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
    return nextOrderNumber;
  });

  const vendedor = user.email
    ? user.email.split("@")[0].charAt(0).toUpperCase() + user.email.split("@")[0].slice(1)
    : "Usuario";

  const newOrder = {
    ...data,
    vendedor,
    consecutiveOrderNumber: newOrderNumber,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    userEmail: user.email,
    estatus: "Sin estatus",
    telefonoVerificado: false,
    estatusVerificado: false,
  };

  const docRef = await addDoc(pedidosRef, newOrder);
  return docRef.id;
}

export async function updateOrder(orderId: string, data: Partial<OrderData>): Promise<void> {
  const orderRef = doc(db, "pedidos", orderId);
  await updateDoc(orderRef, data);
}

export async function deleteOrder(orderId: string): Promise<void> {
  const orderRef = doc(db, "pedidos", orderId);
  await deleteDoc(orderRef);
}
