import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'REDACTED',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'cielito-home-storage.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'cielito-home-storage',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'cielito-home-storage.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '444289473133',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:444289473133:web:5a8b6f3c2e1a9d4b7c6e5f',
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

// Persist auth state in browser storage
setPersistence(auth, browserLocalPersistence)
  .catch(err => console.error('Error setting auth persistence:', err))

export { auth }
export default app
