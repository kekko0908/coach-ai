import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Sidebar from './components/Sidebar';
import { HealthData } from './types';
import { hydrateProfileFromSupabase } from './lib/supabase/profileRepository';
import { hydrateWorkoutsFromSupabase } from './lib/supabase/workoutRepository';
import { hydrateHealthDataFromSupabase } from './lib/supabase/healthRepository';
import { hydrateRecordsFromSupabase } from './lib/supabase/recordsRepository';
import { getCurrentSession, signOut, subscribeToAuthChanges } from './lib/supabase/auth';
import { isSupabaseConfigured } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import { getErrorMessage } from './utils/errorMessage';

const Dashboard = lazy(() => import('./components/Dashboard'));
const Chat = lazy(() => import('./components/Chat'));
const CoachPlanner = lazy(() => import('./components/CoachPlanner'));
const Calendar = lazy(() => import('./components/Calendar'));
const Profile = lazy(() => import('./components/Profile'));
const Records = lazy(() => import('./components/Records'));
const Science = lazy(() => import('./components/Science'));

function TabFallback() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-950">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 px-6 py-5 text-sm text-zinc-400 shadow-[0_20px_80px_rgba(0,0,0,0.25)]">
        Caricamento vista...
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [initialSyncError, setInitialSyncError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const bootstrapSession = async () => {
      if (!isSupabaseConfigured) {
        if (isMounted) {
          setIsAuthReady(true);
        }
        return;
      }

      try {
        const nextSession = await getCurrentSession();
        if (!isMounted) {
          return;
        }
        setSession(nextSession);
      } catch (error) {
        console.error('Supabase session bootstrap error:', error);
      } finally {
        if (isMounted) {
          setIsAuthReady(true);
        }
      }
    };

    bootstrapSession();
    const unsubscribe = subscribeToAuthChanges((nextSession) => {
      setSession(nextSession);
      setIsAuthReady(true);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured && !session) {
      return;
    }

    let isMounted = true;

    const hydrateSupabaseMirrors = async () => {
      try {
        const [, , remoteHealthData] = await Promise.all([
          hydrateProfileFromSupabase(),
          hydrateWorkoutsFromSupabase(),
          hydrateHealthDataFromSupabase(),
          hydrateRecordsFromSupabase(),
        ]);

        if (!isMounted) {
          return;
        }

        if (remoteHealthData) {
          setHealthData(remoteHealthData);
        }
        setInitialSyncError(null);
      } catch (error) {
        console.error('Initial Supabase hydration error:', error);
        setInitialSyncError(getErrorMessage(error, 'Sync iniziale con Supabase non riuscita.'));
      }
    };

    hydrateSupabaseMirrors();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Supabase sign out error:', error);
    }
  };

  const activeView = useMemo(() => {
    if (activeTab === 'dashboard') {
      return <Dashboard healthData={healthData} setHealthData={setHealthData} syncError={initialSyncError} />;
    }

    if (activeTab === 'chat') {
      return <Chat healthData={healthData} onNavigateTab={setActiveTab} />;
    }

    if (activeTab === 'coach-planner') {
      return <CoachPlanner healthData={healthData} />;
    }

    if (activeTab === 'calendar') {
      return <Calendar />;
    }

    if (activeTab === 'records') {
      return <Records />;
    }

    if (activeTab === 'profile') {
      return <Profile />;
    }

    if (activeTab === 'science') {
      return <Science />;
    }

    return null;
  }, [activeTab, healthData]);

  if (!isAuthReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Caricamento sessione...
      </div>
    );
  }

  if (isSupabaseConfigured && !session) {
    return <AuthScreen />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 font-sans text-zinc-50 lg:flex-row">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userEmail={session?.user.email ?? null}
        onSignOut={isSupabaseConfigured ? handleSignOut : undefined}
      />
      
      <main className="relative flex flex-1 flex-col overflow-hidden pb-24 lg:pb-0">
        <Suspense fallback={<TabFallback />}>
          {activeView}
        </Suspense>
      </main>
    </div>
  );
}
