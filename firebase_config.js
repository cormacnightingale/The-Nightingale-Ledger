/**
 * Firebase Configuration for The Nightingale Ledger.
 * * CRITICAL FIX: The configuration is now declared using 'var' to ensure it 
 * is globally scoped and accessible by the 'script.js' module, resolving 
 * the 'undefined' error in standard web deployments.
 */
var firebaseConfig = {
  apiKey: "AIzaSyAdmOIlbRx6uvgZiNat-BYI5GH-lvkiEqc",
  authDomain: "nightingaleledger-4627.firebaseapp.com",
  projectId: "nightingaleledger-4627",
  storageBucket: "nightingaleledger-4627.firebasestorage.app",
  messagingSenderId: "299188208241",
  appId: "1:299188208241:web:7bb086293357f4ec4691d0",
  measurementId: "G-5WLM6RZQ0Y"
};