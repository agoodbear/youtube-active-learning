import { createContext, useContext, useEffect, useState } from "react";
import {
    onAuthStateChanged,
    signInWithPopup,
    signInWithEmailAndPassword,
    signOut,
    type User
} from "firebase/auth";
import { auth, googleProvider, initializationError } from "../lib/firebase";
import { isEmailAllowed } from "../lib/utils";

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signIn: () => Promise<void>;
    signInEmail: (email: string, pass: string) => Promise<void>;
    logout: () => Promise<void>;
    isAllowed: boolean;
    error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAllowed, setIsAllowed] = useState(false);
    const [error, setError] = useState<string | null>(initializationError);

    useEffect(() => {
        if (initializationError || !auth) {
            setLoading(false);
            setError(initializationError || "Firebase not initialized");
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setIsAllowed(isEmailAllowed(currentUser?.email));
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const signIn = async () => {
        if (!auth) throw new Error("Auth not initialized");
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (err: unknown) {
            console.error("Error signing in", err);
            throw err;
        }
    };

    const signInEmail = async (email: string, pass: string) => {
        if (!auth) throw new Error("Auth not initialized");
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (err: unknown) {
            console.error("Error signing in with Email", err);
            throw err;
        }
    };

    const logout = async () => {
        if (!auth) return;
        await signOut(auth);
    };

    return (
        <AuthContext.Provider value={{ user, loading, signIn, signInEmail, logout, isAllowed, error }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
