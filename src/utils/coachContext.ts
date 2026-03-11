import { HealthData, PersonalRecord, UserProfile, Workout } from '../types';
import { readCoachMemory } from './coachMemory';
import { getStoredProfile, getStoredRecords, getStoredWorkouts } from '../lib/appDataStore';
import { formatRecordValue } from './recordFormatting';
import { estimateFatigueGroups } from './fatigue';
import { getConfirmedWorkouts, isWorkoutCompleted } from './workoutStatus';
import { calculateReadiness } from './readiness';

const RECENT_WINDOW_DAYS = 30;
const RECENT_WORKOUT_CONTEXT_LIMIT = 20;
const UPCOMING_WORKOUT_LIMIT = 5;
const DAY_IDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS_IT: Record<(typeof DAY_IDS)[number], string> = {
  sunday: 'domenica',
  monday: 'lunedì',
  tuesday: 'martedì',
  wednesday: 'mercoledì',
  thursday: 'giovedì',
  friday: 'venerdì',
  saturday: 'sabato',
};

export interface RecentWindowTrendStats {
  samples: number;
  average: number;
  min: number;
  max: number;
  firstDate: string;
  firstValue: number;
  lastDate: string;
  lastValue: number;
  delta: number;
  targetHits: number | null;
}

export interface RecentWindowSnapshot {
  windowDays: number;
  referenceDate: string;
  startDate: string;
  endDate: string;
  profile: UserProfile | null;
  healthDataAvailable: boolean;
  hrvAvailable: boolean;
  sleep: RecentWindowTrendStats | null;
  steps: RecentWindowTrendStats | null;
  bpm: RecentWindowTrendStats | null;
  workouts: {
    count: number;
    totalMinutes: number;
    totalCalories: number;
    byType: Record<string, number>;
    pendingCount: number;
  };
  recordEntriesCount: number;
}

export interface CoachContextWindowOptions {
  windowDays?: number;
  endDate?: string;
}

function formatWeeklySchedule(profile: UserProfile) {
  const entries = Object.entries(profile.weeklySchedule)
    .filter(([, muscles]) => Array.isArray(muscles) && muscles.length > 0)
    .map(([day, muscles]) => `${day}: ${muscles.join(', ')}`);

  return entries.length > 0 ? entries.join(' | ') : 'non definita';
}

function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

function formatLocalIsoDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';

  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatDateOnly(value: Date) {
  if (!isValidDate(value)) {
    return formatLocalIsoDate(new Date());
  }

  return formatLocalIsoDate(value);
}

function getCurrentLocalDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';

  return `${year}-${month}-${day}`;
}

function normalizeDateString(value: string, referenceDate?: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const isoDate = isoMatch[1];
    const parsedIsoDate = parseIsoDate(isoDate);
    return isValidDate(parsedIsoDate) ? isoDate : null;
  }

  const chartDateMatch = trimmed.match(/^(\d{2})\/(\d{2})$/);
  if (chartDateMatch) {
    const [, day, month] = chartDateMatch;
    const reference = referenceDate ? parseIsoDate(referenceDate) : new Date();
    const referenceYear = isValidDate(reference) ? reference.getFullYear() : new Date().getFullYear();
    let candidate = parseIsoDate(`${referenceYear}-${month}-${day}`);

    if (!isValidDate(candidate)) {
      return null;
    }

    if (referenceDate) {
      const normalizedReference = parseIsoDate(referenceDate);
      if (isValidDate(normalizedReference) && candidate > normalizedReference) {
        candidate = parseIsoDate(`${referenceYear - 1}-${month}-${day}`);
      }
    }

    return formatDateOnly(candidate);
  }

  const parsedTimestamp = new Date(trimmed);
  return isValidDate(parsedTimestamp) ? formatDateOnly(parsedTimestamp) : null;
}

