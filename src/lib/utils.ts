import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Simple allowlist check
export const ALLOWED_EMAILS = [
    // Add your email here
    "tsaojianhsiung@gmail.com", // Example based on user path, likely need to confirm
    "agoodbear@gmail.com",
];

export function isEmailAllowed(email: string | null | undefined): boolean {
    if (!email) return false;
    // If allowlist is empty, maybe block all or allow all? blocking all by default for safety.
    if (ALLOWED_EMAILS.length === 0) return false;
    return ALLOWED_EMAILS.includes(email);
}
