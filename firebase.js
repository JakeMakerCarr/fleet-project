import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyAjnCWLnUf8msIUjL0TBdZ1eCAiXMLOwvU',
  authDomain: 'yfned-fleet-nfc.firebaseapp.com',
  databaseURL: 'https://yfned-fleet-nfc-default-rtdb.firebaseio.com',
  projectId: 'yfned-fleet-nfc',
  storageBucket: 'yfned-fleet-nfc.appspot.com',
  messagingSenderId: '482363667898',
  appId: '1:482363667898:web:4b0364e891a221e9631983',
  measurementId: 'G-LK66DQVKW4'
});

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Keep Firebase's authenticated user available when NFC scans open a new tab.
// A separate five-minute activity marker limits the quick-access window without
// storing credentials or granting access when Firebase itself is signed out.
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence)
  .catch((error) => {
    console.warn('Local authentication persistence is unavailable.', error);
  });

export const RECENT_AUTH_WINDOW_MS = 5 * 60 * 1000;
const RECENT_AUTH_ACTIVITY_KEY = 'yfnedFleetRecentAuthActivity';

function getSessionStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('Recent authentication storage is unavailable.', error);
    return null;
  }
}

export function hasRecentAuthSession(now = Date.now()) {
  const storage = getSessionStorage();
  // If browser storage is blocked, fall back to Firebase's own authenticated
  // state so users are not trapped in a login loop.
  if (!storage) return true;

  try {
    const lastActivity = Number(storage.getItem(RECENT_AUTH_ACTIVITY_KEY));
    return Number.isFinite(lastActivity)
      && lastActivity > 0
      && now - lastActivity <= RECENT_AUTH_WINDOW_MS;
  } catch (error) {
    console.warn('Recent authentication activity could not be read.', error);
    return true;
  }
}

export function touchRecentAuthSession(now = Date.now()) {
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(RECENT_AUTH_ACTIVITY_KEY, String(now));
    } catch (error) {
      console.warn('Recent authentication activity could not be saved.', error);
    }
  }
}

export function clearRecentAuthSession() {
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(RECENT_AUTH_ACTIVITY_KEY);
    } catch (error) {
      console.warn('Recent authentication activity could not be cleared.', error);
    }
  }
}
