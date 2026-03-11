import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import {
  Activity,
  CalendarDays,
  ChevronRight,
  Dumbbell,
  Flame,
  HeartPulse,
  MoonStar,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HealthData } from '../types';
import { setPendingCalendarIntent } from '../lib/navigationIntent';
import { resolveWorkoutTitle } from '../utils/workoutMeta';
import { buildWorkoutInsights } from '../utils/workoutData';
import { ChatVisualContext } from '../utils/chatVisualContext';
import { getStoredWorkouts } from '../lib/appDataStore';
import { isWorkoutCompleted } from '../utils/workoutStatus';

interface ChatInlineCompanionProps {
  context: Exclude<ChatVisualContext, { kind: 'overview' }>;
  healthData: HealthData | null;
  onNavigateTab: (tab: string) => void;
  workoutsCount: number;
}

const workoutInsightCache = new Map<string, ReturnType<typeof buildWorkoutInsights>>();

function getWorkoutInsightCacheKey(workout: Extract<ChatVisualContext, { kind: 'workout' }>['workout']) {
  return [
    workout.id,
    workout.date,
    workout.gpxData?.length || 0,
    workout.tcxData?.length || 0,
  ].join('|');
}

function getCachedWorkoutInsights(workout: Extract<ChatVisualContext, { kind: 'workout' }>['workout']) {
  const cacheKey = getWorkoutInsightCacheKey(workout);
  const cached = workoutInsightCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const computed = buildWorkoutInsights(workout);
  workoutInsightCache.set(cacheKey, computed);
  return computed;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function normalizeDateOnly(value: string) {
  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildWindowSeries(points: Array<{ date: string; value: number }>, startDate: string, endDate: string) {
  return points
    .map((item) => {
      const normalizedDate = normalizeDateOnly(item.date);
      return normalizedDate
        ? { date: normalizedDate, value: item.value, label: format(parseIsoDate(normalizedDate), 'd MMM', { locale: it }) }
        : null;
    })
    .filter((item): item is { date: string; value: number; label: string } => Boolean(item))
    .filter((item) => item.date >= startDate && item.date <= endDate);
}

function formatLongDate(value: string) {
  return format(parseIsoDate(value), 'd MMMM yyyy', { locale: it });
}

function formatDurationMinutes(value?: number | null) {
  if (!value || value <= 0) {
    return '--';
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${value} min`;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function CompanionShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-emerald-500/15 bg-[linear-gradient(180deg,rgba(16,185,129,0.08),rgba(9,9,11,0.96))]">
      <div className="border-b border-zinc-800/80 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-emerald-200">
          <Sparkles className="h-3.5 w-3.5" />
          Dynamic Companion
        </div>
        <div className="mt-2 text-base font-bold text-white">{title}</div>
        <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function MiniMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  variant = 'secondary',
}: {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
        variant === 'primary'
          ? 'border border-emerald-400/20 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/18'
          : 'border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
      }`}
    >
      {label}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}

function WorkoutCompanion({
  context,
  onNavigateTab,
}: {
  context: Extract<ChatVisualContext, { kind: 'workout' }>;
  onNavigateTab: (tab: string) => void;
}) {
  const insights = useMemo(
    () => getCachedWorkoutInsights(context.workout),
    [context.workout.id, context.workout.date, context.workout.gpxData?.length, context.workout.tcxData?.length],
  );
  const durationMinutes = context.workout.durationMinutes ?? (insights.metrics?.durationMs ? Math.round(insights.metrics.durationMs / 60000) : null);
  const calories = context.workout.caloriesBurned ?? insights.metrics?.caloriesBurned ?? null;
  const averageHeartRate = context.workout.averageHeartRate ?? insights.metrics?.avgHr ?? null;
  const chartData = insights.chartPoints
    .filter((point) => point.heartRate !== null)
    .slice(0, 18);

  return (
    <CompanionShell
      title={resolveWorkoutTitle(context.workout)}
      subtitle={`Companion generato dal contesto del workout del ${formatLongDate(context.workout.date)}`}
    >
      <div className="grid grid-cols-2 gap-3">
        <MiniMetric icon={<Timer className="h-3 w-3" />} label="Tempo" value={formatDurationMinutes(durationMinutes)} />
        <MiniMetric icon={<Flame className="h-3 w-3" />} label="Calorie" value={calories ? `${Math.round(calories)} kcal` : '--'} />
        <MiniMetric icon={<HeartPulse className="h-3 w-3" />} label="BPM medio" value={averageHeartRate ? `${Math.round(averageHeartRate)} bpm` : '--'} />
        <MiniMetric icon={<Dumbbell className="h-3 w-3" />} label="Esercizi" value={`${context.workout.exercises.length}`} />
      </div>

      {chartData.length > 3 ? (
        <div className="mt-4 h-40 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} minTickGap={18} />
              <YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '1rem', color: '#fff' }}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={(value) => [value ? `${value} bpm` : '--', 'BPM']}
              />
              <Area type="monotone" dataKey="heartRate" stroke="#f97316" fill="#f97316" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          label="Apri workout nel calendario"
          onClick={() => {
            setPendingCalendarIntent({ date: context.workout.date, mode: 'focus' });
            onNavigateTab('calendar');
          }}
          variant="primary"
        />
        <ActionButton label="Apri Coach Planner" onClick={() => onNavigateTab('coach-planner')} />
      </div>
    </CompanionShell>
  );
}

function MissingWorkoutCompanion({
  context,
  onNavigateTab,
}: {
  context: Extract<ChatVisualContext, { kind: 'missing-workout' }>;
  onNavigateTab: (tab: string) => void;
}) {
  return (
    <CompanionShell
      title="Vuoi trasformarlo in azione?"
      subtitle={context.requestedDate ? `Non trovo un workout per il ${formatLongDate(context.requestedDate)}.` : 'La chat parla di un workout non ancora presente nel contesto.'}
    >
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-sm text-zinc-300">
        Posso portarti direttamente al calendario per inserirlo nel giorno giusto oppure al planner per costruirlo meglio.
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          label="Inserisci workout"
          onClick={() => {
            if (context.requestedDate) {
              setPendingCalendarIntent({ date: context.requestedDate, mode: 'editor' });
            }
            onNavigateTab('calendar');
          }}
          variant="primary"
        />
        <ActionButton label="Apri Coach Planner" onClick={() => onNavigateTab('coach-planner')} />
      </div>
    </CompanionShell>
  );
}

function TrendCompanion({
  context,
  healthData,
  onNavigateTab,
  workoutsCount,
}: {
  context: Extract<ChatVisualContext, { kind: 'trend' }>;
  healthData: HealthData | null;
  onNavigateTab: (tab: string) => void;
  workoutsCount: number;
}) {
  const sleepSeries = buildWindowSeries(healthData?.trends.sleep || [], context.startDate, context.endDate);
  const stepsSeries = buildWindowSeries(healthData?.trends.steps || [], context.startDate, context.endDate);
  const bpmSeries = buildWindowSeries(healthData?.trends.bpm || [], context.startDate, context.endDate);
  const workouts = getStoredWorkouts()
    .filter((workout) => isWorkoutCompleted(workout))
    .filter((workout) => workout.date >= context.startDate && workout.date <= context.endDate);
  const totalMinutes = workouts.reduce((sum, workout) => sum + (workout.durationMinutes || 0), 0);
  const totalCalories = workouts.reduce((sum, workout) => sum + (workout.caloriesBurned || 0), 0);
  const workoutBreakdown = workouts.reduce<Record<string, number>>((accumulator, workout) => {
    const key = resolveWorkoutTitle(workout);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const sleepAverage = average(sleepSeries.map((item) => item.value));
  const stepsAverage = average(stepsSeries.map((item) => item.value));
  const bpmAverage = average(bpmSeries.map((item) => item.value));
  const firstSleep = sleepSeries[0]?.value ?? null;
  const lastSleep = sleepSeries.at(-1)?.value ?? null;
  const firstSteps = stepsSeries[0]?.value ?? null;
  const lastSteps = stepsSeries.at(-1)?.value ?? null;
  const firstBpm = bpmSeries[0]?.value ?? null;
  const lastBpm = bpmSeries.at(-1)?.value ?? null;
  const highlightLines = [
    sleepAverage !== null ? `Sonno medio ${sleepAverage.toFixed(1)} h` : null,
    stepsAverage !== null ? `Passi medi ${Math.round(stepsAverage).toLocaleString('it-IT')}` : null,
    bpmAverage !== null ? `BPM medio ${Math.round(bpmAverage)} bpm` : null,
    workouts.length > 0 ? `${workouts.length} workout confermati` : 'Nessun workout confermato',
  ].filter(Boolean) as string[];
  const chartSeries = context.focus === 'recovery' && sleepSeries.length > 2
    ? sleepSeries
    : context.focus === 'activity' && stepsSeries.length > 2
      ? stepsSeries
      : bpmSeries.length > 2
        ? bpmSeries
        : stepsSeries;
  const chartKey = context.focus === 'recovery' && sleepSeries.length > 2
    ? 'sleep'
    : context.focus === 'activity' && stepsSeries.length > 2
      ? 'steps'
      : bpmSeries.length > 2
        ? 'bpm'
        : 'steps';
  const chartTone = chartKey === 'sleep'
    ? { stroke: '#34d399', fill: '#34d399', label: 'Sonno' }
    : chartKey === 'bpm'
      ? { stroke: '#fb7185', fill: '#fb7185', label: 'BPM' }
      : { stroke: '#38bdf8', fill: '#38bdf8', label: 'Passi' };

  return (
    <CompanionShell
      title={context.title}
      subtitle={`Companion allineato alla finestra ${formatLongDate(context.startDate)} -> ${formatLongDate(context.endDate)}`}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniMetric icon={<CalendarDays className="h-3 w-3" />} label="Workout" value={`${workouts.length || workoutsCount}`} />
        <MiniMetric icon={<MoonStar className="h-3 w-3" />} label="Sonno medio" value={sleepAverage !== null ? `${sleepAverage.toFixed(1)} h` : '--'} />
        <MiniMetric icon={<Target className="h-3 w-3" />} label="Passi medi" value={stepsAverage !== null ? `${Math.round(stepsAverage).toLocaleString('it-IT')}` : '--'} />
        <MiniMetric icon={<HeartPulse className="h-3 w-3" />} label="BPM medio" value={bpmAverage !== null ? `${Math.round(bpmAverage)} bpm` : '--'} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniMetric icon={<Timer className="h-3 w-3" />} label="Tempo totale" value={formatDurationMinutes(totalMinutes)} />
        <MiniMetric icon={<Flame className="h-3 w-3" />} label="Calorie totali" value={totalCalories > 0 ? `${Math.round(totalCalories)} kcal` : '--'} />
        <MiniMetric icon={<TrendingUp className="h-3 w-3" />} label="Delta sonno" value={firstSleep !== null && lastSleep !== null ? `${lastSleep - firstSleep >= 0 ? '+' : ''}${(lastSleep - firstSleep).toFixed(1)} h` : '--'} />
        <MiniMetric icon={<Activity className="h-3 w-3" />} label="Delta passi" value={firstSteps !== null && lastSteps !== null ? `${lastSteps - firstSteps >= 0 ? '+' : ''}${Math.round(lastSteps - firstSteps)}` : '--'} />
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Sintesi finestra</div>
        <div className="flex flex-wrap gap-2 text-sm text-zinc-300">
          {highlightLines.map((line) => (
            <span key={line} className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1">
              {line}
            </span>
          ))}
        </div>
        {Object.keys(workoutBreakdown).length > 0 ? (
          <div className="mt-3 text-xs text-zinc-400">
            Breakdown workout: {Object.entries(workoutBreakdown).map(([label, count]) => `${label}=${count}`).join(' | ')}
          </div>
        ) : null}
        {firstBpm !== null && lastBpm !== null ? (
          <div className="mt-2 text-xs text-zinc-500">
            BPM inizio/fine finestra: {Math.round(firstBpm)} {'->'} {Math.round(lastBpm)} bpm.
          </div>
        ) : null}
      </div>

      {chartSeries.length > 2 ? (
        <div className="mt-4 h-40 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '1rem', color: '#fff' }}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={(value) => [
                  chartKey === 'sleep'
                    ? `${Number(value).toFixed(1)} h`
                    : `${Math.round(Number(value)).toLocaleString('it-IT')}${chartKey === 'bpm' ? ' bpm' : ''}`,
                  chartTone.label,
                ]}
              />
              <Bar dataKey="value" fill={chartTone.fill} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton label="Apri dashboard" onClick={() => onNavigateTab('dashboard')} variant="primary" />
        <ActionButton label="Vedi record" onClick={() => onNavigateTab('records')} />
      </div>
    </CompanionShell>
  );
}

export default function ChatInlineCompanion({
  context,
  healthData,
  onNavigateTab,
  workoutsCount,
}: ChatInlineCompanionProps) {
  if (context.kind === 'workout') {
    return <WorkoutCompanion context={context} onNavigateTab={onNavigateTab} />;
  }

  if (context.kind === 'missing-workout') {
    return <MissingWorkoutCompanion context={context} onNavigateTab={onNavigateTab} />;
  }

  return <TrendCompanion context={context} healthData={healthData} onNavigateTab={onNavigateTab} workoutsCount={workoutsCount} />;
}
