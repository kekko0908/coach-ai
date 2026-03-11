import { HealthData, UserProfile, Workout } from '../types';
import { ReadinessFactor } from '../types/planner';
import { getHrvPenalty, getRestingBpmPenalty, getSleepPenalty, isIntenseWorkout } from './plannerRules';
import { estimateFatigueGroups } from './fatigue';

function toIsoDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getWorkoutForDate(workouts: Workout[], dateIso: string) {
  return workouts.find((workout) => workout.date === dateIso);
}

function getRecoveryProxyPenalty(healthData: HealthData) {
  let penalty = 0;
  const sleepEfficiency = healthData.sleep.efficiency ?? 0;

  if (sleepEfficiency > 0) {
    if (sleepEfficiency < 78) {
      penalty += 10;
    } else if (sleepEfficiency < 86) {
      penalty += 5;
    }
  }

  const bpmTrend = healthData.trends.bpm ?? [];
  if (bpmTrend.length >= 3) {
    const currentBpm = bpmTrend[bpmTrend.length - 1].value;
    const baselineSlice = bpmTrend.slice(Math.max(0, bpmTrend.length - 8), -1);
    if (baselineSlice.length > 0) {
      const baseline = baselineSlice.reduce((sum, point) => sum + point.value, 0) / baselineSlice.length;
      const delta = currentBpm - baseline;
      if (delta >= 8) {
        penalty += 8;
      } else if (delta >= 5) {
        penalty += 5;
      } else if (delta >= 3) {
        penalty += 2;
      }
    }
  }

  return Math.min(16, penalty);
}

export function calculateReadiness({
  profile,
  healthData,
  workouts,
  currentDate = new Date(),
}: {
  profile: UserProfile;
  healthData: HealthData;
  workouts: Workout[];
  currentDate?: Date;
}) {
  const yesterdayWorkout = getWorkoutForDate(workouts, toIsoDate(addDays(currentDate, -1)));
  const fatigueGroups = estimateFatigueGroups({ workouts, currentDate });
  const topFatigue = fatigueGroups[0];
  const isHrvAvailable = healthData.meta?.hrvAvailable !== false;
  const sleepPenalty = getSleepPenalty(healthData, profile);
  const hrvPenalty = getHrvPenalty(healthData);
  const recoveryProxyPenalty = isHrvAvailable ? 0 : getRecoveryProxyPenalty(healthData);
  const bpmPenalty = getRestingBpmPenalty(healthData);
  const recentLoadPenalty = yesterdayWorkout && isIntenseWorkout(yesterdayWorkout) ? 8 : 0;
  const fatiguePenalty = topFatigue && topFatigue.level === 'high'
    ? 8
    : topFatigue && topFatigue.level === 'moderate'
      ? 4
      : 0;

  const factors: ReadinessFactor[] = [
    {
      id: 'sleep',
      label: 'Sonno',
      value: Number(healthData.sleep.total.toFixed(1)),
      impact: -sleepPenalty,
    },
    {
      id: 'hrv',
      label: isHrvAvailable ? 'HRV' : 'Recupero stimato',
      value: isHrvAvailable ? healthData.hrv : healthData.sleep.efficiency ?? healthData.bpm,
      impact: -(isHrvAvailable ? hrvPenalty : recoveryProxyPenalty),
    },
    {
      id: 'resting-bpm',
      label: 'BPM riposo',
      value: healthData.bpm,
      impact: -bpmPenalty,
    },
    {
      id: 'recent-load',
      label: 'Carico recente',
      value: recentLoadPenalty > 0 ? 1 : 0,
      impact: -recentLoadPenalty,
    },
    {
      id: 'muscle-fatigue',
      label: topFatigue ? `Fatica ${topFatigue.label}` : 'Fatica',
      value: topFatigue?.score || 0,
      impact: -fatiguePenalty,
    },
  ];

  const readinessScore = clampScore(
    84 - sleepPenalty - (isHrvAvailable ? hrvPenalty : recoveryProxyPenalty) - bpmPenalty - recentLoadPenalty - fatiguePenalty,
  );

  return {
    readinessScore,
    factors,
    fatigueGroups,
  };
}
