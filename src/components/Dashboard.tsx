import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HealthData, UserProfile, Workout } from '../types';
import {
  Activity,
  Bot,
  Calendar as CalendarIcon,
  Flame,
  FolderUp,
  Footprints,
  Gauge,
  Heart,
  Loader2,
  Moon,
  Upload,
  Waves,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import { DEFAULT_HEART_RATE_ZONES } from '../utils/heartRateZones';
import { getAiConnectionHint } from '../utils/aiClient';
import { generatePlannerOutput } from '../utils/plannerEngine';
import { importHealthDataFromCsvFolder, importWorkoutsFromCsvFolder } from '../utils/healthCsvImport';
import { generateStructuredHealthReport } from '../utils/reportComposer';
import { getErrorMessage } from '../utils/errorMessage';
import { readLocalJson, writeLocalJson } from '../utils/storage';
import { hydrateProfileFromSupabase } from '../lib/supabase/profileRepository';
import { hydrateWorkoutsFromSupabase, saveWorkoutsToSupabase } from '../lib/supabase/workoutRepository';
import { saveHealthDataToSupabase } from '../lib/supabase/healthRepository';
import { isSupabaseConfigured } from '../lib/supabase';

interface DashboardProps {
  healthData: HealthData | null;
  setHealthData: (data: HealthData) => void;
  syncError?: string | null;
}

function formatAxisDate(value: string) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value);
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  }
  return value;
}

function average(points: { value: number }[]) {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point.value, 0) / points.length;
}

function sampleSeries<T>(data: T[], maxPoints: number) {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, index) => index % step === 0 || index === data.length - 1);
}

function formatTimestamp(value?: string) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function chartTooltipFormatter(value: number | string, name: string) {
  return [value, name];
}

const tooltipStyle = {
  backgroundColor: '#18181b',
  borderColor: '#27272a',
  borderRadius: '0.85rem',
  color: '#fff',
};

