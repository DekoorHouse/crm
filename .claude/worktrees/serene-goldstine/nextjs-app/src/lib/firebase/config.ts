import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
  authDomain: "pedidos-con-gemini.firebaseapp.com",
  projectId: "pedidos-con-gemini",
  storageBucket: "pedidos-con-gemini.firebasestorage.app",
  messagingSenderId: "300825194175",
  appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
  measurementId: "G-FTCDCMZB1S",
};

// Prevent re-initialization in dev mode (hot reload)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