function shiftDate(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(from: string, to: string) {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function getDayId(date: Date) {
  return DAY_IDS[date.getDay()];
}

function getStartOfWeek(value: Date) {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function getStartOfMonth(value: Date) {
  const date = new Date(value);
  date.setDate(1);
  return date;
}

function formatPastRecencyLabel(days: number) {
  if (days <= 0) {
    return 'oggi';
  }

  if (days === 1) {
    return 'ieri';
  }

  return `${days} giorni fa`;
}

function formatFutureRecencyLabel(days: number) {
  if (days <= 0) {
    return 'oggi';
  }

  if (days === 1) {
    return 'domani';
  }

  return `tra ${days} giorni`;
}

function getDateWindow(endDate: string, days = RECENT_WINDOW_DAYS) {
  const normalizedEndDate = normalizeDateString(endDate) || getCurrentLocalDateString();
  const end = parseIsoDate(normalizedEndDate);
  const start = shiftDate(end, -(days - 1));
  return {
    start: formatDateOnly(start),
    end: normalizedEndDate,
  };
}

function getReferenceDate(healthData: HealthData | null | undefined, workouts: Workout[], records: PersonalRecord[]) {
  const candidateDates: string[] = [];

  if (healthData?.details?.latestDate) {
    candidateDates.push(healthData.details.latestDate);
  }

  candidateDates.push(...(healthData?.trends.sleep ?? []).map((item) => item.date));
  candidateDates.push(...(healthData?.trends.steps ?? []).map((item) => item.date));
  candidateDates.push(...(healthData?.trends.bpm ?? []).map((item) => item.date));
  candidateDates.push(...workouts.map((workout) => workout.date));
  candidateDates.push(
    ...records.flatMap((record) => record.entries.map((entry) => entry.date)),
  );

  return candidateDates
    .map((date) => normalizeDateString(date))
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1) || getCurrentLocalDateString();
}

function filterTrendWindow(points: { date: string; value: number }[], start: string, end: string) {
  return aggregateTrendPointsByDate(points, end)
    .filter((point) => point.date >= start && point.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateTrendPointsByDate(points: { date: string; value: number }[], referenceDate: string) {
  const buckets = points.reduce<Record<string, number[]>>((accumulator, point) => {
    const normalizedDate = normalizeDateString(point.date, referenceDate);
    if (!normalizedDate || !Number.isFinite(point.value)) {
      return accumulator;
    }

    if (!accumulator[normalizedDate]) {
      accumulator[normalizedDate] = [];
    }

    accumulator[normalizedDate].push(point.value);
    return accumulator;
  }, {});

  return Object.entries(buckets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => {
      const validValues = values.filter((value) => value > 0);
      const sourceValues = validValues.length > 0 ? validValues : values;
      const aggregatedValue = sourceValues.reduce((sum, value) => sum + value, 0) / sourceValues.length;

      return {
        date,
        value: aggregatedValue,
      };
    })
    .map((point) => ({
      date: point.date,
      value: point.value,
    }));
}

function computeTrendSummary(
  label: string,
  points: { date: string; value: number }[],
  formatter: (value: number) => string,
  target?: number,
) {
  if (points.length === 0) {
    return null;
  }

  const values = points.map((point) => point.value);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const delta = values[values.length - 1] - values[0];
  const deltaText = delta === 0 ? 'stabile' : `${delta > 0 ? '+' : ''}${formatter(delta)}`;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const targetHits = typeof target === 'number'
    ? `, target centrato ${values.filter((value) => value >= target).length}/${points.length} giorni`
    : '';

  return `- ${label} ultimi ${points.length} giorni: media ${formatter(average)}, min ${formatter(min)}, max ${formatter(max)}, dal ${firstPoint.date} al ${lastPoint.date} variazione ${deltaText}${targetHits}.`;
}

function getTrendStats(points: { date: string; value: number }[], target?: number) {
  if (points.length === 0) {
    return null;
  }

  const values = points.map((point) => point.value);
  return {
    samples: points.length,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    firstDate: points[0].date,
    firstValue: values[0],
    lastDate: points[points.length - 1].date,
    lastValue: values[values.length - 1],
    delta: values[values.length - 1] - values[0],
    targetHits: typeof target === 'number' ? values.filter((value) => value >= target).length : null,
  };
}

function getWorkoutsInRange(workouts: Workout[], start: string, end: string) {
  return workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, end),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= start && entry.normalizedDate <= end)
    .map(({ workout }) => workout);
}

function formatWorkoutTypeBreakdown(byType: Record<string, number>) {
  const entries = Object.entries(byType);
  if (entries.length === 0) {
    return 'nessuno';
  }

  return entries
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => `${label}=${count}`)
    .join(' | ');
}

function buildChatPeriodSummary(
  label: string,
  healthData: HealthData | null | undefined,
  profile: UserProfile | null,
  workouts: Workout[],
  start: string,
  end: string,
) {
  const fragments: string[] = [`${label} (${start} -> ${end})`];

  if (healthData) {
    const sleepStats = getTrendStats(filterTrendWindow(healthData.trends.sleep, start, end), profile?.targetSleep);
    const stepsStats = getTrendStats(filterTrendWindow(healthData.trends.steps, start, end), profile?.targetSteps);
    const bpmStats = getTrendStats(filterTrendWindow(healthData.trends.bpm ?? [], start, end));

    if (sleepStats) {
      fragments.push(`sonno medio ${sleepStats.average.toFixed(1)} h`);
      fragments.push(`delta sonno ${sleepStats.delta >= 0 ? '+' : ''}${sleepStats.delta.toFixed(1)} h`);
    }

    if (stepsStats) {
      fragments.push(`passi medi ${Math.round(stepsStats.average)}`);
    }

    if (bpmStats) {
      fragments.push(`BPM medio ${Math.round(bpmStats.average)} bpm`);
    }
  }

  const periodWorkouts = getWorkoutsInRange(workouts, start, end);
  const totalMinutes = Math.round(periodWorkouts.reduce((sum, workout) => sum + (workout.durationMinutes || 0), 0));
  const totalCalories = Math.round(periodWorkouts.reduce((sum, workout) => sum + (workout.caloriesBurned || 0), 0));
  const byType = periodWorkouts.reduce<Record<string, number>>((accumulator, workout) => {
    const key = workout.sourceSportLabel || workout.title || workout.type || 'Allenamento';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  fragments.push(`${periodWorkouts.length} workout`);
  fragments.push(`tempo totale ${totalMinutes} min`);
  fragments.push(`calorie totali ${totalCalories} kcal`);

  const typeBreakdown = formatWorkoutTypeBreakdown(byType);
  if (typeBreakdown !== 'nessuno') {
    fragments.push(`tipi ${typeBreakdown}`);
  }

  return `- ${fragments.join(', ')}.`;
}

function buildWorkoutWindowSummary(workouts: Workout[], start: string, end: string) {
  const recentWorkouts = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, end),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= start && entry.normalizedDate <= end)
    .sort((a, b) => a.normalizedDate.localeCompare(b.normalizedDate))
    .map(({ workout }) => workout);

  if (recentWorkouts.length === 0) {
    return [];
  }

  const totalMinutes = recentWorkouts.reduce((sum, workout) => sum + (workout.durationMinutes || 0), 0);
  const totalCalories = recentWorkouts.reduce((sum, workout) => sum + (workout.caloriesBurned || 0), 0);
  const byType = recentWorkouts.reduce<Record<string, number>>((accumulator, workout) => {
    const key = workout.sourceSportLabel || workout.title || workout.type || 'Allenamento';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const typeBreakdown = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}: ${count}`)
    .join(' | ');
  const latestItems = recentWorkouts
    .slice(-6)
    .reverse()
    .map((workout) => {
      const title = workout.title || workout.sourceSportLabel || workout.type || 'Allenamento';
      const duration = workout.durationMinutes ? `${workout.durationMinutes} min` : 'durata n.d.';
      return `${workout.date} ${title} (${duration})`;
    })
    .join(' | ');

  return [
    `- Allenamenti ultimi ${RECENT_WINDOW_DAYS} giorni: ${recentWorkouts.length} sessioni, ${Math.round(totalMinutes)} min totali, ${Math.round(totalCalories)} kcal, breakdown ${typeBreakdown}.`,
    `- Ultime sessioni: ${latestItems}.`,
  ];
}

function buildRecentWorkoutContext(workouts: Workout[], start: string, end: string) {
  const recentWorkouts = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, end),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= start && entry.normalizedDate <= end)
    .sort((a, b) => b.normalizedDate.localeCompare(a.normalizedDate))
    .map(({ workout }) => workout)
    .slice(0, RECENT_WORKOUT_CONTEXT_LIMIT);

  if (recentWorkouts.length === 0) {
    return null;
  }

  const compactItems = recentWorkouts.map((workout) => {
    const label = workout.sourceSportLabel || workout.title || workout.type || 'Allenamento';
    const duration = workout.durationMinutes ? `${workout.durationMinutes} min` : 'durata n.d.';
    const calories = workout.caloriesBurned ? `${workout.caloriesBurned} kcal` : 'kcal n.d.';
    const averageHeartRate = workout.averageHeartRate ? `${workout.averageHeartRate} bpm` : 'HR n.d.';

    return `${workout.date} | ${label} | ${duration} | ${calories} | ${averageHeartRate}`;
  });

  return [
    `- Storico compatto allenamenti recenti: usa questi item per leggere progressione e continuita. Limite ${RECENT_WORKOUT_CONTEXT_LIMIT} sessioni piu recenti nella finestra ${start} -> ${end}.`,
    ...compactItems.map((item) => `  ${item}`),
  ].join('\n');
}

function buildRecordWindowSummary(records: PersonalRecord[], start: string, end: string) {
  const latestRecentEntries = records
    .map((record) => {
      const entry = [...record.entries]
        .map((item) => ({
          item,
          normalizedDate: normalizeDateString(item.date, end),
        }))
        .filter((entry): entry is { item: PersonalRecord['entries'][number]; normalizedDate: string } => Boolean(entry.normalizedDate))
        .filter((entry) => entry.normalizedDate >= start && entry.normalizedDate <= end)
        .sort((a, b) => a.normalizedDate.localeCompare(b.normalizedDate))
        .map(({ item }) => item)
        .at(-1);

      if (!entry) {
        return null;
      }

      return `${record.exerciseName}: ${formatRecordValue(entry, record)} (${entry.date})`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);

  if (latestRecentEntries.length === 0) {
    return null;
  }

  return `- Record / performance registrate negli ultimi ${RECENT_WINDOW_DAYS} giorni: ${latestRecentEntries.join(' | ')}.`;
}

function getRecentRecordCount(records: PersonalRecord[], start: string, end: string) {
  return records.reduce((count, record) => (
    count + record.entries.filter((entry) => {
      const normalizedDate = normalizeDateString(entry.date, end);
      return Boolean(normalizedDate && normalizedDate >= start && normalizedDate <= end);
    }).length
  ), 0);
}

export function buildRecentWindowSnapshot(
  healthData?: HealthData | null,
  options: CoachContextWindowOptions = {},
): RecentWindowSnapshot {
  const profile = getStoredProfile();
  const allWorkouts = getStoredWorkouts();
  const workouts = getConfirmedWorkouts(allWorkouts);
  const records = getStoredRecords();
  const referenceDate = normalizeDateString(options.endDate || '') || getReferenceDate(healthData, allWorkouts, records);
  const recentWindow = getDateWindow(referenceDate, options.windowDays ?? RECENT_WINDOW_DAYS);
  const sleepTrend = healthData ? filterTrendWindow(healthData.trends.sleep, recentWindow.start, recentWindow.end) : [];
  const stepsTrend = healthData ? filterTrendWindow(healthData.trends.steps, recentWindow.start, recentWindow.end) : [];
  const bpmTrend = healthData ? filterTrendWindow(healthData.trends.bpm ?? [], recentWindow.start, recentWindow.end) : [];
  const recentWorkouts = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, recentWindow.end),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= recentWindow.start && entry.normalizedDate <= recentWindow.end)
    .map(({ workout }) => workout);
  const workoutByType = recentWorkouts.reduce<Record<string, number>>((accumulator, workout) => {
    const key = workout.sourceSportLabel || workout.title || workout.type || 'Allenamento';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const pendingWorkoutCount = allWorkouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, recentWindow.end),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= recentWindow.start && entry.normalizedDate <= recentWindow.end)
    .filter(({ workout }) => !isWorkoutCompleted(workout))
    .length;

  return {
    windowDays: options.windowDays ?? RECENT_WINDOW_DAYS,
    referenceDate,
    startDate: recentWindow.start,
    endDate: recentWindow.end,
    profile,
    healthDataAvailable: Boolean(healthData),
    hrvAvailable: healthData?.meta?.hrvAvailable !== false,
    sleep: healthData ? getTrendStats(sleepTrend, profile?.targetSleep) : null,
    steps: healthData ? getTrendStats(stepsTrend, profile?.targetSteps) : null,
    bpm: healthData ? getTrendStats(bpmTrend) : null,
    workouts: {
      count: recentWorkouts.length,
      totalMinutes: Math.round(recentWorkouts.reduce((sum, workout) => sum + (workout.durationMinutes || 0), 0)),
      totalCalories: Math.round(recentWorkouts.reduce((sum, workout) => sum + (workout.caloriesBurned || 0), 0)),
      byType: workoutByType,
      pendingCount: pendingWorkoutCount,
    },
    recordEntriesCount: getRecentRecordCount(records, recentWindow.start, recentWindow.end),
  };
}

function buildRecentHealthContext(healthData: HealthData, profile: UserProfile | null, start: string, end: string) {
  const lines: string[] = [];
  const sleepTrend = filterTrendWindow(healthData.trends.sleep, start, end);
  const stepsTrend = filterTrendWindow(healthData.trends.steps, start, end);
  const bpmTrend = filterTrendWindow(healthData.trends.bpm ?? [], start, end);

  lines.push(`- Finestra dati recenti da usare per progressi e andamento: ${start} -> ${end} (ultimi ${RECENT_WINDOW_DAYS} giorni).`);
  lines.push(`- Per report e trend usa solo confronti interni a questa finestra. Non usare espressioni come "media storica" se non c e un confronto esplicito nei dati.`);

  const sleepSummary = computeTrendSummary(
    'Sonno',
    sleepTrend,
    (value) => `${value.toFixed(1)} h`,
    profile?.targetSleep,
  );
  if (sleepSummary) {
    lines.push(sleepSummary);
  }

  const stepsSummary = computeTrendSummary(
    'Passi',
    stepsTrend,
    (value) => `${Math.round(value)}`,
    profile?.targetSteps,
  );
  if (stepsSummary) {
    lines.push(stepsSummary);
  }

  const bpmSummary = computeTrendSummary(
    healthData.meta?.hrvAvailable === false ? 'BPM base / recupero stimato' : 'BPM base',
    bpmTrend,
    (value) => `${Math.round(value)} bpm`,
  );
  if (bpmSummary) {
    lines.push(bpmSummary);
  }

  return lines;
}

function buildDeterministicReportFacts(
  healthData: HealthData | null | undefined,
  profile: UserProfile | null,
  workouts: Workout[],
  records: PersonalRecord[],
  start: string,
  end: string,
) {
  const lines = [
    `FATTI REPORT AUTORITATIVI (${RECENT_WINDOW_DAYS} giorni):`,
    `- Periodo: ${start} -> ${end}. Usa questi numeri come riferimento principale e non ricalcolarli liberamente.`,
  ];

  if (healthData) {
    const sleepStats = getTrendStats(filterTrendWindow(healthData.trends.sleep, start, end), profile?.targetSleep);
    const stepsStats = getTrendStats(filterTrendWindow(healthData.trends.steps, start, end), profile?.targetSteps);
    const bpmStats = getTrendStats(filterTrendWindow(healthData.trends.bpm ?? [], start, end));

    if (sleepStats) {
      lines.push(`- Sonno: media ${sleepStats.average.toFixed(1)} h, min ${sleepStats.min.toFixed(1)} h, max ${sleepStats.max.toFixed(1)} h, primo ${sleepStats.firstDate}=${sleepStats.firstValue.toFixed(1)} h, ultimo ${sleepStats.lastDate}=${sleepStats.lastValue.toFixed(1)} h, delta ${sleepStats.delta >= 0 ? '+' : ''}${sleepStats.delta.toFixed(1)} h${sleepStats.targetHits !== null ? `, target centrato ${sleepStats.targetHits}/${sleepStats.samples}` : ''}.`);
    }

    if (stepsStats) {
      lines.push(`- Passi: media ${Math.round(stepsStats.average)}, min ${Math.round(stepsStats.min)}, max ${Math.round(stepsStats.max)}, primo ${stepsStats.firstDate}=${Math.round(stepsStats.firstValue)}, ultimo ${stepsStats.lastDate}=${Math.round(stepsStats.lastValue)}, delta ${stepsStats.delta >= 0 ? '+' : ''}${Math.round(stepsStats.delta)}${stepsStats.targetHits !== null ? `, target centrato ${stepsStats.targetHits}/${stepsStats.samples}` : ''}.`);
    }

    if (bpmStats) {
      lines.push(`- BPM base: media ${Math.round(bpmStats.average)} bpm, min ${Math.round(bpmStats.min)} bpm, max ${Math.round(bpmStats.max)} bpm, primo ${bpmStats.firstDate}=${Math.round(bpmStats.firstValue)} bpm, ultimo ${bpmStats.lastDate}=${Math.round(bpmStats.lastValue)} bpm, delta ${bpmStats.delta >= 0 ? '+' : ''}${Math.round(bpmStats.delta)} bpm.`);
    }
  }

  const recentWorkouts = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, end),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= start && entry.normalizedDate <= end)
    .map(({ workout }) => workout);

  if (recentWorkouts.length > 0) {
    const totalMinutes = recentWorkouts.reduce((sum, workout) => sum + (workout.durationMinutes || 0), 0);
    const totalCalories = recentWorkouts.reduce((sum, workout) => sum + (workout.caloriesBurned || 0), 0);
    const byType = recentWorkouts.reduce<Record<string, number>>((accumulator, workout) => {
      const key = workout.sourceSportLabel || workout.title || workout.type || 'Allenamento';
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    lines.push(`- Allenamenti: ${recentWorkouts.length} sessioni, ${Math.round(totalMinutes)} min totali, ${Math.round(totalCalories)} kcal, tipi ${Object.entries(byType).map(([type, count]) => `${type}=${count}`).join(' | ')}.`);
  } else {
    const pendingWorkouts = getStoredWorkouts()
      .map((workout) => ({
        workout,
        normalizedDate: normalizeDateString(workout.date, end),
      }))
      .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
      .filter((entry) => entry.normalizedDate >= start && entry.normalizedDate <= end)
      .filter(({ workout }) => !isWorkoutCompleted(workout));

    if (pendingWorkouts.length > 0) {
      lines.push(`- Allenamenti: nessuna sessione confermata nella finestra recente; presenti ${pendingWorkouts.length} workout pianificati o non ancora confermati.`);
    } else {
      lines.push('- Allenamenti: nessuna sessione nella finestra recente.');
    }
  }

  lines.push(`- Record recenti registrati: ${getRecentRecordCount(records, start, end)} entry nella finestra.`);
  lines.push('- Se l utente chiede un report, usa questi fatti numerici cosi come sono e limita le conclusioni a cio che i dati supportano davvero.');

  return lines.join('\n');
}

function buildCoachMemoryContext() {
  const memory = readCoachMemory();

  return [
    'Memoria coach:',
    `- Obiettivo primario: ${memory.primaryGoal}.`,
    `- Sport principale: ${memory.mainSport}.`,
    memory.currentPhase ? `- Fase corrente: ${memory.currentPhase}.` : null,
    memory.availableEquipment.length > 0 ? `- Attrezzatura disponibile: ${memory.availableEquipment.join(', ')}.` : null,
    memory.limitations.length > 0 ? `- Limitazioni: ${memory.limitations.join(', ')}.` : null,
    memory.injuries.length > 0 ? `- Infortuni o fastidi: ${memory.injuries.join(', ')}.` : null,
    memory.preferences.length > 0 ? `- Preferenze: ${memory.preferences.join(' | ')}.` : null,
    memory.coachNotes.length > 0 ? `- Note coach: ${memory.coachNotes.join(' | ')}.` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCurrentLoadContext(workouts: Workout[]) {
  const fatigueGroups = estimateFatigueGroups({
    workouts,
    currentDate: new Date(),
  });
  const topGroups = fatigueGroups.filter((group) => group.score > 0).slice(0, 3);

  if (topGroups.length === 0) {
    return '- Carico corrente ultimi 7 giorni: basso o assente; nessun accumulo rilevante dai workout confermati.';
  }

  const maxScore = topGroups[0].score;
  const overallLevel = maxScore >= 65
    ? 'alto'
    : maxScore >= 35
      ? 'moderato'
      : 'basso';

  return `- Carico corrente ultimi 7 giorni (solo workout confermati): ${overallLevel}. Gruppi piu sollecitati: ${topGroups.map((group) => `${group.label} ${group.score}/100 (${group.level})`).join(' | ')}.`;
}

function getLatestAvailableDate(dates: string[], currentDate: string) {
  return dates
    .map((date) => normalizeDateString(date, currentDate))
    .filter((date): date is string => Boolean(date && date <= currentDate))
    .sort()
    .at(-1) || null;
}

function buildRecencyContext(
  healthData: HealthData | null | undefined,
  workouts: Workout[],
  records: PersonalRecord[],
  currentDate: string,
) {
  const lastWorkoutDate = getLatestAvailableDate(workouts.map((workout) => workout.date), currentDate);
  const healthDates = [
    healthData?.details?.latestDate,
    ...(healthData?.trends.sleep ?? []).map((item) => item.date),
    ...(healthData?.trends.steps ?? []).map((item) => item.date),
    ...(healthData?.trends.bpm ?? []).map((item) => item.date),
  ].filter((date): date is string => Boolean(date));
  const lastHealthDate = getLatestAvailableDate(healthDates, currentDate);
  const lastRecordDate = getLatestAvailableDate(
    records.flatMap((record) => record.entries.map((entry) => entry.date)),
    currentDate,
  );

  const details = [
    lastWorkoutDate ? `ultimo allenamento ${lastWorkoutDate} (${formatPastRecencyLabel(diffDays(lastWorkoutDate, currentDate))})` : 'ultimo allenamento non disponibile',
    lastHealthDate ? `ultimi dati salute ${lastHealthDate} (${formatPastRecencyLabel(diffDays(lastHealthDate, currentDate))})` : 'ultimi dati salute non disponibili',
    lastRecordDate ? `ultimo record ${lastRecordDate} (${formatPastRecencyLabel(diffDays(lastRecordDate, currentDate))})` : 'ultimo record non disponibile',
  ];

  return `- Recency dati rispetto a oggi ${currentDate}: ${details.join(' | ')}.`;
}

function buildUpcomingDeadlineContext(profile: UserProfile | null, workouts: Workout[], currentDate: string) {
  const nextWorkout = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, currentDate),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= currentDate)
    .sort((a, b) => a.normalizedDate.localeCompare(b.normalizedDate))
    .at(0);

  if (nextWorkout) {
    const label = nextWorkout.workout.title || nextWorkout.workout.sourceSportLabel || nextWorkout.workout.type || 'workout';
    const daysUntil = diffDays(currentDate, nextWorkout.normalizedDate);
    return `- Prossima scadenza allenamento: ${nextWorkout.normalizedDate} ${label} (${formatFutureRecencyLabel(daysUntil)}, ${nextWorkout.workout.exercises.length} esercizi).`;
  }

  if (!profile || profile.activeDays.length === 0) {
    return null;
  }

  const today = parseIsoDate(currentDate);

  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = shiftDate(today, offset);
    const dayId = getDayId(candidate);

    if (!profile.activeDays.includes(dayId)) {
      continue;
    }

    const label = DAY_LABELS_IT[dayId];
    return `- Prossima scadenza allenamento: nessun workout in calendario; prossimo giorno attivo previsto ${label} (${formatFutureRecencyLabel(offset)}).`;
  }

  return null;
}

function buildRoutineAdherenceContext(profile: UserProfile | null, workouts: Workout[], currentDate: string) {
  if (!profile) {
    return null;
  }

  const currentDateValue = parseIsoDate(currentDate);
  const weekStart = getStartOfWeek(currentDateValue);
  const weekStartDate = formatDateOnly(weekStart);
  const normalizedWorkouts = workouts
    .map((workout) => normalizeDateString(workout.date, currentDate))
    .filter((date): date is string => Boolean(date && date >= weekStartDate && date <= currentDate));
  const weeklyTarget = profile.activeDays.length || profile.trainingDays;

  if (weeklyTarget <= 0) {
    return null;
  }

  const completedSessions = normalizedWorkouts.length;
  const completedDays = new Set(normalizedWorkouts).size;
  const plannedDaysSoFar = profile.activeDays.length > 0
    ? Array.from({ length: diffDays(weekStartDate, currentDate) + 1 }, (_, index) => getDayId(shiftDate(weekStart, index)))
      .filter((dayId) => profile.activeDays.includes(dayId))
      .length
    : Math.min(profile.trainingDays, diffDays(weekStartDate, currentDate) + 1);
  const paceLabel = completedDays > plannedDaysSoFar
    ? 'in anticipo'
    : completedDays === plannedDaysSoFar
      ? 'in linea'
      : 'in ritardo';

  return `- Aderenza routine settimana corrente (${weekStartDate} -> ${currentDate}): ${completedSessions}/${weeklyTarget} sessioni registrate; entro oggi erano previsti ${plannedDaysSoFar} giorni attivi, completati ${completedDays} giorni (${paceLabel}).`;
}

function buildPendingWorkoutContext(workouts: Workout[], currentDate: string) {
  const pendingWorkouts = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, currentDate),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter(({ workout }) => !isWorkoutCompleted(workout))
    .sort((left, right) => right.normalizedDate.localeCompare(left.normalizedDate));

  if (pendingWorkouts.length === 0) {
    return null;
  }

  const preview = pendingWorkouts
    .slice(0, 3)
    .map(({ workout, normalizedDate }) => `${normalizedDate} ${workout.title || workout.sourceSportLabel || workout.type || 'Allenamento'}`)
    .join(' | ');

  return `- Workout pianificati ma non ancora confermati: ${pendingWorkouts.length}. Ultimi: ${preview}. Non trattarli come sessioni svolte finche non vengono confermati.`;
}

function buildChatAlerts(
  profile: UserProfile | null,
  healthData: HealthData | null | undefined,
  workouts: Workout[],
  currentDate: string,
) {
  const alerts: string[] = [];

  if (healthData && profile && healthData.sleep.total < profile.targetSleep - 0.5) {
    alerts.push(`sonno sotto target (${healthData.sleep.total.toFixed(1)} h vs target ${profile.targetSleep} h)`);
  }

  const bpmTrend = healthData?.trends.bpm ?? [];
  if (bpmTrend.length >= 3) {
    const baselineSlice = bpmTrend.slice(Math.max(0, bpmTrend.length - 6), -1);
    const lastPoint = bpmTrend.at(-1);
    if (baselineSlice.length > 0 && lastPoint) {
      const baseline = baselineSlice.reduce((sum, point) => sum + point.value, 0) / baselineSlice.length;
      const delta = lastPoint.value - baseline;
      if (delta >= 4) {
        alerts.push(`BPM a riposo in salita (+${Math.round(delta)} bpm vs baseline recente)`);
      }
    }
  }

  const topFatigue = estimateFatigueGroups({
    workouts,
    currentDate: new Date(),
  }).find((group) => group.score >= 35);
  if (topFatigue) {
    alerts.push(`fatica ${topFatigue.label.toLowerCase()} ${topFatigue.level} (${topFatigue.score}/100)`);
  }

  const pendingCount = workouts.filter((workout) => {
    const normalizedDate = normalizeDateString(workout.date, currentDate);
    return Boolean(normalizedDate && normalizedDate <= currentDate && !isWorkoutCompleted(workout));
  }).length;
  if (pendingCount > 0) {
    alerts.push(`${pendingCount} workout da confermare`);
  }

  return alerts.slice(0, 3);
}

export function buildChatCoachContext(healthData?: HealthData | null) {
  const profile = getStoredProfile();
  const workouts = getStoredWorkouts();
  const confirmedWorkouts = getConfirmedWorkouts(workouts);
  const currentDate = getCurrentLocalDateString();
  const currentDateValue = parseIsoDate(currentDate);
  const weekStart = formatDateOnly(getStartOfWeek(currentDateValue));
  const monthStart = formatDateOnly(getStartOfMonth(currentDateValue));
  const lines = ['Contesto chat rapido FitSync:'];

  if (profile) {
    lines.push(`- Profilo: ${profile.name}, ${profile.weight} kg, split ${profile.preferredSplit}, ${profile.trainingDays} giorni/settimana.`);
    if (profile.activeDays.length > 0) {
      lines.push(`- Giorni attivi: ${profile.activeDays.join(', ')}.`);
    }
  }

  if (profile && healthData) {
    const readiness = calculateReadiness({
      profile,
      healthData,
      workouts: confirmedWorkouts,
      currentDate: new Date(),
    });
    const topFactors = readiness.factors
      .filter((factor) => factor.impact < 0)
      .sort((left, right) => left.impact - right.impact)
      .slice(0, 3)
      .map((factor) => `${factor.label} ${factor.impact}`)
      .join(' | ');

    lines.push(`- Stato rapido oggi ${currentDate}: readiness ${readiness.readinessScore}/100, sonno ${healthData.sleep.total.toFixed(1)} h, bpm ${healthData.bpm}, passi ${healthData.steps}.`);
    if (topFactors) {
      lines.push(`- Fattori principali: ${topFactors}.`);
    }
  } else if (healthData) {
    lines.push(`- Stato rapido oggi ${currentDate}: sonno ${healthData.sleep.total.toFixed(1)} h, bpm ${healthData.bpm}, passi ${healthData.steps}.`);
  }

  const latestWorkouts = confirmedWorkouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, currentDate),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .sort((left, right) => right.normalizedDate.localeCompare(left.normalizedDate))
    .slice(0, 7)
    .map(({ workout, normalizedDate }) => `${normalizedDate} ${workout.title || workout.sourceSportLabel || workout.type || 'Allenamento'}${workout.durationMinutes ? ` (${workout.durationMinutes} min)` : ''}`);

  if (latestWorkouts.length > 0) {
    lines.push(`- Ultimi workout confermati: ${latestWorkouts.join(' | ')}.`);
  } else {
    lines.push('- Ultimi workout confermati: nessuno disponibile.');
  }

  lines.push(buildChatPeriodSummary('Statistiche settimana corrente', healthData, profile, confirmedWorkouts, weekStart, currentDate));
  lines.push(buildChatPeriodSummary('Statistiche mese corrente', healthData, profile, confirmedWorkouts, monthStart, currentDate));

  const alerts = buildChatAlerts(profile, healthData, workouts, currentDate);
  if (alerts.length > 0) {
    lines.push(`- Alert rapidi: ${alerts.join(' | ')}.`);
  }

  lines.push('- Usa questo blocco come memoria operativa breve; per i dettagli profondi affidati solo alla richiesta corrente e al riassunto chat.');
  return lines.join('\n');
}

export function buildGlobalCoachContext(healthData?: HealthData | null, options: CoachContextWindowOptions = {}) {
  const profile = getStoredProfile();
  const workouts = getStoredWorkouts();
  const confirmedWorkouts = getConfirmedWorkouts(workouts);
  const records = getStoredRecords();
  const currentDate = getCurrentLocalDateString();
  const referenceDate = normalizeDateString(options.endDate || '') || getReferenceDate(healthData, workouts, records);
  const recentWindow = getDateWindow(referenceDate, options.windowDays ?? RECENT_WINDOW_DAYS);

  const lines: string[] = ['Contesto utente FitSync:', buildCoachMemoryContext()];

  if (profile) {
    lines.push(`- Profilo: ${profile.name}, peso ${profile.weight} kg, FC max ${profile.heartRateMax} bpm.`);
    lines.push(`- Obiettivi: ${profile.targetSteps} passi/giorno, ${profile.targetSleep} ore di sonno.`);
    lines.push(`- Routine: ${profile.trainingDays} giorni/settimana, split preferito "${profile.preferredSplit}".`);
    if (profile.activeDays.length > 0) {
      lines.push(`- Giorni attivi: ${profile.activeDays.join(', ')}.`);
    }
    lines.push(`- Programmazione muscolare: ${formatWeeklySchedule(profile)}.`);
  }

  if (healthData) {
    const hrvText = healthData.meta?.hrvAvailable === false ? 'HRV non disponibile' : `HRV ${healthData.hrv} ms`;
    lines.push(`- Salute attuale: ${healthData.bpm} bpm base stimati, ${hrvText}, sonno ultima notte ${healthData.sleep.total} h, passi oggi ${healthData.steps}, calorie ${healthData.calories}.`);
    lines.push(...buildRecentHealthContext(healthData, profile, recentWindow.start, recentWindow.end));
  }

  lines.push(buildRecencyContext(healthData, confirmedWorkouts, records, currentDate));
  lines.push(buildCurrentLoadContext(confirmedWorkouts));

  const routineAdherenceContext = buildRoutineAdherenceContext(profile, confirmedWorkouts, currentDate);
  if (routineAdherenceContext) {
    lines.push(routineAdherenceContext);
  }

  const pendingWorkoutContext = buildPendingWorkoutContext(workouts, currentDate);
  if (pendingWorkoutContext) {
    lines.push(pendingWorkoutContext);
  }

  const upcomingDeadlineContext = buildUpcomingDeadlineContext(profile, workouts, currentDate);
  if (upcomingDeadlineContext) {
    lines.push(upcomingDeadlineContext);
  }

  const upcomingWorkouts = workouts
    .map((workout) => ({
      workout,
      normalizedDate: normalizeDateString(workout.date, referenceDate),
    }))
    .filter((entry): entry is { workout: Workout; normalizedDate: string } => Boolean(entry.normalizedDate))
    .filter((entry) => entry.normalizedDate >= referenceDate)
    .sort((a, b) => a.normalizedDate.localeCompare(b.normalizedDate))
    .map(({ workout }) => workout)
    .slice(0, UPCOMING_WORKOUT_LIMIT);

  if (upcomingWorkouts.length > 0) {
    lines.push(`- Prossimi allenamenti: ${upcomingWorkouts.map((workout) => `${workout.date} ${workout.title || workout.type || 'workout'} (${workout.exercises.length} esercizi)`).join(' | ')}.`);
  }

  lines.push(...buildWorkoutWindowSummary(confirmedWorkouts, recentWindow.start, recentWindow.end));

  const recentWorkoutContext = buildRecentWorkoutContext(confirmedWorkouts, recentWindow.start, recentWindow.end);
  if (recentWorkoutContext) {
    lines.push(recentWorkoutContext);
  }

  const recentRecords = buildRecordWindowSummary(records, recentWindow.start, recentWindow.end);
  if (recentRecords) {
    lines.push(recentRecords);
  }

  lines.push(buildDeterministicReportFacts(
    healthData,
    profile,
    confirmedWorkouts,
    records,
    recentWindow.start,
    recentWindow.end,
  ));

  lines.push(`- Quando l'utente chiede andamento, progressi o report, dai priorita a questa finestra di ${RECENT_WINDOW_DAYS} giorni invece di usare tutto lo storico.`);
  lines.push(`- Non usare date future rispetto a ${referenceDate} e non inventare confronti non presenti nei dati.`);

  return lines.join('\n');
}

export function buildWorkoutCoachContext(workout: Workout, workoutContext: string) {
  return [
    `Contesto workout specifico:`,
    `- Allenamento del ${workout.date}.`,
    workout.title ? `- Titolo: ${workout.title}.` : null,
    workout.type ? `- Tipo: ${workout.type}.` : null,
    workoutContext,
  ]
    .filter(Boolean)
    .join('\n');
}
