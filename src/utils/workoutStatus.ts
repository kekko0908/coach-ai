import { Workout, WorkoutSourceKind } from '../types';

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

function inferSourceKind(workout: Workout): WorkoutSourceKind {
  if (workout.sourceSportCode || workout.sourceSportLabel) {
    return 'imported';
  }

  if (workout.gpxData || workout.tcxData) {
    return 'imported';
  }

  return 'manual';
}

function inferManualCompletion(workout: Workout) {
  const todayIso = getTodayLocalIso();

  if (typeof workout.isCompleted === 'boolean') {
    return workout.isCompleted;
  }

  if (workout.date < todayIso) {
    return true;
  }

  return false;
}

export function getWorkoutSourceKind(workout: Workout): WorkoutSourceKind {
  return workout.sourceKind || inferSourceKind(workout);
}

export function isManualWorkout(workout: Workout) {
  return getWorkoutSourceKind(workout) === 'manual';
}

export function isWorkoutCompleted(workout: Workout) {
  if (!isManualWorkout(workout)) {
    return true;
  }

  return inferManualCompletion(workout);
}

export function isWorkoutPlanned(workout: Workout) {
  return isManualWorkout(workout) && !isWorkoutCompleted(workout);
}

export function getConfirmedWorkouts(workouts: Workout[]) {
  return workouts.filter((workout) => isWorkoutCompleted(workout));
}

