// --- START: Firebase Configuration ---
// Este archivo contiene la configuración e inicialización de los servicios de Firebase.

const firebaseConfig = { 
    apiKey: "AIzaSyBdLBxVl64KqifVUinLrtxjQnk2jrPT-yg", 
    authDomain: "pedidos-con-gemini.firebaseapp.com", 
    projectId: "pedidos-con-gemini", 
    storageBucket: "pedidos-con-gemini.firebasestorage.app",
    messagingSenderId: "300825194175", 
    appId: "1:300825194175:web:972fa7b8af195a83e6e00a", 
    measurementId: "G-FTCDCMZB1S" 
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Se actualiza la URL base para que apunte a la nueva ruta relativa.
// Ya no se necesita el dominio completo de Render, ya que el reverse proxy se encargará de ello.
const API_BASE_URL = '/crm';

