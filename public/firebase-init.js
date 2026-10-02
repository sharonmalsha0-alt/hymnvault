/* firebase-init.js
   Standard initialization template with localhost detection.
   - Uses production config by default
   - Supports separate local config (optional) via window.__FIREBASE_LOCAL_CONFIG__
   - Always logs Firebase errors so you don’t get stuck “Loading …”
*/

/**
 * Detect if running on localhost/127.0.0.1 (including Live Server default port 5500).
 */
function isLocalhost() {
  const host = (window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * Production config: keep this for your deployed site.
 * NOTE: Replace with your real production values if they differ.
 */
const firebaseConfigProd = {
  apiKey: "AIzaSyBciJKI7vdGu9nFr0bMDuWO9mYUu0yeDCU",
  authDomain: "hymnvault.firebaseapp.com",
  projectId: "hymnvault",
  storageBucket: "hymnvault.firebasestorage.app",
  messagingSenderId: "397124269230",
  appId: "1:397124269230:web:d9bd1bfec77c684f76293f",
  measurementId: "G-QHGW23HV09",
};

/**
 * Local config:
 * - Option A (recommended): use the same Firebase project as prod, but configure Authorized domains
 * - Option B: provide a separate config for a “local” Firebase project (emulator or another project)
 *
 * If you don’t provide window.__FIREBASE_LOCAL_CONFIG__, it falls back to prod config.
 */
const firebaseConfigLocal = window.__FIREBASE_LOCAL_CONFIG__ || firebaseConfigProd;

const activeConfig = isLocalhost() ? firebaseConfigLocal : firebaseConfigProd;

/**
 * Init (Firebase v8 namespaced SDK expects global firebase).
 */
function initFirebaseV8() {
  if (typeof window.firebase === 'undefined') {
    console.error('[Firebase] SDK not loaded. Ensure firebase-app.js is included before this file.');
    return null;
  }

  if (!window.firebase.apps || window.firebase.apps.length === 0) {
    window.firebase.initializeApp(activeConfig);
  }

  return window.firebase;
}

/**
 * Convenience getter: returns firestore db or null.
 */
function getFirestoreDb() {
  try {
    if (!window.firebase) return null;
    if (!window.firebase.firestore) return null;
    return window.firebase.firestore();
  } catch (e) {
    console.error('[Firebase] Firestore init failed:', e);
    return null;
  }
}

// Initialize immediately
window.__FIREBASE__ = initFirebaseV8();
window.__DB__ = getFirestoreDb();

// Helpful: log any unhandled Firestore errors so UI doesn’t stay stuck forever
if (window.__DB__) {
  console.log('[Firebase] Initialized. Local mode:', isLocalhost());
}

