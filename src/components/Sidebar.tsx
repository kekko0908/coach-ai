import React from 'react';
import { Activity, MessageSquare, Calendar as CalendarIcon, User, Trophy, FlaskConical, LogOut, Dumbbell } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userEmail?: string | null;
  onSignOut?: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, userEmail, onSignOut }: SidebarProps) {
  const tabs = [
    { id: 'dashboard', label: 'Health Dashboard', icon: Activity },
    { id: 'chat', label: 'AI Coach', icon: MessageSquare },
    { id: 'coach-planner', label: 'Coach Planner', icon: Dumbbell },
    { id: 'calendar', label: 'Training Planner', icon: CalendarIcon },
    { id: 'records', label: 'Record Personali', icon: Trophy },
    { id: 'science', label: 'Science Library', icon: FlaskConical },
    { id: 'profile', label: 'Profilo & Obiettivi', icon: User },
  ];

  return (
    <>
      <aside className="hidden h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-900 lg:flex">
        <div className="p-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Activity className="text-emerald-400" />
            <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
              FitSync AI
            </span>
          </h1>
        </div>
        <nav className="flex-1 space-y-2 px-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'text-emerald-400' : ''}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-zinc-800 p-4">
          {userEmail ? (
            <div className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Account</div>
              <div className="mt-1 truncate text-sm text-zinc-300">{userEmail}</div>
            </div>
          ) : null}
          {onSignOut ? (
            <button
              onClick={onSignOut}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <LogOut className="h-4 w-4" />
              Esci
            </button>
          ) : null}
          <div className="text-center text-xs text-zinc-500">
            Powered by DeepSeek & React
          </div>
        </div>
      </aside>

      <div className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-5 w-5 shrink-0 text-emerald-400" />
            <div className="truncate text-sm font-semibold text-white">FitSync AI</div>
          </div>
          {onSignOut ? (
            <button
              onClick={onSignOut}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300"
            >
              <LogOut className="h-4 w-4" />
              Esci
            </button>
          ) : null}
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur lg:hidden">
        <div className="grid grid-cols-7 gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{tab.label.replace(' Dashboard', '').replace(' Personali', '').replace(' Library', '')}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
