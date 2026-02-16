import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage } from "firebase/storage";

// Config from env or placeholders
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let functions: Functions | undefined;
let initializationError: string | null = null;

try {
    // Simple validation: Ensure apiKey is present
    if (!firebaseConfig.apiKey) {
        throw new Error("Firebase API Key is missing. Please configure in .env file.");
    }

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app);

    // Connect to Emulators in Development
    // Note: Only if you are running 'firebase emulators:start'
    if (import.meta.env.DEV && window.location.hostname === 'localhost') {
        // Uncomment lines below if you want to use local emulators for everything
        // connectAuthEmulator(auth, "http://localhost:9099");
        // connectFirestoreEmulator(db, 'localhost', 8080);

        // We definitely want to use Functions emulator if available
        connectFunctionsEmulator(functions, "localhost", 5001);
        console.log("Connected to Functions Emulator");
    }

} catch (error: unknown) {
    console.error("Firebase Initialization Failed:", error);
    initializationError = error instanceof Error ? error.message : "Unknown Firebase Error";
}

export const googleProvider = new GoogleAuthProvider();
export const storage = app ? getStorage(app) : undefined;
export { app, auth, db, functions, initializationError };
