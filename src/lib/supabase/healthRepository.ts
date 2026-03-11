import { HealthData } from '../../types';
import { setStoredHealthData } from '../appDataStore';
import { requireUserId } from './auth';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase';
import { ensureProfileExists } from './profileRepository';

type DailyRow = {
  id: string;
  day: string;
  bpm_baseline: number | null;
  hrv_ms: number | null;
  steps: number | null;
  calories: number | null;
  sleep_deep_hours: number | null;
  sleep_core_hours: number | null;
  sleep_rem_hours: number | null;
  sleep_total_hours: number | null;
  sleep_awake_hours: number | null;
  sleep_start: string | null;
  sleep_stop: string | null;
  sleep_efficiency: number | null;
  source: 'json' | 'csv-folder' | 'manual';
  imported_at: string | null;
  hrv_available: boolean;
  notes: string[] | null;
};

type SleepTimelineRow = {
  occurred_at: string;
  stage: 'deep' | 'core' | 'rem' | 'awake';
  stage_label: string | null;
  stage_value: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
};

type HeartRateIntradayRow = {
  occurred_at: string;
  heart_rate: number;
};

type StepsHourlyRow = {
  hour_of_day: number;
  steps: number;
};

function formatChartDate(date: string) {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatIsoDate(value: Date) {
  return value.toISOString().split('T')[0];
}

function normalizeTrendDate(value: string, referenceDate: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const chartMatch = trimmed.match(/^(\d{2})\/(\d{2})$/);
  if (chartMatch) {
    const [, day, month] = chartMatch;
    const reference = parseIsoDate(referenceDate);
    const year = isValidDate(reference) ? reference.getFullYear() : new Date().getFullYear();
    let candidate = parseIsoDate(`${year}-${month}-${day}`);

    if (!isValidDate(candidate)) {
      return null;
    }

    if (candidate > reference) {
      candidate = parseIsoDate(`${year - 1}-${month}-${day}`);
    }

    return formatIsoDate(candidate);
  }

  const parsed = new Date(trimmed);
  return isValidDate(parsed) ? formatIsoDate(parsed) : null;
}

function buildDailyRows(healthData: HealthData, userId: string) {
  const referenceDate = healthData.details?.latestDate || new Date().toISOString().split('T')[0];
  const dailyMap = new Map<string, Partial<DailyRow>>();

  const ensureDay = (day: string) => {
    const existing = dailyMap.get(day) || {};
    dailyMap.set(day, existing);
    return existing;
  };

  healthData.trends.sleep.forEach((point) => {
    const day = normalizeTrendDate(point.date, referenceDate);
    if (!day) return;
    ensureDay(day).sleep_total_hours = point.value;
  });

  healthData.trends.steps.forEach((point) => {
    const day = normalizeTrendDate(point.date, referenceDate);
    if (!day) return;
    ensureDay(day).steps = point.value;
  });

  (healthData.trends.bpm || []).forEach((point) => {
    const day = normalizeTrendDate(point.date, referenceDate);
    if (!day) return;
    ensureDay(day).bpm_baseline = point.value;
  });

  (healthData.trends.calories || []).forEach((point) => {
    const day = normalizeTrendDate(point.date, referenceDate);
    if (!day) return;
    ensureDay(day).calories = point.value;
  });

  const latestDate = healthData.details?.latestDate || referenceDate;
  const latestDay = ensureDay(latestDate);
  latestDay.sleep_deep_hours = healthData.sleep.deep;
  latestDay.sleep_core_hours = healthData.sleep.core;
  latestDay.sleep_rem_hours = healthData.sleep.rem;
  latestDay.sleep_total_hours = healthData.sleep.total;
  latestDay.sleep_awake_hours = healthData.sleep.awake ?? null;
  latestDay.sleep_start = healthData.sleep.start ?? null;
  latestDay.sleep_stop = healthData.sleep.stop ?? null;
  latestDay.sleep_efficiency = healthData.sleep.efficiency ?? null;
  latestDay.steps = healthData.steps;
  latestDay.calories = healthData.calories;
  latestDay.bpm_baseline = healthData.bpm;
  latestDay.hrv_ms = healthData.meta?.hrvAvailable === false ? null : healthData.hrv;

  return Array.from(dailyMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, row]) => ({
      user_id: userId,
      day,
      bpm_baseline: row.bpm_baseline ?? null,
      hrv_ms: row.hrv_ms ?? null,
      steps: row.steps ?? null,
      calories: row.calories ?? null,
      sleep_deep_hours: row.sleep_deep_hours ?? null,
      sleep_core_hours: row.sleep_core_hours ?? null,
      sleep_rem_hours: row.sleep_rem_hours ?? null,
      sleep_total_hours: row.sleep_total_hours ?? null,
      sleep_awake_hours: row.sleep_awake_hours ?? null,
      sleep_start: row.sleep_start ?? null,
      sleep_stop: row.sleep_stop ?? null,
      sleep_efficiency: row.sleep_efficiency ?? null,
      source: healthData.meta?.source || 'manual',
      imported_at: healthData.meta?.importedAt || new Date().toISOString(),
      hrv_available: healthData.meta?.hrvAvailable !== false,
      notes: healthData.meta?.notes || [],
    }));
}

