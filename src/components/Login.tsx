import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Loader2 } from 'lucide-react';

export function Login() {
    const { signIn, signInEmail } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleEmailLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await signInEmail(email, password);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to sign in. Check credentials.";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            await signIn();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to sign in with Google.";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-zinc-950 text-white relative overflow-hidden">
            {/* Background gradients */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[100px]" />
                <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[100px]" />
            </div>

            <div className="relative z-10 p-8 md:p-12 rounded-2xl bg-zinc-900/50 backdrop-blur-xl border border-white/10 shadow-2xl max-w-md w-full text-center">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-2">
                    Knowledge Stream
                </h1>
                <p className="text-zinc-400 mb-8 text-lg">
                    Secure Personal Video Learning
                </p>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-200 text-sm md:text-xs">
                        {error}
                    </div>
                )}

                <form onSubmit={handleEmailLogin} className="space-y-4 mb-6">
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-black/20 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                            required
                        />
                    </div>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-black/20 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 px-4 rounded-lg bg-white text-black font-medium hover:bg-zinc-200 transition-all shadow-lg hover:shadow-white/10 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In with Email"}
                    </button>
                </form>

                <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-zinc-900 px-2 text-zinc-500">Or continue with</span></div>
                </div>

                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-zinc-800 text-white font-medium hover:bg-zinc-700 transition-all border border-white/10 flex items-center justify-center gap-2"
                >
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                    <span>Google</span>
                </button>

                <p className="mt-8 text-xs text-zinc-600">
                    Access is restricted to authorized users only.
                </p>
            </div>
        </div>
    );
}
