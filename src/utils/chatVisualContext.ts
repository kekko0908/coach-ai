import { HealthData, Workout, WorkoutType } from '../types';
import { isWorkoutCompleted } from './workoutStatus';

const WORKOUT_QUERY_PATTERN = /\b(allenament[oi]|workout|sessione|scheda|corsa|running|run|calcio|partita|bike|bici|cycling|ciclismo)\b/i;
const STATS_QUERY_PATTERN = /\b(statistiche|statistica|dati|numeri|metriche|grafici?|trend|andamento|progress|riepilog|report|resoconto|analisi)\b/i;
const MONTH_NAME_MAP: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

export type ChatVisualContext =
  | {
      kind: 'overview';
      prompt: string | null;
      today: string;
      latestWorkout: Workout | null;
      latestHealthDate: string | null;
      windowDays: number;
      startDate: string;
      endDate: string;
    }
  | {
      kind: 'workout';
      prompt: string;
      today: string;
      workout: Workout;
      requestedDate: string | null;
      matchedBy: 'date' | 'type' | 'latest';
    }
  | {
      kind: 'missing-workout';
      prompt: string;
      today: string;
      requestedDate: string | null;
      latestWorkout: Workout | null;
    }
  | {
      kind: 'trend';
      prompt: string;
      today: string;
      windowDays: number;
      startDate: string;
      endDate: string;
      focus: 'recovery' | 'activity' | 'performance';
      latestWorkout: Workout | null;
      title: string;
      explicitRange: boolean;
    };

function getTodayLocalIso() {
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

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
}

function getStartOfWeekIso(value: string) {
  const date = parseIsoDate(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return formatIsoDate(date);
}

function buildWindow(endDate: string, windowDays: number) {
  return {
    startDate: shiftIsoDate(endDate, -(windowDays - 1)),
    endDate,
  };
}

function normalizeWorkouts(workouts: Workout[]) {
  return [...workouts]
    .filter((workout) => isWorkoutCompleted(workout))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function inferWorkoutTypeFromPrompt(prompt: string): WorkoutType | null {
  const normalized = prompt.toLowerCase();
  if (/\bcalcio|partita\b/.test(normalized)) {
    return 'football';
  }
  if (/\bcorsa|running|run\b/.test(normalized)) {
    return 'running';
  }
  if (/\bbici|bike|cycling|ciclismo\b/.test(normalized)) {
    return 'cycling';
  }
  if (/\bpalestra|scheda|workout\b/.test(normalized)) {
    return 'workout';
  }
  return null;
}

function parseExplicitDate(prompt: string, todayIso: string) {
  const isoMatch = prompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const slashMatch = prompt.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const [, dayText, monthText, yearText] = slashMatch;
    const fallbackYear = parseIsoDate(todayIso).getFullYear();
    const year = yearText
      ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
      : fallbackYear;
    const month = Number(monthText);
    const day = Number(dayText);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
    }
  }

  const namedMonthMatch = prompt.toLowerCase().match(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\b/);
  if (namedMonthMatch) {
    const [, dayText, monthName, yearText] = namedMonthMatch;
    const fallbackYear = parseIsoDate(todayIso).getFullYear();
    const year = yearText ? Number(yearText) : fallbackYear;
    const month = MONTH_NAME_MAP[monthName];
    const day = Number(dayText);
    return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
  }

  return null;
}

function parseRequestedDate(prompt: string, todayIso: string) {
  const explicitDate = parseExplicitDate(prompt, todayIso);
  if (explicitDate) {
    return explicitDate;
  }

  const normalized = prompt.toLowerCase();
  if (/\boggi\b/.test(normalized)) {
    return todayIso;
  }
  if (/\bieri\b/.test(normalized)) {
    return shiftIsoDate(todayIso, -1);
  }
  if (/\bdomani\b/.test(normalized)) {
    return shiftIsoDate(todayIso, 1);
  }

  return null;
}

