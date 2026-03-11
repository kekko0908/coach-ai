import { PersonalRecord, PersonalRecordType, Workout } from '../types';
import { buildWorkoutInsights } from './workoutData';
import { getDefaultUnitForRecordType } from './recordFormatting';
import { getConfirmedWorkouts } from './workoutStatus';

export interface DerivedWorkoutRecord {
  key: string;
  label: string;
  recordType: PersonalRecordType;
  unit: string;
  value: number;
  workout: Workout;
  notes?: string;
}

function createCandidate(
  key: string,
  label: string,
  recordType: PersonalRecordType,
  unit: string,
  value: number | null | undefined,
  workout: Workout,
  notes?: string,
) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return null;
  }

  return {
    key,
    label,
    recordType,
    unit,
    value,
    workout,
    notes,
  } satisfies DerivedWorkoutRecord;
}

export function deriveWorkoutRecordCandidates(workouts: Workout[]) {
  const candidates: DerivedWorkoutRecord[] = [];

  getConfirmedWorkouts(workouts).forEach((workout) => {
    const insights = workout.gpxData || workout.tcxData ? buildWorkoutInsights(workout, {}) : null;
    const distanceKm = insights?.metrics?.distanceKm || null;
    const averageHeartRate = workout.averageHeartRate || insights?.metrics?.avgHr || null;

    const items = [
      createCandidate(
        'max-distance-session',
        'Distanza massima sessione',
        'distance',
        'km',
        distanceKm,
        workout,
      ),
      createCandidate(
        'max-duration-session',
        'Durata massima sessione',
        'duration',
        'min',
        workout.durationMinutes,
        workout,
      ),
      createCandidate(
        'max-calories-session',
        'Calorie massime sessione',
        'calories',
        'kcal',
        workout.caloriesBurned,
        workout,
      ),
      createCandidate(
        'max-average-hr-session',
        'BPM medio massimo sessione',
        'count',
        'bpm',
        averageHeartRate,
        workout,
      ),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    candidates.push(...items);
  });

  const bestByKey = new Map<string, DerivedWorkoutRecord>();
  candidates.forEach((candidate) => {
    const current = bestByKey.get(candidate.key);
    if (!current || candidate.value > current.value) {
      bestByKey.set(candidate.key, candidate);
    }
  });

  return Array.from(bestByKey.values()).sort((left, right) => right.value - left.value);
}

export function hasDerivedRecordBeenSaved(records: PersonalRecord[], derivedRecord: DerivedWorkoutRecord) {
  return records.some((record) => {
    if (record.exerciseName !== derivedRecord.label) {
      return false;
    }

    return record.entries.some((entry) =>
      entry.date === derivedRecord.workout.date &&
      entry.value === derivedRecord.value &&
      (entry.unit || record.unit || getDefaultUnitForRecordType(record.recordType)) === derivedRecord.unit,
    );
  });
}
