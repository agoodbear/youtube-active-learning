import { Login } from './components/Login';
import { AppLayout } from './layouts/AppLayout';
import { useAuth } from './contexts/AuthContext';
import { Loader2 } from 'lucide-react';

function App() {
  const { user, loading, isAllowed, error } = useAuth();

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-8 text-center">
        <div className="max-w-md bg-red-900/20 border border-red-500/50 p-6 rounded-xl">
          <h1 className="text-2xl font-bold mb-4 text-red-500">Configuration Error</h1>
          <p className="text-zinc-300 mb-4">{error}</p>
          <p className="text-sm text-zinc-500 mb-6">
            You need to configure your Firebase keys. Open <code className="text-yellow-500">src/lib/firebase.ts</code> and add your config.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!user) return <Login />;

  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white p-4 text-center">
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-zinc-400 mb-6">Your email ({user.email}) is not on the allowed list.</p>
        <button
          onClick={() => import('./lib/firebase').then(m => m.auth?.signOut())}
          className="px-4 py-2 bg-zinc-800 rounded hover:bg-zinc-700"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return <AppLayout />;
}

export default App;
