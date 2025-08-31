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

const API_BASE_URL = 'https://crm-rzon.onrender.com';
