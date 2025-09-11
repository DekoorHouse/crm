import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/**
 * @file Módulo para la configuración e inicialización de los servicios de Firebase.
 * @description Este archivo contiene la configuración del proyecto de Firebase,
 * inicializa la aplicación y exporta las instancias de Firestore y Auth
 * para ser utilizadas en otros módulos.
 */

// Configuración de Firebase para el proyecto.
const firebaseConfig = {
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg",
    authDomain: "pedidos-con-gemini.firebaseapp.com",
    projectId: "pedidos-con-gemini",
    storageBucket: "pedidos-con-gemini.appspot.com",
    messagingSenderId: "300825194175",
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a",
    measurementId: "G-FTCDCMZB1S"
};

// Inicialización de la aplicación de Firebase.
const firebaseApp = initializeApp(firebaseConfig);

/**
 * Instancia del servicio de Firestore.
 * @type {import("firebase/firestore").Firestore}
 */
export const db = getFirestore(firebaseApp);

/**
 * Instancia del servicio de Autenticación de Firebase.
 * @type {import("firebase/auth").Auth}
 */
export const auth = getAuth(firebaseApp);