function parseRequestedWindow(prompt: string, todayIso: string) {
  const normalized = prompt.toLowerCase();
  const rangeMatch = normalized.match(/\bdal\s+(.+?)\s+al\s+(.+?)(?=$|\s+(?:con|per|che|dove|e)\b)/);

  if (rangeMatch) {
    const [, startText, endText] = rangeMatch;
    const startDate = parseExplicitDate(startText.trim(), todayIso);
    const endDate = parseExplicitDate(endText.trim(), todayIso);

    if (startDate && endDate) {
      const normalizedStart = startDate <= endDate ? startDate : endDate;
      const normalizedEnd = startDate <= endDate ? endDate : startDate;
      const start = parseIsoDate(normalizedStart);
      const end = parseIsoDate(normalizedEnd);
      const windowDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);

      return {
        windowDays,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        explicitRange: true,
      };
    }
  }

  if (/\bieri\b/.test(normalized) || /\boggi\b/.test(normalized)) {
    const endDate = parseRequestedDate(prompt, todayIso) || todayIso;
    return {
      windowDays: 1,
      ...buildWindow(endDate, 1),
      explicitRange: false,
    };
  }

  if (/\bultim[oi]\s+14\s+giorni\b/.test(normalized)) {
    return {
      windowDays: 14,
      ...buildWindow(todayIso, 14),
      explicitRange: false,
    };
  }

  if (/\bultim[oi]\s+30\s+giorni\b|\bultimo mese\b|\bnell'?ultimo mese\b|\bmese\b/.test(normalized)) {
    return {
      windowDays: 30,
      ...buildWindow(todayIso, 30),
      explicitRange: false,
    };
  }

  if (/\bsettimana scorsa\b|\bscorsa settimana\b/.test(normalized)) {
    const currentWeekStart = getStartOfWeekIso(todayIso);
    const endDate = shiftIsoDate(currentWeekStart, -1);
    return {
      windowDays: 7,
      startDate: shiftIsoDate(endDate, -6),
      endDate,
      explicitRange: true,
    };
  }

  if (/\bsettimanal[ei]\b|\bsettimana\b/.test(normalized) && !/\bultim[oi]\s+7\s+giorni\b/.test(normalized)) {
    const startDate = getStartOfWeekIso(todayIso);
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(todayIso);
    return {
      windowDays: Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1),
      startDate,
      endDate: todayIso,
      explicitRange: false,
    };
  }

  if (/\bultim[oi]\s+7\s+giorni\b/.test(normalized)) {
    return {
      windowDays: 7,
      ...buildWindow(todayIso, 7),
      explicitRange: false,
    };
  }

  return {
    windowDays: 14,
    ...buildWindow(todayIso, 14),
    explicitRange: false,
  };
}

function inferTrendFocus(prompt: string): 'recovery' | 'activity' | 'performance' {
  const normalized = prompt.toLowerCase();
  if (/\bsonno|hrv|recuper|bpm|stress\b/.test(normalized)) {
    return 'recovery';
  }
  if (/\bpassi|attivit|movimento|cammin|calorie\b/.test(normalized)) {
    return 'activity';
  }
  return 'performance';
}

function inferTrendTitle(prompt: string, window: ReturnType<typeof parseRequestedWindow>) {
  const normalized = prompt.toLowerCase();

  if (/\bsettimana scorsa\b/.test(normalized)) {
    return 'Riepilogo settimana scorsa';
  }
  if (/\bquesta settimana\b/.test(normalized)) {
    return 'Riepilogo settimana corrente';
  }
  if (/\bsettimanal[ei]\b|\bsettimana\b/.test(normalized) && !/\bultim[oi]\s+7\s+giorni\b/.test(normalized)) {
    return 'Riepilogo settimana corrente';
  }
  if (/\briepilog|report|resoconto\b/.test(normalized)) {
    return window.explicitRange ? 'Riepilogo periodo richiesto' : `Riepilogo ${window.windowDays} giorni`;
  }
  if (/\bandamento|trend|analisi\b/.test(normalized)) {
    return window.explicitRange ? 'Analisi periodo richiesto' : `Trend ${window.windowDays} giorni`;
  }
  return window.explicitRange ? 'Panoramica periodo richiesto' : `Trend ${window.windowDays} giorni`;
}

