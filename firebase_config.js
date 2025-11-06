/**
 * CRITICAL FIX: The config is now explicitly attached to the global 'window' object.
 * This ensures that the 'script.js' module can access it directly, as it
 * no longer relies on the __firebase_config global provided by the old environment.
 */
window.firebaseConfig = {
  apiKey: "AIzaSyAdmOIlbRx6uvgZiNat-BYI5GH-lvkiEqc",
  authDomain: "nightingaleledger-4627.firebaseapp.com",
  projectId: "nightingaleledger-4627",
  storageBucket: "nightingaleledger-4627.firebasestorage.app",
  messagingSenderId: "299188208241",
  appId: "1:299188208241:web:7bb086293357f4ec4691d0",
  measurementId: "G-5WLM6RZQ0Y"
};