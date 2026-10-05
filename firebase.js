import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
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