function toOccurredAt(day: string, time: string) {
  const safeTime = /^\d{2}:\d{2}/.test(time) ? `${time}:00` : '00:00:00';
  return `${day}T${safeTime}`;
}

async function createImportBatch(healthData: HealthData) {
  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const { data, error } = await supabase
    .from('import_batches')
    .insert({
      user_id: userId,
      source_type: healthData.meta?.source === 'csv-folder' ? 'csv-folder' : 'json',
      source_name: healthData.meta?.source === 'csv-folder' ? 'dashboard-csv-import' : 'dashboard-json-import',
      status: 'completed',
      metadata: {
        coveredDays: healthData.meta?.coveredDays || 0,
        importedAt: healthData.meta?.importedAt || new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

export async function saveHealthDataToSupabase(healthData: HealthData) {
  setStoredHealthData(healthData);

  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const importBatchId = await createImportBatch(healthData);
  const userId = await ensureProfileExists();
  const dailyRows = buildDailyRows(healthData, userId).map((row) => ({
    ...row,
    import_batch_id: importBatchId,
  }));

  const { data: upsertedRows, error: dailyError } = await supabase
    .from('health_daily')
    .upsert(dailyRows, { onConflict: 'user_id,day' })
    .select('id,day');

  if (dailyError) {
    throw dailyError;
  }

  const latestDate = healthData.details?.latestDate || dailyRows.at(-1)?.day;
  if (!latestDate) {
    return;
  }

  const latestDailyId = upsertedRows?.find((row) => row.day === latestDate)?.id as string | undefined;
  if (!latestDailyId) {
    return;
  }

  await Promise.all([
    supabase.from('sleep_timeline_points').delete().eq('health_daily_id', latestDailyId),
    supabase.from('heart_rate_intraday_points').delete().eq('health_daily_id', latestDailyId),
    supabase.from('steps_hourly_points').delete().eq('health_daily_id', latestDailyId),
  ]);

  const sleepTimelineRows = (healthData.details?.sleepTimeline || []).map((point) => ({
    user_id: userId,
    health_daily_id: latestDailyId,
    occurred_at: toOccurredAt(latestDate, point.time),
    stage: point.stage.toLowerCase() === 'profondo' ? 'deep'
      : point.stage.toLowerCase() === 'rem' ? 'rem'
      : point.stage.toLowerCase() === 'sveglio' ? 'awake'
      : 'core',
    stage_label: point.stage,
    stage_value: point.stageValue,
    heart_rate: point.heartRate,
    respiratory_rate: point.respiratoryRate,
  }));

  const heartRateRows = (healthData.details?.heartRateSeries || []).map((point) => ({
    user_id: userId,
    health_daily_id: latestDailyId,
    occurred_at: toOccurredAt(latestDate, point.time),
    heart_rate: point.value,
  }));

  const stepsRows = (healthData.details?.stepsByHour || []).map((point) => ({
    user_id: userId,
    health_daily_id: latestDailyId,
    hour_of_day: Number(point.hour.slice(0, 2)),
    steps: point.value,
  }));

  if (sleepTimelineRows.length > 0) {
    const { error } = await supabase.from('sleep_timeline_points').insert(sleepTimelineRows);
    if (error) {
      throw error;
    }
  }

  if (heartRateRows.length > 0) {
    const { error } = await supabase.from('heart_rate_intraday_points').insert(heartRateRows);
    if (error) {
      throw error;
    }
  }

  if (stepsRows.length > 0) {
    const { error } = await supabase.from('steps_hourly_points').insert(stepsRows);
    if (error) {
      throw error;
    }
  }
}

export async function loadHealthDataFromSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const { data: dailyRows, error: dailyError } = await supabase
    .from('health_daily')
    .select('id,day,bpm_baseline,hrv_ms,steps,calories,sleep_deep_hours,sleep_core_hours,sleep_rem_hours,sleep_total_hours,sleep_awake_hours,sleep_start,sleep_stop,sleep_efficiency,source,imported_at,hrv_available,notes')
    .eq('user_id', userId)
    .order('day', { ascending: true });

  if (dailyError) {
    throw dailyError;
  }

  if (!dailyRows || dailyRows.length === 0) {
    return null;
  }

  const typedRows = dailyRows as DailyRow[];
  const latestRow = typedRows[typedRows.length - 1];

  const [{ data: sleepTimelineRows, error: sleepError }, { data: heartRateRows, error: heartError }, { data: stepsRows, error: stepsError }] = await Promise.all([
    supabase.from('sleep_timeline_points').select('occurred_at,stage,stage_label,stage_value,heart_rate,respiratory_rate').eq('health_daily_id', latestRow.id).order('occurred_at'),
    supabase.from('heart_rate_intraday_points').select('occurred_at,heart_rate').eq('health_daily_id', latestRow.id).order('occurred_at'),
    supabase.from('steps_hourly_points').select('hour_of_day,steps').eq('health_daily_id', latestRow.id).order('hour_of_day'),
  ]);

  if (sleepError || heartError || stepsError) {
    throw sleepError || heartError || stepsError;
  }

  const healthData: HealthData = {
    bpm: latestRow.bpm_baseline || 0,
    sleep: {
      deep: latestRow.sleep_deep_hours || 0,
      core: latestRow.sleep_core_hours || 0,
      rem: latestRow.sleep_rem_hours || 0,
      total: latestRow.sleep_total_hours || 0,
      awake: latestRow.sleep_awake_hours || undefined,
      start: latestRow.sleep_start || undefined,
      stop: latestRow.sleep_stop || undefined,
      efficiency: latestRow.sleep_efficiency || undefined,
    },
    steps: latestRow.steps || 0,
    hrv: latestRow.hrv_ms || 0,
    calories: Math.round(latestRow.calories || 0),
    trends: {
      sleep: typedRows
        .filter((row) => row.sleep_total_hours !== null)
        .map((row) => ({ date: formatChartDate(row.day), value: row.sleep_total_hours as number })),
      steps: typedRows
        .filter((row) => row.steps !== null)
        .map((row) => ({ date: formatChartDate(row.day), value: row.steps as number })),
      bpm: typedRows
        .filter((row) => row.bpm_baseline !== null)
        .map((row) => ({ date: formatChartDate(row.day), value: row.bpm_baseline as number })),
      calories: typedRows
        .filter((row) => row.calories !== null)
        .map((row) => ({ date: formatChartDate(row.day), value: Math.round(row.calories as number) })),
    },
    details: {
      latestDate: latestRow.day,
      sleepStages: [
        { stage: 'deep', label: 'Profondo', minutes: Math.round((latestRow.sleep_deep_hours || 0) * 60), hours: latestRow.sleep_deep_hours || 0 },
        { stage: 'core', label: 'Leggero', minutes: Math.round((latestRow.sleep_core_hours || 0) * 60), hours: latestRow.sleep_core_hours || 0 },
        { stage: 'rem', label: 'REM', minutes: Math.round((latestRow.sleep_rem_hours || 0) * 60), hours: latestRow.sleep_rem_hours || 0 },
        { stage: 'awake', label: 'Sveglio', minutes: Math.round((latestRow.sleep_awake_hours || 0) * 60), hours: latestRow.sleep_awake_hours || 0 },
      ],
      sleepTimeline: ((sleepTimelineRows || []) as SleepTimelineRow[]).map((row) => ({
        time: row.occurred_at.slice(11, 16),
        stage: row.stage_label || row.stage,
        stageValue: row.stage_value || 0,
        heartRate: row.heart_rate,
        respiratoryRate: row.respiratory_rate,
      })),
      heartRateSeries: ((heartRateRows || []) as HeartRateIntradayRow[]).map((row) => ({
        time: row.occurred_at.slice(11, 16),
        value: row.heart_rate,
      })),
      stepsByHour: ((stepsRows || []) as StepsHourlyRow[]).map((row) => ({
        hour: `${String(row.hour_of_day).padStart(2, '0')}:00`,
        value: row.steps,
      })),
    },
    meta: {
      source: latestRow.source === 'manual' ? 'json' : latestRow.source,
      importedAt: latestRow.imported_at || new Date().toISOString(),
      coveredDays: typedRows.length,
      hrvAvailable: latestRow.hrv_available,
      notes: latestRow.notes || [],
    },
  };

  setStoredHealthData(healthData);
  return healthData;
}

export async function hydrateHealthDataFromSupabase() {
  return loadHealthDataFromSupabase();
}
