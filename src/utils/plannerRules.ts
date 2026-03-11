import { HealthData, UserProfile, Workout } from '../types';
import { PlannerInsight, PlannerPriority } from '../types/planner';

function getPriorityWeight(priority: PlannerPriority) {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

export function sortPlannerInsights(insights: PlannerInsight[]) {
  return [...insights].sort((left, right) => getPriorityWeight(right.priority) - getPriorityWeight(left.priority));
}

export function getSleepPenalty(healthData: HealthData, profile: UserProfile) {
  const deficit = profile.targetSleep - healthData.sleep.total;
  if (deficit >= 1.5) return 18;
  if (deficit >= 0.75) return 10;
  if (deficit >= 0.25) return 4;
  return 0;
}

export function getHrvPenalty(healthData: HealthData) {
  if (healthData.meta?.hrvAvailable === false) return 0;
  if (healthData.hrv < 35) return 16;
  if (healthData.hrv < 45) return 10;
  if (healthData.hrv < 55) return 4;
  return 0;
}

export function getRestingBpmPenalty(healthData: HealthData) {
  if (healthData.bpm >= 72) return 10;
  if (healthData.bpm >= 66) return 5;
  return 0;
}

export function isIntenseWorkout(workout: Workout) {
  if (workout.type === 'football') return true;
  if (workout.type === 'running' || workout.type === 'cycling') {
    return (workout.durationMinutes || 0) >= 45 || (workout.averageHeartRate || 0) >= 150;
  }
  if (workout.type === 'workout') {
    return workout.exercises.length >= 6 || (workout.durationMinutes || 0) >= 70;
  }

  return false;
}

export function hasLegLoad(workout: Workout) {
  const text = `${workout.title || ''} ${workout.exercises.map((exercise) => exercise.name).join(' ')}`.toLowerCase();
  return workout.type === 'football'
    || workout.type === 'running'
    || workout.type === 'cycling'
    || text.includes('gambe')
    || text.includes('legs')
    || text.includes('squat')
    || text.includes('deadlift')
    || text.includes('affondi');
}
