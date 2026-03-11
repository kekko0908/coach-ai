import { Workout, WorkoutType } from '../types';

type WorkoutTheme = {
  badgeClass: string;
  iconClass: string;
  dotClass: string;
};

const DEFAULT_TYPE: WorkoutType = 'workout';

const WORKOUT_META: Record<WorkoutType, {
  label: string;
  defaultTitle: string;
  theme: WorkoutTheme;
}> = {
  workout: {
    label: 'Palestra',
    defaultTitle: 'Workout',
    theme: {
      badgeClass: 'bg-amber-500/15 border border-amber-400/25 text-amber-300',
      iconClass: 'bg-amber-500/10 text-amber-300',
      dotClass: 'bg-amber-400',
    },
  },
  running: {
    label: "Corsa all'aperto",
    defaultTitle: 'Corsa',
    theme: {
      badgeClass: 'bg-emerald-500/15 border border-emerald-400/25 text-emerald-300',
      iconClass: 'bg-emerald-500/10 text-emerald-300',
      dotClass: 'bg-emerald-400',
    },
  },
  football: {
    label: 'Partita di Calcio',
    defaultTitle: 'Calcio',
    theme: {
      badgeClass: 'bg-sky-500/15 border border-sky-400/25 text-sky-300',
      iconClass: 'bg-sky-500/10 text-sky-300',
      dotClass: 'bg-sky-400',
    },
  },
  cycling: {
    label: 'Ciclismo',
    defaultTitle: 'Ciclismo',
    theme: {
      badgeClass: 'bg-teal-500/15 border border-teal-400/25 text-teal-300',
      iconClass: 'bg-teal-500/10 text-teal-300',
      dotClass: 'bg-teal-400',
    },
  },
  other: {
    label: 'Altro',
    defaultTitle: 'Allenamento',
    theme: {
      badgeClass: 'bg-zinc-500/15 border border-zinc-400/20 text-zinc-300',
      iconClass: 'bg-zinc-500/10 text-zinc-300',
      dotClass: 'bg-zinc-400',
    },
  },
};

const IMPORTED_OTHER_META: Record<string, { label: string; defaultTitle: string; theme: WorkoutTheme }> = {
  camminata: {
    label: 'Camminata',
    defaultTitle: 'Camminata',
    theme: {
      badgeClass: 'bg-lime-500/15 border border-lime-400/25 text-lime-300',
      iconClass: 'bg-lime-500/10 text-lime-300',
      dotClass: 'bg-lime-400',
    },
  },
  stretching: {
    label: 'Stretching',
    defaultTitle: 'Stretching',
    theme: {
      badgeClass: 'bg-fuchsia-500/15 border border-fuchsia-400/25 text-fuchsia-300',
      iconClass: 'bg-fuchsia-500/10 text-fuchsia-300',
      dotClass: 'bg-fuchsia-400',
    },
  },
  'nuoto libero': {
    label: 'Nuoto libero',
    defaultTitle: 'Nuoto libero',
    theme: {
      badgeClass: 'bg-cyan-500/15 border border-cyan-400/25 text-cyan-300',
      iconClass: 'bg-cyan-500/10 text-cyan-300',
      dotClass: 'bg-cyan-400',
    },
  },
  esport: {
    label: 'Esport',
    defaultTitle: 'Esport',
    theme: {
      badgeClass: 'bg-zinc-500/15 border border-zinc-400/25 text-zinc-200',
      iconClass: 'bg-zinc-500/10 text-zinc-200',
      dotClass: 'bg-zinc-300',
    },
  },
};

export function normalizeWorkoutType(type?: WorkoutType): WorkoutType {
  return type && WORKOUT_META[type] ? type : DEFAULT_TYPE;
}

function normalizeSourceSportLabel(sourceSportLabel?: string) {
  return sourceSportLabel?.trim().toLowerCase() || '';
}

function getImportedMeta(sourceSportLabel?: string) {
  const normalized = normalizeSourceSportLabel(sourceSportLabel);
  return IMPORTED_OTHER_META[normalized] || null;
}

export function workoutSupportsGpx(type?: WorkoutType) {
  const normalizedType = normalizeWorkoutType(type);
  return normalizedType === 'running' || normalizedType === 'football';
}

export function getWorkoutTypeLabel(type?: WorkoutType, sourceSportLabel?: string) {
  if (normalizeWorkoutType(type) === 'other') {
    return getImportedMeta(sourceSportLabel)?.label || WORKOUT_META.other.label;
  }

  return WORKOUT_META[normalizeWorkoutType(type)].label;
}

export function getWorkoutDefaultTitle(type?: WorkoutType, sourceSportLabel?: string) {
  if (normalizeWorkoutType(type) === 'other') {
    return getImportedMeta(sourceSportLabel)?.defaultTitle || WORKOUT_META.other.defaultTitle;
  }

  return WORKOUT_META[normalizeWorkoutType(type)].defaultTitle;
}

export function getWorkoutTheme(type?: WorkoutType, sourceSportLabel?: string) {
  if (normalizeWorkoutType(type) === 'other') {
    return getImportedMeta(sourceSportLabel)?.theme || WORKOUT_META.other.theme;
  }

  return WORKOUT_META[normalizeWorkoutType(type)].theme;
}

export function resolveWorkoutTitle(workout: Pick<Workout, 'title' | 'type' | 'sourceSportLabel'>) {
  const normalizedType = normalizeWorkoutType(workout.type);
  if (normalizedType === 'football') {
    return WORKOUT_META.football.defaultTitle;
  }

  const cleanTitle = workout.title?.trim();
  if (cleanTitle) {
    return cleanTitle;
  }

  if (normalizedType === 'other') {
    return getImportedMeta(workout.sourceSportLabel)?.defaultTitle || WORKOUT_META.other.defaultTitle;
  }

  return WORKOUT_META[normalizedType].defaultTitle;
}
