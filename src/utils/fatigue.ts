import { Workout } from '../types';
import { FatigueGroup, FatigueGroupId, FatigueLevel } from '../types/planner';
import { getConfirmedWorkouts } from './workoutStatus';

const FATIGUE_GROUP_LABELS: Record<FatigueGroupId, string> = {
  legs: 'Legs',
  push: 'Push',
  pull: 'Pull',
  core: 'Core',
  cardio: 'Cardio',
};

function toIsoDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function diffDays(fromIso: string, toIso: string) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function getDecayMultiplier(daysAgo: number) {
  if (daysAgo <= 0) return 1;
  if (daysAgo === 1) return 0.82;
  if (daysAgo === 2) return 0.66;
  if (daysAgo === 3) return 0.5;
  if (daysAgo <= 5) return 0.32;
  return 0.18;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getFatigueLevel(score: number): FatigueLevel {
  if (score >= 65) return 'high';
  if (score >= 35) return 'moderate';
  return 'low';
}

function getWorkoutText(workout: Workout) {
  return `${workout.title || ''} ${workout.exercises.map((exercise) => exercise.name || '').join(' ')}`.toLowerCase();
}

function getWorkoutGroupLoads(workout: Workout): Record<FatigueGroupId, number> {
  const text = getWorkoutText(workout);
  const loads: Record<FatigueGroupId, number> = {
    legs: 0,
    push: 0,
    pull: 0,
    core: 0,
    cardio: 0,
  };

  if (workout.type === 'football') {
    loads.legs += 34;
    loads.cardio += 30;
    loads.core += 12;
  }

  if (workout.type === 'running') {
    loads.legs += 24;
    loads.cardio += 28;
    loads.core += 6;
  }

  if (workout.type === 'cycling') {
    loads.legs += 22;
    loads.cardio += 24;
    loads.core += 4;
  }

  if (workout.type === 'workout') {
    const exerciseCount = Math.max(workout.exercises.length, 1);
    workout.exercises.forEach((exercise) => {
      const name = (exercise.name || '').toLowerCase();
      const base = Math.max(6, Math.min(16, exercise.sets * 2 + (exercise.weight > 0 ? 2 : 0)));

      if (/squat|leg|affondi|lunge|stacco|deadlift|pressa|calf|hamstring|quad/.test(name)) {
        loads.legs += base;
      }
      if (/panca|chest|push|dip|spinte|shoulder|military|overhead|tricip/.test(name)) {
        loads.push += base;
      }
      if (/row|rematore|lat|pull|trazioni|bicip|pulldown/.test(name)) {
        loads.pull += base;
      }
      if (/core|plank|ab|crunch|sit up|russian twist/.test(name)) {
        loads.core += base * 0.8;
      }
    });

    if (exerciseCount >= 6) {
      loads.cardio += 6;
    }
  }

  if (/gambe|legs/.test(text)) loads.legs += 10;
  if (/petto|spalle|tricip|push/.test(text)) loads.push += 8;
  if (/dorso|schiena|pull|bicip/.test(text)) loads.pull += 8;
  if (/core|addom/.test(text)) loads.core += 6;

  return loads;
}

export function estimateFatigueGroups({
  workouts,
  currentDate = new Date(),
}: {
  workouts: Workout[];
  currentDate?: Date;
}): FatigueGroup[] {
  const todayIso = toIsoDate(currentDate);
  const totals: Record<FatigueGroupId, number> = {
    legs: 0,
    push: 0,
    pull: 0,
    core: 0,
    cardio: 0,
  };

  getConfirmedWorkouts(workouts).forEach((workout) => {
    const daysAgo = diffDays(workout.date, todayIso);
    if (daysAgo < 0 || daysAgo > 7) {
      return;
    }

    const decay = getDecayMultiplier(daysAgo);
    const loads = getWorkoutGroupLoads(workout);

    (Object.keys(loads) as FatigueGroupId[]).forEach((groupId) => {
      totals[groupId] += loads[groupId] * decay;
    });
  });

  return (Object.keys(totals) as FatigueGroupId[]).map((groupId) => {
    const score = clampScore(totals[groupId]);
    const level = getFatigueLevel(score);

    return {
      id: groupId,
      label: FATIGUE_GROUP_LABELS[groupId],
      score,
      level,
      reason: level === 'high'
        ? 'Carico recente elevato nei giorni vicini.'
        : level === 'moderate'
          ? 'Carico presente, ma ancora gestibile.'
          : 'Bassa fatica residua negli ultimi giorni.',
    };
  }).sort((left, right) => right.score - left.score);
}