export function resolveChatVisualContext(
  prompt: string | null,
  healthData: HealthData | null,
  workouts: Workout[],
): ChatVisualContext {
  const today = getTodayLocalIso();
  const normalizedWorkouts = normalizeWorkouts(workouts);
  const latestWorkout = normalizedWorkouts[0] || null;
  const latestHealthDate = healthData?.details?.latestDate || null;

  if (!prompt?.trim()) {
    const defaultWindow = buildWindow(today, 7);
    return {
      kind: 'overview',
      prompt: null,
      today,
      latestWorkout,
      latestHealthDate,
      windowDays: 7,
      startDate: defaultWindow.startDate,
      endDate: defaultWindow.endDate,
    };
  }

  const trimmedPrompt = prompt.trim();
  const requestedDate = parseRequestedDate(trimmedPrompt, today);
  const requestedType = inferWorkoutTypeFromPrompt(trimmedPrompt);
  const mentionsWorkout = WORKOUT_QUERY_PATTERN.test(trimmedPrompt);
  const mentionsStats = STATS_QUERY_PATTERN.test(trimmedPrompt);
  const requestedWindow = parseRequestedWindow(trimmedPrompt, today);

  if (mentionsStats) {
    return {
      kind: 'trend',
      prompt: trimmedPrompt,
      today,
      latestWorkout,
      windowDays: requestedWindow.windowDays,
      startDate: requestedWindow.startDate,
      endDate: requestedWindow.endDate,
      focus: inferTrendFocus(trimmedPrompt),
      title: inferTrendTitle(trimmedPrompt, requestedWindow),
      explicitRange: requestedWindow.explicitRange,
    };
  }

  if (mentionsWorkout || requestedDate || requestedType) {
    if (requestedDate) {
      const workoutByDate = normalizedWorkouts.find((workout) => workout.date === requestedDate) || null;
      if (workoutByDate) {
        return {
          kind: 'workout',
          prompt: trimmedPrompt,
          today,
          workout: workoutByDate,
          requestedDate,
          matchedBy: 'date',
        };
      }

      return {
        kind: 'missing-workout',
        prompt: trimmedPrompt,
        today,
        requestedDate,
        latestWorkout,
      };
    }

    if (requestedType) {
      const workoutByType = normalizedWorkouts.find((workout) => workout.type === requestedType) || null;
      if (workoutByType) {
        return {
          kind: 'workout',
          prompt: trimmedPrompt,
          today,
          workout: workoutByType,
          requestedDate: null,
          matchedBy: 'type',
        };
      }
    }

    if (latestWorkout) {
      return {
        kind: 'workout',
        prompt: trimmedPrompt,
        today,
        workout: latestWorkout,
        requestedDate: null,
        matchedBy: 'latest',
      };
    }

    return {
      kind: 'missing-workout',
      prompt: trimmedPrompt,
      today,
      requestedDate: requestedDate || null,
      latestWorkout,
    };
  }

  if (mentionsStats) {
    return {
      kind: 'trend',
      prompt: trimmedPrompt,
      today,
      latestWorkout,
      windowDays: requestedWindow.windowDays,
      startDate: requestedWindow.startDate,
      endDate: requestedWindow.endDate,
      focus: inferTrendFocus(trimmedPrompt),
      title: inferTrendTitle(trimmedPrompt, requestedWindow),
      explicitRange: requestedWindow.explicitRange,
    };
  }

  const defaultWindow = buildWindow(today, 7);
  return {
    kind: 'overview',
    prompt: trimmedPrompt,
    today,
    latestWorkout,
    latestHealthDate,
    windowDays: 7,
    startDate: defaultWindow.startDate,
    endDate: defaultWindow.endDate,
  };
}
