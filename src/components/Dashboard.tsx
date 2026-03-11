import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HealthData, UserProfile, Workout } from '../types';
import {
  Activity,
  Bot,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Flame,
  FolderUp,
  Footprints,
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
import { generateAiPlannerPlan, generatePlannerOutput } from '../utils/plannerEngine';
import { importHealthDataFromCsvFolder, importWorkoutsFromCsvFolder } from '../utils/healthCsvImport';
import { generateStructuredHealthReport } from '../utils/reportComposer';
import { getErrorMessage } from '../utils/errorMessage';
import { readLocalJson, writeLocalJson } from '../utils/storage';
import { hydrateProfileFromSupabase } from '../lib/supabase/profileRepository';
import { hydrateWorkoutsFromSupabase, saveWorkoutsToSupabase } from '../lib/supabase/workoutRepository';
import { saveHealthDataToSupabase } from '../lib/supabase/healthRepository';
import { isSupabaseConfigured } from '../lib/supabase';
import { PlannerAiPlan } from '../types/planner';

interface DashboardProps {
  healthData: HealthData | null;
  setHealthData: (data: HealthData) => void;
  syncError?: string | null;
}

const AI_PLANNER_STORAGE_KEY = 'fitsync_dashboard_ai_planner_v1';

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

function SummaryCard({
  title,
  value,
  unit,
  helper,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  unit: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <div className={`absolute -right-5 -top-5 h-24 w-24 rounded-full opacity-5 ${tone.replace('text-', 'bg-')}`} />
      <div className="mb-4 flex items-center gap-3">
        <div className={`rounded-2xl border border-zinc-800 bg-zinc-950 p-2.5 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="font-medium text-zinc-400">{title}</div>
      </div>
      <div className="flex items-end gap-2">
        <div className="text-4xl font-bold tracking-tight text-white">{value}</div>
        <div className="mb-1 text-zinc-500">{unit}</div>
      </div>
      <div className="mt-3 text-xs leading-relaxed text-zinc-500">{helper}</div>
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-[0_22px_80px_rgba(0,0,0,0.24)]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">{accent}</div>
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

function buildAiPlannerCacheContextKey(
  healthData: HealthData | null,
  profile: UserProfile,
  workouts: Workout[],
) {
  const latestHealthDate = healthData?.details?.latestDate || 'no-health';
  const latestWorkoutDate = workouts[0]?.date || 'no-workouts';
  return [
    latestHealthDate,
    profile.preferredSplit,
    profile.trainingDays,
    workouts.length,
    latestWorkoutDate,
  ].join('|');
}

export default function Dashboard({ healthData, setHealthData, syncError = null }: DashboardProps) {
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const csvFolderInputRef = useRef<HTMLInputElement>(null);
  const [aiRecap, setAiRecap] = useState<string | null>(null);
  const [isRecapExpanded, setIsRecapExpanded] = useState(true);
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
  const [isGeneratingAiPlanner, setIsGeneratingAiPlanner] = useState(false);
  const [aiPlanner, setAiPlanner] = useState<PlannerAiPlan | null>(null);
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
  const avgBpm = healthData?.trends.bpm?.length ? Math.round(average(healthData.trends.bpm)) : 0;
  const caloriesUnit = healthData?.meta?.source === 'csv-folder' ? 'kcal' : 'KJ';

  const planner = healthData
    ? generatePlannerOutput({
        profile,
        workouts,
        healthData,
      })
    : null;

  const aiPlannerCacheContextKey = useMemo(
    () => buildAiPlannerCacheContextKey(healthData, profile, workouts),
    [healthData, profile, workouts],
  );

  useEffect(() => {
    const cached = readLocalJson<{
      contextKey: string;
      plan: PlannerAiPlan | null;
    } | null>(AI_PLANNER_STORAGE_KEY, null);

    if (cached?.plan && cached.contextKey === aiPlannerCacheContextKey) {
      setAiPlanner(cached.plan);
      return;
    }

    setAiPlanner(null);
  }, [aiPlannerCacheContextKey]);

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

  const generateAiWeeklyPlanner = async () => {
    if (!healthData) {
      return;
    }

    setIsGeneratingAiPlanner(true);
    try {
      const plan = await generateAiPlannerPlan({
        profile,
        workouts,
        healthData,
      });
      setAiPlanner(plan);
      writeLocalJson(AI_PLANNER_STORAGE_KEY, {
        contextKey: aiPlannerCacheContextKey,
        plan,
      });
      setDashboardSyncError(null);
    } catch (error) {
      console.error(error);
      setDashboardSyncError(getErrorMessage(error, `Generazione piano AI non riuscita. Verifica ${getAiConnectionHint()}.`));
    } finally {
      setIsGeneratingAiPlanner(false);
    }
  };

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
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs uppercase tracking-[0.24em] text-zinc-500">
              <span className={`h-2 w-2 rounded-full ${healthData.meta?.source === 'csv-folder' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
              {healthData.meta?.source === 'csv-folder' ? 'CSV real data' : 'JSON import'}
            </div>
            <h1 className="text-3xl font-bold text-white">Dashboard Salute</h1>
            <p className="mt-2 max-w-3xl text-zinc-400">
              Sonno, BPM e passi arrivano dal tuo export reale. Per gli allenamenti di corsa la mappa entra solo quando hai GPX o TCX, non da questi CSV riepilogativi.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              onClick={() => csvFolderInputRef.current?.click()}
              disabled={isImportingCsv}
              className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
            >
              {isImportingCsv ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderUp className="h-4 w-4" />}
              Importa cartella o file CSV
            </button>
            <button
              onClick={() => jsonInputRef.current?.click()}
              className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 font-medium text-white transition-colors hover:bg-zinc-800"
            >
              <Upload className="h-4 w-4" />
              Carica JSON
            </button>
            <input type="file" accept=".json" ref={jsonInputRef} className="hidden" onChange={handleJsonUpload} />
            <input type="file" accept=".csv" multiple ref={csvFolderInputRef} className="hidden" onChange={handleCsvFolderUpload} />
          </div>
        </div>
        {syncError || dashboardSyncError ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {syncError || dashboardSyncError}
          </div>
        ) : null}

        <div className="grid items-start gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="self-start rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.28)]">
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Ultimo dato</div>
                <div className="mt-1 text-lg font-semibold text-white">{healthData.details?.latestDate || '--'}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Copertura</div>
                <div className="mt-1 text-lg font-semibold text-white">{healthData.meta?.coveredDays ?? '--'} giorni</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">HRV</div>
                <div className="mt-1 text-lg font-semibold text-white">{hasHrv ? `${healthData.hrv} ms` : 'non disponibile'}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Import</div>
                <div className="mt-1 text-lg font-semibold text-white">{formatTimestamp(healthData.meta?.importedAt)}</div>
              </div>
            </div>
            {healthData.meta?.notes?.length ? (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {healthData.meta.notes[0]}
              </div>
            ) : null}
            {lastImportedWorkoutCount !== null ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Importati o aggiornati {lastImportedWorkoutCount} allenamenti dal file SPORT. Entrano subito in calendario, planner e contesto AI anche senza mappe.
              </div>
            ) : null}
          </div>

          <div className="self-start rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400">
                <CalendarIcon className="h-5 w-5" />
                <span className="font-semibold">Recap Settimanale</span>
              </div>
              <div className="flex items-center gap-2">
                {aiRecap ? (
                  <button
                    onClick={() => setIsRecapExpanded((current) => !current)}
                    className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    {isRecapExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {isRecapExpanded ? 'Chiudi' : 'Apri'}
                  </button>
                ) : null}
                <button
                  onClick={generateAiRecap}
                  disabled={isGeneratingRecap}
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {isGeneratingRecap ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  {isGeneratingRecap ? 'Generazione...' : 'Genera AI'}
                </button>
              </div>
            </div>
            {aiRecap ? (
              isRecapExpanded ? (
                <div className="max-h-[34rem] overflow-y-auto pr-2">
                  <div className="prose prose-invert max-w-none text-sm prose-p:mb-2 prose-ul:my-2 prose-li:my-0">
                    <ReactMarkdown>{aiRecap}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-500">
                  Recap AI compattato. Premi <span className="font-medium text-zinc-300">Apri</span> per rivederlo.
                </div>
              )
            ) : (
              <p className="text-sm leading-relaxed text-zinc-500">
                Usa il recap AI per leggere andamento sonno, passi, battito e impatto sulla settimana.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard title="BPM Base" value={healthData.bpm} unit="BPM" helper={healthData.trends.bpm?.length ? `Media periodo ${avgBpm} BPM` : 'Serie intraday disponibile'} icon={Heart} tone="text-rose-500" />
          <SummaryCard title="Sonno" value={healthData.sleep.total} unit="ore" helper={`Ultima notte. Efficienza ${healthData.sleep.efficiency ?? '--'}%`} icon={Moon} tone="text-indigo-400" />
          <SummaryCard title="Passi" value={healthData.steps.toLocaleString()} unit="passi" helper={`Media periodo ${avgSteps.toLocaleString()} passi`} icon={Footprints} tone="text-emerald-400" />
          <SummaryCard title="HRV" value={hasHrv ? healthData.hrv : 'ND'} unit={hasHrv ? 'ms' : ''} helper={hasHrv ? 'Usata nel readiness' : 'Readiness lite attivo'} icon={Activity} tone="text-amber-400" />
          <SummaryCard title="Calorie" value={healthData.calories.toLocaleString()} unit={caloriesUnit} helper="Ultimo giorno disponibile" icon={Flame} tone="text-orange-500" />
        </div>

        {false ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-400">
                  <CalendarIcon className="h-5 w-5" />
                  Planner Engine
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white">{planner.headline}</h2>
                <p className="mt-2 max-w-3xl text-sm text-zinc-500">
                  Il planner base calcola readiness, recupero e distribuzione della settimana. Il piano AI sotto lo trasforma in una scheda operativa con esercizi, serie e ripetizioni.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-right">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Readiness</div>
                  <div className="text-3xl font-bold text-white">{planner.readinessScore}</div>
                </div>
                <button
                  onClick={generateAiWeeklyPlanner}
                  disabled={isGeneratingAiPlanner}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {isGeneratingAiPlanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dumbbell className="h-4 w-4" />}
                  {isGeneratingAiPlanner ? 'Generazione piano...' : aiPlanner ? 'Rigenera piano AI' : 'Genera piano AI'}
                </button>
              </div>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="mb-4 font-bold text-white">Avvisi</h3>
              <div className="space-y-3">
                {planner.insights.map((insight) => (
                  <div key={insight.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-semibold text-white">{insight.title}</div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{insight.priority}</span>
                    </div>
                    <div className="text-sm text-zinc-300">{insight.detail}</div>
                  </div>
                ))}
              </div>
            </div>
              <div className="hidden rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <h3 className="mb-4 font-bold text-white">Prossimi 7 giorni</h3>
                <div className="space-y-3">
                  {planner.nextWeek.map((day) => (
                    <div key={day.date} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <div className="font-semibold text-white">{day.dayLabel} · {day.focus}</div>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{day.type}</span>
                      </div>
                      <div className="text-sm text-zinc-300">{day.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            <div className="mt-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-white">Piano settimanale AI</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Scheda settimanale operativa con focus del giorno, esercizi, serie e ripetizioni.
                  </p>
                </div>
                {aiPlanner ? (
                  <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                    Generato
                  </div>
                ) : null}
              </div>

              {aiPlanner ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                    {aiPlanner.overview}
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {aiPlanner.days.map((day) => (
                      <div key={day.date} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-white">{day.dayLabel} · {day.focus}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{day.date}</div>
                          </div>
                          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                            {day.type}
                          </span>
                        </div>
                        <p className="mb-4 text-sm text-zinc-300">{day.summary}</p>
                        {day.exercises.length > 0 ? (
                          <div className="space-y-2">
                            {day.exercises.map((exercise, index) => (
                              <div key={`${day.date}-${exercise.name}-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="font-medium text-white">{exercise.name}</div>
                                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                                    {exercise.sets} x {exercise.reps}
                                  </div>
                                </div>
                                {exercise.notes ? (
                                  <div className="mt-2 text-sm text-zinc-400">{exercise.notes}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-500">
                            Nessun esercizio specifico: usa il giorno per recupero, mobilita o riposo.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/60 px-4 py-5 text-sm text-zinc-500">
                  Genera il piano AI per trasformare il planner in una scheda settimanale reale, giorno per giorno.
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartPanel title="Andamento Sonno" subtitle="Ultime notti importate dal file SLEEP" accent={<Moon className="h-5 w-5 text-indigo-300" />}>
            {sleepTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sleepTrendData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#818cf8' }} formatter={chartTooltipFormatter} />
                  <Line name="Ore sonno" type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={3} dot={{ r: 3, fill: '#18181b', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Nessun trend sonno disponibile" />}
          </ChartPanel>

          <ChartPanel title="Fasi Ultima Notte" subtitle="Breakdown dell ultimo record sonno" accent={<Moon className="h-5 w-5 text-indigo-300" />}>
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

          <ChartPanel title="Trend BPM" subtitle="Media giornaliera dal file HEARTRATE_AUTO" accent={<Heart className="h-5 w-5 text-rose-300" />}>
            {bpmTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={bpmTrendData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#fda4af' }} formatter={chartTooltipFormatter} />
                  <Line name="BPM" type="monotone" dataKey="value" stroke="#fb7185" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Trend BPM non disponibile" />}
          </ChartPanel>

          <ChartPanel title="BPM Intraday" subtitle="Ultimo giorno disponibile, campioni automatici" accent={<Heart className="h-5 w-5 text-rose-300" />}>
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

          <ChartPanel title="Andamento Passi" subtitle="Ultimi giorni dal file ACTIVITY" accent={<Footprints className="h-5 w-5 text-emerald-300" />}>
            {stepsTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stepsTrendData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#71717a" tick={{ fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#6ee7b7' }} cursor={{ fill: '#27272a' }} formatter={chartTooltipFormatter} />
                  <Bar name="Passi" dataKey="value" fill="#34d399" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChartState label="Trend passi non disponibile" />}
          </ChartPanel>

          <ChartPanel title="Passi per Ora" subtitle="Distribuzione dell ultimo giorno dal file ACTIVITY_MINUTE" accent={<Footprints className="h-5 w-5 text-emerald-300" />}>
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