function BentoCard({ className, children, title, icon: Icon, action }: { className?: string, children: React.ReactNode, title?: string, icon?: React.ElementType, action?: React.ReactNode }) {
  return (
    <div className={`group relative overflow-hidden rounded-[2rem] border border-zinc-800/60 bg-zinc-900/40 p-6 hover:bg-zinc-900/60 hover:border-zinc-700/60 transition-all duration-300 ${className}`}>
      {(title || Icon) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {Icon && <div className="p-2 rounded-xl bg-zinc-800/50 text-zinc-400 group-hover:text-white group-hover:bg-zinc-800 transition-colors"><Icon className="w-4 h-4" /></div>}
            {title && <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">{title}</span>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  icon: Icon,
  children,
  className
}: {
  title: string;
  subtitle: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[2rem] border border-zinc-800/60 bg-zinc-900/40 p-6 hover:border-zinc-700/60 transition-colors ${className}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
        </div>
        {Icon && <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-400"><Icon className="w-5 h-5" /></div>}
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 text-sm text-zinc-500">
      {label}
    </div>
  );
}

export default function Dashboard({ healthData, setHealthData, syncError = null }: DashboardProps) {
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const csvFolderInputRef = useRef<HTMLInputElement>(null);
  const [aiRecap, setAiRecap] = useState<string | null>(null);
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [lastImportedWorkoutCount, setLastImportedWorkoutCount] = useState<number | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [dashboardSyncError, setDashboardSyncError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({
    name: 'Utente',
    weight: 75,
    heartRateMax: 190,
    heartRateZones: DEFAULT_HEART_RATE_ZONES,
    targetSteps: 10000,
    targetSleep: 8,
    trainingDays: 4,
    preferredSplit: 'Push / Pull / Legs',
    activeDays: [],
    weeklySchedule: {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
  });

  useEffect(() => {
    const folderInput = csvFolderInputRef.current;
    if (!folderInput) return;
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    let isMounted = true;

    const hydrateDashboardContext = async () => {
      try {
        const [{ profile: remoteProfile }, remoteWorkouts] = await Promise.all([
          hydrateProfileFromSupabase(),
          hydrateWorkoutsFromSupabase(),
        ]);

        if (!isMounted) {
          return;
        }

        if (remoteProfile) {
          setProfile(remoteProfile);
        }
        setWorkouts(remoteWorkouts);
        setDashboardSyncError(null);
      } catch (error) {
        console.error('Dashboard sync error:', error);
        setDashboardSyncError(error instanceof Error ? error.message : 'Sync dashboard non riuscita.');
      }
    };

    hydrateDashboardContext();

    return () => {
      isMounted = false;
    };
  }, []);

  const hasHrv = healthData ? healthData.meta?.hrvAvailable !== false : true;
  const avgSleep = healthData ? average(healthData.trends.sleep) : 0;
  const avgSteps = healthData ? Math.round(average(healthData.trends.steps)) : 0;
  const stepsProgress = healthData ? Math.min(100, Math.round((healthData.steps / profile.targetSteps) * 100)) : 0;
  const sleepProgress = healthData ? Math.min(100, Math.round((healthData.sleep.total / profile.targetSleep) * 100)) : 0;

  const avgBpm = healthData?.trends.bpm?.length ? Math.round(average(healthData.trends.bpm)) : 0;
  const caloriesUnit = healthData?.meta?.source === 'csv-folder' ? 'kcal' : 'KJ';

  const planner = healthData
    ? generatePlannerOutput({
      profile,
      workouts,
      healthData,
    })
    : null;

  // Readiness derivation
  const readinessScore = useMemo(() => planner?.readinessScore ? parseInt(String(planner.readinessScore).split('/')[0]) : 0, [planner]);

  const sleepTrendData = useMemo(() => healthData?.trends.sleep.slice(-14) ?? [], [healthData]);
  const stepsTrendData = useMemo(() => healthData?.trends.steps.slice(-14) ?? [], [healthData]);
  const bpmTrendData = useMemo(() => healthData?.trends.bpm?.slice(-14) ?? [], [healthData]);
  const sleepStagesData = useMemo(() => healthData?.details?.sleepStages ?? [], [healthData]);
  const heartRateSeriesData = useMemo(() => sampleSeries(healthData?.details?.heartRateSeries ?? [], 96), [healthData]);
  const stepsByHourData = useMemo(() => healthData?.details?.stepsByHour ?? [], [healthData]);

  const handleJsonUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const json = JSON.parse(loadEvent.target?.result as string) as HealthData;
        const nextData: HealthData = {
          ...json,
          meta: {
            source: 'json',
            importedAt: new Date().toISOString(),
            hrvAvailable: json.meta?.hrvAvailable ?? true,
            coveredDays: json.meta?.coveredDays ?? Math.max(json.trends.sleep.length, json.trends.steps.length),
            notes: json.meta?.notes ?? [],
          },
        };
        setHealthData(nextData);
        await saveHealthDataToSupabase(nextData);
        setDashboardSyncError(null);
      } catch (error) {
        alert('Errore nel parsing del file JSON o nel salvataggio su Supabase.');
        console.error(error);
        setDashboardSyncError(getErrorMessage(error, 'Import JSON non riuscito.'));
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleCsvFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsImportingCsv(true);
    try {
      const [importedData, importedWorkouts] = await Promise.all([
        importHealthDataFromCsvFolder(files),
        importWorkoutsFromCsvFolder(files),
      ]);
      setHealthData(importedData);
      await saveHealthDataToSupabase(importedData);
      setDashboardSyncError(null);

      if (importedWorkouts.length > 0) {
        const workoutMap = new Map(workouts.map((workout) => [workout.id, workout]));
        importedWorkouts.forEach((workout) => {
          workoutMap.set(workout.id, workout);
        });
        const mergedWorkouts = Array.from(workoutMap.values()).sort((left, right) => right.date.localeCompare(left.date));
        await saveWorkoutsToSupabase(mergedWorkouts);
        setWorkouts(mergedWorkouts);
      }

      setLastImportedWorkoutCount(importedWorkouts.length);
    } catch (error) {
      const message = getErrorMessage(error, 'Import CSV non riuscito.');
      alert(message);
      console.error(error);
      setDashboardSyncError(message);
    } finally {
      setIsImportingCsv(false);
      event.target.value = '';
    }
  };

  const loadSampleData = () => {
    const nextData: HealthData = {
      bpm: 62,
      sleep: { deep: 1.5, core: 4.2, rem: 1.8, total: 7.5, awake: 0.6, efficiency: 92 },
      steps: 12450,
      hrv: 55,
      calories: 2850,
      trends: {
        sleep: [
          { date: '01/03', value: 7.2 },
          { date: '02/03', value: 6.8 },
          { date: '03/03', value: 7.5 },
          { date: '04/03', value: 8.1 },
          { date: '05/03', value: 6.5 },
          { date: '06/03', value: 7.8 },
          { date: '07/03', value: 7.5 },
        ],
        steps: [
          { date: '01/03', value: 8500 },
          { date: '02/03', value: 10200 },
          { date: '03/03', value: 12450 },
          { date: '04/03', value: 9800 },
          { date: '05/03', value: 14200 },
          { date: '06/03', value: 15600 },
          { date: '07/03', value: 11000 },
        ],
        bpm: [
          { date: '01/03', value: 64 },
          { date: '02/03', value: 63 },
          { date: '03/03', value: 62 },
          { date: '04/03', value: 61 },
          { date: '05/03', value: 64 },
          { date: '06/03', value: 62 },
          { date: '07/03', value: 62 },
        ],
      },
      details: {
        latestDate: '2026-03-07',
        sleepStages: [
          { stage: 'deep', label: 'Profondo', minutes: 90, hours: 1.5 },
          { stage: 'core', label: 'Leggero', minutes: 252, hours: 4.2 },
          { stage: 'rem', label: 'REM', minutes: 108, hours: 1.8 },
          { stage: 'awake', label: 'Sveglio', minutes: 36, hours: 0.6 },
        ],
        heartRateSeries: [
          { time: '00:00', value: 64 },
          { time: '04:00', value: 57 },
          { time: '08:00', value: 61 },
          { time: '12:00', value: 72 },
          { time: '16:00', value: 84 },
          { time: '20:00', value: 74 },
          { time: '23:00', value: 66 },
        ],
        stepsByHour: [
          { hour: '08:00', value: 600 },
          { hour: '10:00', value: 950 },
          { hour: '12:00', value: 1200 },
          { hour: '14:00', value: 1450 },
          { hour: '16:00', value: 1750 },
          { hour: '18:00', value: 1600 },
          { hour: '20:00', value: 1100 },
        ],
      },
      meta: {
        source: 'json',
        importedAt: new Date().toISOString(),
        hrvAvailable: true,
        coveredDays: 7,
      },
    };

    setHealthData(nextData);
    void saveHealthDataToSupabase(nextData).then(() => {
      setDashboardSyncError(null);
    }).catch((error) => {
      console.error(error);
      setDashboardSyncError(getErrorMessage(error, 'Salvataggio sample data non riuscito.'));
    });
  };

  const generateAiRecap = async () => {
    if (!healthData) return;
    setIsGeneratingRecap(true);
    try {
      const hrvText = healthData.meta?.hrvAvailable === false ? 'HRV non disponibile' : `${healthData.hrv}ms`;
      const context = `
Dati salute: passi medi ${avgSteps}, sonno medio ${avgSleep.toFixed(1)}h, ${hrvText}, BPM base ${healthData.bpm}, calorie ${healthData.calories} ${caloriesUnit}.
Profilo: ${profile.name}, obiettivo passi ${profile.targetSteps}, obiettivo sonno ${profile.targetSleep}h.
Allenamenti salvati: ${workouts.length}.
      `;

      const content = await generateStructuredHealthReport({
        userPrompt: `Genera il mio riepilogo settimanale basato su questi dati:\n${context}`,
        healthData,
        windowDays: 7,
        knowledgeQuery: `${context} riepilogo settimanale recupero allenamento passi sonno battito`,
        ragQuery: `${context} riepilogo settimanale recupero allenamento passi sonno battito`,
      });
      setAiRecap(content);
      setIsRecapExpanded(true);
    } catch (error) {
      console.error(error);
      setAiRecap(`Analisi non disponibile. Verifica ${getAiConnectionHint()}.`);
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  // Render helper for import status
  const ImportStatusBadge = () => (
    <div className="flex flex-wrap items-center gap-3 text-xs md:text-sm text-zinc-500">
      <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
        <div className={`h-2 w-2 rounded-full ${healthData?.meta?.source === 'csv-folder' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-sky-500'}`} />
        <span className="font-medium">{healthData?.meta?.source === 'csv-folder' ? 'CSV Data' : 'JSON Data'}</span>
      </div>
      {healthData?.details?.latestDate && (
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="w-3.5 h-3.5" /> {formatTimestamp(healthData.details.latestDate)}
        </span>
      )}
    </div>
  );

  // Render helper for import actions
  const ImportActions = () => (
    <div className="flex items-center gap-2">
      <button
        onClick={() => csvFolderInputRef.current?.click()}
        disabled={isImportingCsv}
        className="group relative flex items-center justify-center rounded-xl bg-zinc-800/50 p-2.5 text-zinc-400 transition-all hover:bg-emerald-500/10 hover:text-emerald-400 border border-transparent hover:border-emerald-500/20"
        title="Importa CSV"
      >
        {isImportingCsv ? <Loader2 className="h-5 w-5 animate-spin" /> : <FolderUp className="h-5 w-5" />}
      </button>
      <button onClick={() => jsonInputRef.current?.click()} className="group flex items-center justify-center rounded-xl bg-zinc-800/50 p-2.5 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white border border-transparent hover:border-zinc-700" title="Carica JSON">
        <Upload className="h-5 w-5" />
      </button>
    </div>
  );

  if (!healthData) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-950 p-4 text-zinc-400 sm:p-6 lg:p-8">
        <div className="max-w-4xl rounded-[2rem] border border-zinc-800 bg-zinc-900 p-5 shadow-[0_40px_120px_rgba(0,0,0,0.38)] sm:p-8">
          <div className="mb-8 flex items-center gap-4">
            <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-300">
              <Waves className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white">Porta dentro i tuoi dati reali</h2>
              <p className="mt-2 max-w-2xl text-zinc-400">
                Per ora la dashboard usa i tuoi export CSV per sonno, BPM e passi. Le mappe corsa richiedono GPX o TCX: senza tracciato non le creo artificialmente.
              </p>
            </div>
          </div>
          {syncError || dashboardSyncError ? (
            <div className="mb-6 rounded-3xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
              {syncError || dashboardSyncError}
            </div>
          ) : isSupabaseConfigured ? (
            <div className="mb-6 rounded-3xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
              Supabase non contiene ancora dati `health_daily` per questo account.
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="mb-3 text-sm uppercase tracking-[0.22em] text-zinc-500">Sleep</div>
              <div className="text-lg font-semibold text-white">SLEEP + SLEEP_MINUTE</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">Trend sonno, fasi, efficienza e ultima notte.</p>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="mb-3 text-sm uppercase tracking-[0.22em] text-zinc-500">Heart Rate</div>
              <div className="text-lg font-semibold text-white">HEARTRATE_AUTO</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">Trend BPM giornaliero e serie intraday dell ultimo giorno.</p>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="mb-3 text-sm uppercase tracking-[0.22em] text-zinc-500">Steps</div>
              <div className="text-lg font-semibold text-white">ACTIVITY + ACTIVITY_MINUTE</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">Passi giornalieri e distribuzione oraria reale.</p>
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
            <button
              onClick={() => csvFolderInputRef.current?.click()}
              className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
            >
              {isImportingCsv ? <Loader2 className="h-5 w-5 animate-spin" /> : <FolderUp className="h-5 w-5" />}
              Importa cartella o file CSV
            </button>
            <button
              onClick={() => jsonInputRef.current?.click()}
              className="flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 px-6 py-3 font-semibold text-white transition-colors hover:bg-zinc-700"
            >
              <Upload className="h-5 w-5" />
              Carica JSON
            </button>
            <button
              onClick={loadSampleData}
              className="rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-3 font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              Usa dati di esempio
            </button>
          </div>
          <input type="file" accept=".json" ref={jsonInputRef} className="hidden" onChange={handleJsonUpload} />
          <input type="file" accept=".csv" multiple ref={csvFolderInputRef} className="hidden" onChange={handleCsvFolderUpload} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-6 lg:p-10">
      <div className="mx-auto max-w-[1600px] space-y-8">

        {/* Header Section */}
        <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Panoramica</h1>
            <p className="mt-1 text-zinc-400">Benvenuto. Ecco il punto della situazione su recupero e performance.</p>
          </div>
          <div className="flex items-center gap-4">
            <ImportStatusBadge />
            <div className="h-8 w-px bg-zinc-800 hidden md:block" />
            <ImportActions />
            <input type="file" accept=".json" ref={jsonInputRef} className="hidden" onChange={handleJsonUpload} />
            <input type="file" accept=".csv" multiple ref={csvFolderInputRef} className="hidden" onChange={handleCsvFolderUpload} />
          </div>
        </header>

        {syncError || dashboardSyncError ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {syncError || dashboardSyncError}
          </div>
        ) : null}

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 auto-rows-fr">

          {/* 1. Main Feature: Readiness / Status */}
          <div className="col-span-1 md:col-span-2 row-span-1 md:row-span-2 bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-[2.5rem] p-8 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

            <div className="relative z-10 flex flex-col h-full justify-between gap-8">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-emerald-500 font-bold text-sm uppercase tracking-widest">
                    <Gauge className="w-4 h-4" />
                    <span>Readiness</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-7xl font-bold text-white tracking-tighter">{readinessScore}</span>
                    <span className="text-2xl text-zinc-500 font-medium">/100</span>
                  </div>
                </div>
                <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/10">
                  <Activity className="w-8 h-8 text-emerald-500" />
                </div>
              </div>

              <div className="space-y-6">
                <p className="text-zinc-400 text-lg leading-relaxed max-w-md">
                  {readinessScore > 80
                    ? "Ottima condizione. HRV sopra la media e sonno adeguato. Puoi spingere con un workout intenso."
                    : readinessScore > 50
                      ? "Condizione stabile. Mantieni il volume di allenamento previsto o considera una sessione tecnica."
                      : "Priorità al recupero. Il corpo segnala fatica accumulata."}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-950/50 p-4 rounded-2xl border border-zinc-800/50 backdrop-blur-sm">
                    <div className="text-zinc-500 text-xs font-bold uppercase mb-1">HRV (RMSSD)</div>
                    <div className="text-xl font-semibold text-white">{hasHrv ? `${healthData.hrv} ms` : 'ND'}</div>
                  </div>
                  <div className="bg-zinc-950/50 p-4 rounded-2xl border border-zinc-800/50 backdrop-blur-sm">
                    <div className="text-zinc-500 text-xs font-bold uppercase mb-1">BPM A riposo</div>
                    <div className="text-xl font-semibold text-white">{healthData.bpm} bpm</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. AI Insight / Recap Card */}
          <div className="col-span-1 md:col-span-2 bg-zinc-900/40 border border-zinc-800/60 rounded-[2rem] p-6 hover:border-zinc-700/60 transition-colors flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
                  <Bot className="w-5 h-5" />
                </div>
                <span className="font-bold text-white">Analisi AI</span>
              </div>
              <button
                onClick={generateAiRecap}
                disabled={isGeneratingRecap}
                className="text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                {isGeneratingRecap ? 'Analisi...' : 'Aggiorna'}
              </button>
            </div>

            <div className="flex-1 bg-zinc-950/30 rounded-2xl p-4 border border-zinc-800/30 overflow-y-auto max-h-60 custom-scrollbar">
              {aiRecap ? (
                <div className="prose prose-invert prose-sm max-w-none text-zinc-300">
                  <ReactMarkdown>{aiRecap}</ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 gap-2 min-h-[120px]">
                  <Waves className="w-8 h-8 opacity-20" />
                  <p className="text-sm max-w-[200px]">Genera un report intelligente basato sui tuoi ultimi dati di sonno e attività.</p>
                </div>
              )}
            </div>
          </div>

          {/* 3. Steps Card */}
          <BentoCard title="Passi" icon={Footprints}>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white">{healthData.steps.toLocaleString()}</span>
              </div>
              <div className="mt-4 w-full bg-zinc-800/50 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${stepsProgress}%` }}></div>
              </div>
              <p className="text-xs text-zinc-500 mt-2 font-medium">Target: {profile.targetSteps.toLocaleString()}</p>
            </div>
          </BentoCard>

          {/* 4. Sleep Card */}
          <BentoCard title="Sonno" icon={Moon}>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white">{healthData.sleep.total}h</span>
                <span className="text-zinc-500 text-sm">/ {profile.targetSleep}h</span>
              </div>
              <div className="mt-4 w-full bg-zinc-800/50 h-2 rounded-full overflow-hidden">
                <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${sleepProgress}%` }}></div>
              </div>
              <p className="text-xs text-zinc-500 mt-2 font-medium">Efficienza {healthData.sleep.efficiency}%</p>
            </div>
          </BentoCard>

        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 pb-10">
          <ChartPanel title="Andamento Sonno" subtitle="Trend ultime 2 settimane" icon={Moon} className="col-span-1">
            {sleepTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sleepTrendData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={formatAxisDate} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#818cf8' }} formatter={chartTooltipFormatter} />
                  <Line name="Ore sonno" type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={3} dot={{ r: 3, fill: '#18181b', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Nessun trend sonno disponibile" />}
          </ChartPanel>

          <ChartPanel title="Fasi Ultima Notte" subtitle="Breakdown dell'ultimo sonno" icon={Moon}>
            {sleepStagesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sleepStagesData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#a5b4fc' }} formatter={chartTooltipFormatter} />
                  <Bar name="Ore" dataKey="hours" fill="#818cf8" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Fasi sonno non disponibili" />}
          </ChartPanel>

          <ChartPanel title="Trend BPM" subtitle="Media giornaliera" icon={Heart}>
            {bpmTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={bpmTrendData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={formatAxisDate} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fda4af' }} formatter={chartTooltipFormatter} />
                  <Line name="BPM" type="monotone" dataKey="value" stroke="#fb7185" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Trend BPM non disponibile" />}
          </ChartPanel>

          <ChartPanel title="BPM Intraday" subtitle="Variazione nelle ultime 24h" icon={Heart}>
            {heartRateSeriesData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={heartRateSeriesData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="time" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fda4af' }} formatter={chartTooltipFormatter} />
                  <Line name="BPM" type="monotone" dataKey="value" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Serie intraday BPM non disponibile" />}
          </ChartPanel>

          <ChartPanel title="Andamento Passi" subtitle="Attività giornaliera" icon={Footprints}>
            {stepsTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stepsTrendData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} tickFormatter={formatAxisDate} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#6ee7b7' }} cursor={{ fill: '#27272a' }} formatter={chartTooltipFormatter} />
                  <Bar name="Passi" dataKey="value" fill="#34d399" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Trend passi non disponibile" />}
          </ChartPanel>

          <ChartPanel title="Passi per Ora" subtitle="Distribuzione oraria (Oggi)" icon={Footprints}>
            {stepsByHourData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stepsByHourData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#6ee7b7' }} cursor={{ fill: '#27272a' }} formatter={chartTooltipFormatter} />
                  <Bar name="Passi" dataKey="value" fill="#10b981" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Distribuzione oraria passi non disponibile" />}
          </ChartPanel>
        </div>
      </div>
    </div>
  );
}
