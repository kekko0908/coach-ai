import React, { useState } from 'react';
import { Activity, Loader2, LogIn, UserPlus } from 'lucide-react';
import { signInWithPassword, signUpWithPassword } from '../lib/supabase/auth';
import { getErrorMessage } from '../utils/errorMessage';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submitLabel = mode === 'login' ? 'Accedi' : 'Crea account';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      if (mode === 'login') {
        await signInWithPassword(email, password);
      } else {
        await signUpWithPassword(email, password);
        setMessage('Account creato. Se hai attivato la conferma email, verifica la casella di posta e poi accedi.');
      }
    } catch (error) {
      const nextMessage = getErrorMessage(error, 'Operazione auth non riuscita.');
      setMessage(nextMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 p-4 sm:p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-zinc-800 bg-zinc-900 p-5 shadow-[0_40px_120px_rgba(0,0,0,0.36)] sm:p-8">
        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300">
            <Activity className="h-4 w-4" />
            FitSync AI
          </div>
          <h1 className="text-3xl font-bold text-white">
            {mode === 'login' ? 'Accedi a FitSync' : 'Crea il tuo account'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Supabase gestisce la persistenza dei tuoi dati. Dopo il login, profilo, allenamenti e health data restano sincronizzati.
          </p>
        </div>

        <div className="mb-6 inline-flex rounded-2xl border border-zinc-800 bg-zinc-950 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'login' ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Accedi
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'signup' ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Registrati
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              placeholder="tuo@email.com"
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              placeholder="Minimo 6 caratteri"
              minLength={6}
              required
            />
          </div>

          {message ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === 'login' ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
