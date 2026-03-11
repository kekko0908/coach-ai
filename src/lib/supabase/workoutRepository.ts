import { Exercise, Workout } from '../../types';
import { setStoredWorkouts } from '../appDataStore';
import { requireUserId } from './auth';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase';
import { ensureProfileExists } from './profileRepository';
import { syncDerivedWorkoutRecordsToSupabase } from './recordsRepository';
import { getWorkoutSourceKind, isWorkoutCompleted } from '../../utils/workoutStatus';

type WorkoutRow = {
  id: string;
  workout_date: string;
  title: string | null;
  type: Workout['type'] | null;
  source_sport_code: number | null;
  source_sport_label: string | null;
  duration_minutes: number | null;
  calories_burned: number | null;
  average_heart_rate: number | null;
  metadata: {
    gpxData?: string;
    tcxData?: string;
    sourceKind?: Workout['sourceKind'];
    isCompleted?: boolean;
    completedAt?: string;
  } | null;
};

type ExerciseRow = {
  id: string;
  workout_id: string;
  exercise_order: number;
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  weight_kg: number;
};

function mapWorkoutRow(workout: WorkoutRow, exercises: ExerciseRow[]): Workout {
  return {
    id: workout.id,
    date: workout.workout_date,
    title: workout.title || undefined,
    type: workout.type || undefined,
    sourceKind: workout.metadata?.sourceKind,
    isCompleted: workout.metadata?.isCompleted,
    completedAt: workout.metadata?.completedAt,
    sourceSportCode: workout.source_sport_code || undefined,
    sourceSportLabel: workout.source_sport_label || undefined,
    durationMinutes: workout.duration_minutes || undefined,
    caloriesBurned: workout.calories_burned || undefined,
    averageHeartRate: workout.average_heart_rate || undefined,
    gpxData: workout.metadata?.gpxData,
    tcxData: workout.metadata?.tcxData,
    exercises: exercises
      .sort((left, right) => left.exercise_order - right.exercise_order)
      .map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.rest_seconds,
        weight: exercise.weight_kg,
      })),
  };
}

function buildWorkoutRows(workouts: Workout[], userId: string) {
  return workouts.map((workout) => ({
    id: workout.id,
    user_id: userId,
    workout_date: workout.date,
    title: workout.title || null,
    type: workout.type || 'workout',
    source_sport_code: workout.sourceSportCode || null,
    source_sport_label: workout.sourceSportLabel || null,
    duration_minutes: workout.durationMinutes || null,
    calories_burned: workout.caloriesBurned || null,
    average_heart_rate: workout.averageHeartRate || null,
    metadata: {
      gpxData: workout.gpxData,
      tcxData: workout.tcxData,
      sourceKind: getWorkoutSourceKind(workout),
      isCompleted: isWorkoutCompleted(workout),
      completedAt: workout.completedAt,
    },
  }));
}

function buildExerciseRows(workouts: Workout[], userId: string) {
  return workouts.flatMap((workout) =>
    workout.exercises.map((exercise, index) => ({
      id: exercise.id,
      user_id: userId,
      workout_id: workout.id,
      exercise_order: index,
      name: exercise.name,
      sets: exercise.sets,
      reps: exercise.reps,
      rest_seconds: exercise.rest,
      weight_kg: exercise.weight,
    })),
  );
}

export async function loadWorkoutsFromSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const [{ data: workoutRows, error: workoutsError }, { data: exerciseRows, error: exercisesError }] = await Promise.all([
    supabase.from('workouts').select('id,workout_date,title,type,source_sport_code,source_sport_label,duration_minutes,calories_burned,average_heart_rate,metadata').eq('user_id', userId).order('workout_date', { ascending: false }),
    supabase.from('workout_exercises').select('id,workout_id,exercise_order,name,sets,reps,rest_seconds,weight_kg').eq('user_id', userId).order('exercise_order'),
  ]);

  if (workoutsError || exercisesError) {
    throw workoutsError || exercisesError;
  }

  const exercisesByWorkoutId = new Map<string, ExerciseRow[]>();
  (exerciseRows || []).forEach((exercise) => {
    const items = exercisesByWorkoutId.get(exercise.workout_id) || [];
    items.push(exercise as ExerciseRow);
    exercisesByWorkoutId.set(exercise.workout_id, items);
  });

  const workouts = ((workoutRows || []) as WorkoutRow[]).map((workout) =>
    mapWorkoutRow(workout, exercisesByWorkoutId.get(workout.id) || []),
  );

  setStoredWorkouts(workouts);
  return workouts;
}

export async function hydrateWorkoutsFromSupabase() {
  return loadWorkoutsFromSupabase();
}

export async function saveWorkoutsToSupabase(workouts: Workout[]) {
  setStoredWorkouts(workouts);

  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const workoutRows = buildWorkoutRows(workouts, userId);
  const exerciseRows = buildExerciseRows(workouts, userId);
  const workoutIds = workouts.map((workout) => workout.id);

  if (workoutIds.length === 0) {
    const { error } = await supabase.from('workouts').delete().eq('user_id', userId);
    if (error) {
      throw error;
    }

    await syncDerivedWorkoutRecordsToSupabase([]);
    return;
  }

  const { error: upsertWorkoutsError } = await supabase
    .from('workouts')
    .upsert(workoutRows, { onConflict: 'id' });

  if (upsertWorkoutsError) {
    throw upsertWorkoutsError;
  }

  const { error: deleteRemovedError } = await supabase
    .from('workouts')
    .delete()
    .eq('user_id', userId)
    .not('id', 'in', `(${workoutIds.map((id) => `"${id}"`).join(',')})`);

  if (deleteRemovedError) {
    throw deleteRemovedError;
  }

  const { error: deleteExercisesError } = await supabase
    .from('workout_exercises')
    .delete()
    .eq('user_id', userId)
    .in('workout_id', workoutIds);

  if (deleteExercisesError) {
    throw deleteExercisesError;
  }

  if (exerciseRows.length > 0) {
    const { error: insertExercisesError } = await supabase
      .from('workout_exercises')
      .insert(exerciseRows);

    if (insertExercisesError) {
      throw insertExercisesError;
    }
  }

  await syncDerivedWorkoutRecordsToSupabase(workouts);
}
