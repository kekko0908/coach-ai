import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Calendar as CalendarIcon, Dumbbell, Loader2, Sparkles, Wand2, PencilLine, Save, X, Plus, Trash2 } from 'lucide-react';
import { HealthData, UserProfile, Workout } from '../types';
import { PlannerAiDayPlan, PlannerAiExercise, PlannerAiPlan } from '../types/planner';
import { adaptAiPlannerDay, generateAiPlannerPlan, generatePlannerOutput } from '../utils/plannerEngine';
import { getAiConnectionHint } from '../utils/aiClient';
import { getErrorMessage } from '../utils/errorMessage';
import { ExerciseMedia, fetchExerciseMedia } from '../utils/exerciseMedia';
import { readLocalJson, writeLocalJson } from '../utils/storage';
import { hydrateProfileFromSupabase } from '../lib/supabase/profileRepository';
import { hydrateWorkoutsFromSupabase, saveWorkoutsToSupabase } from '../lib/supabase/workoutRepository';
import { DEFAULT_HEART_RATE_ZONES } from '../utils/heartRateZones';
import { createAppUuid } from '../utils/uuid';
import { getWorkoutSourceKind, isManualWorkout } from '../utils/workoutStatus';

interface CoachPlannerProps {
  healthData: HealthData | null;
}

const AI_PLANNER_STORAGE_KEY = 'fitsync_coach_planner_ai_v1';

function buildAiPlannerCacheContextKey(
  healthData: HealthData | null,
  profile: UserProfile,
  workouts: Workout[],
) {
  const latestHealthDate = healthData?.details?.latestDate || 'no-health';
  const latestWorkoutDate = workouts[0]?.date || 'no-workouts';

  return [
    latestHealthDate,
    profile.preferredSplit,
    profile.trainingDays,
    workouts.length,
    latestWorkoutDate,
  ].join('|');
}

function getExerciseTutorialUrl(exerciseName: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exerciseName} exercise tutorial`)}`;
}

function parseNumericValue(value: string, fallback: number) {
  const match = value.match(/\d+/);
  if (!match) {
    return fallback;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPlannerExercisesForWorkout(exercises: PlannerAiExercise[]) {
  return exercises.map((exercise) => ({
    id: createAppUuid(),
    name: exercise.name,
    sets: parseNumericValue(exercise.sets, 3),
    reps: parseNumericValue(exercise.reps, 10),
    rest: 75,
    weight: 0,
  }));
}

function buildWorkoutTypeFromPlannerDay(day: PlannerAiDayPlan): Workout['type'] {
  if (day.type === 'recover' || day.type === 'rest') {
    return 'other';
  }

  return 'workout';
}

function clonePlannerDay(day: PlannerAiDayPlan): PlannerAiDayPlan {
  return {
    ...day,
    exercises: day.exercises.map((exercise) => ({ ...exercise })),
  };
}

function createEmptyPlannerExercise(): PlannerAiExercise {
  return {
    name: '',
    sets: '3',
    reps: '10',
    notes: '',
  };
}

export default function CoachPlanner({ healthData }: CoachPlannerProps) {
  const [profile, setProfile] = useState<UserProfile>({
    name: 'Utente',
    weight: 75,
    heartRateMax: 190,
    heartRateZones: DEFAULT_HEART_RATE_ZONES,
    targetSteps: 10000,
    targetSleep: 8,
    trainingDays: 4,
    preferredSplit: 'Push / Pull / Legs',
    activeDays: [],
    weeklySchedule: {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
  });
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isGeneratingAiPlanner, setIsGeneratingAiPlanner] = useState(false);
  const [aiPlanner, setAiPlanner] = useState<PlannerAiPlan | null>(null);
  const [exerciseMediaMap, setExerciseMediaMap] = useState<Record<string, ExerciseMedia | null>>({});
  const [editingDayIndex, setEditingDayIndex] = useState<number | null>(null);
  const [editingDayDraft, setEditingDayDraft] = useState<PlannerAiDayPlan | null>(null);
  const [dayAdjustmentPrompt, setDayAdjustmentPrompt] = useState('');
  const [isAdjustingDay, setIsAdjustingDay] = useState(false);
  const [dayEditorError, setDayEditorError] = useState<string | null>(null);
  const [isSavingPlannerWorkout, setIsSavingPlannerWorkout] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydratePlannerContext = async () => {
      try {
        const [{ profile: remoteProfile }, remoteWorkouts] = await Promise.all([
          hydrateProfileFromSupabase(),
          hydrateWorkoutsFromSupabase(),
        ]);

        if (!isMounted) {
          return;
        }

        if (remoteProfile) {
          setProfile(remoteProfile);
        }
        setWorkouts(remoteWorkouts);
        setSyncError(null);
      } catch (error) {
        console.error('Coach planner sync error:', error);
        setSyncError(getErrorMessage(error, 'Sync Coach Planner non riuscita.'));
      }
    };

    hydratePlannerContext();

    return () => {
      isMounted = false;
    };
  }, []);

  const planner = healthData
    ? generatePlannerOutput({
        profile,
        workouts,
        healthData,
      })
    : null;

  const aiPlannerCacheContextKey = useMemo(
    () => buildAiPlannerCacheContextKey(healthData, profile, workouts),
    [healthData, profile, workouts],
  );

  useEffect(() => {
    const cached = readLocalJson<{
      contextKey: string;
      plan: PlannerAiPlan | null;
    } | null>(AI_PLANNER_STORAGE_KEY, null);

    if (cached?.plan && cached.contextKey === aiPlannerCacheContextKey) {
      setAiPlanner(cached.plan);
      return;
    }
  }, [aiPlannerCacheContextKey]);

  useEffect(() => {
    const uniqueExerciseNames = Array.from(
      new Set(
        aiPlanner?.days.flatMap((day) => day.exercises.map((exercise) => exercise.name)).filter(Boolean) || [],
      ),
    );

    if (uniqueExerciseNames.length === 0) {
      setExerciseMediaMap({});
      return;
    }

    let isMounted = true;

    const hydrateExerciseMedia = async () => {
      const entries: Array<readonly [string, ExerciseMedia | null]> = [];

      for (let index = 0; index < uniqueExerciseNames.length; index += 2) {
        const chunk = uniqueExerciseNames.slice(index, index + 2);
        const chunkEntries = await Promise.all(
          chunk.map(async (exerciseName) => [exerciseName, await fetchExerciseMedia(exerciseName)] as const),
        );
        entries.push(...chunkEntries);

        if (!isMounted) {
          return;
        }
      }

      if (!isMounted) {
        return;
      }

      setExerciseMediaMap(Object.fromEntries(entries));
    };

    hydrateExerciseMedia();

    return () => {
      isMounted = false;
    };
  }, [aiPlanner]);

  const generateAiWeeklyPlanner = async () => {
    if (!healthData) {
      return;
    }

    setIsGeneratingAiPlanner(true);
    try {
      const plan = await generateAiPlannerPlan({
        profile,
        workouts,
        healthData,
      });

      persistAiPlanner(plan);
      setSyncError(null);
    } catch (error) {
      console.error(error);
      setSyncError(getErrorMessage(error, `Generazione piano AI non riuscita. Verifica ${getAiConnectionHint()}.`));
    } finally {
      setIsGeneratingAiPlanner(false);
    }
  };

  const persistAiPlanner = (nextPlan: PlannerAiPlan, targetWorkouts = workouts) => {
    setAiPlanner(nextPlan);
    writeLocalJson(AI_PLANNER_STORAGE_KEY, {
      contextKey: buildAiPlannerCacheContextKey(healthData, profile, targetWorkouts),
      plan: nextPlan,
    });
  };

  const openDayEditor = (day: PlannerAiDayPlan, index: number) => {
    setEditingDayIndex(index);
    setEditingDayDraft(clonePlannerDay(day));
    setDayAdjustmentPrompt('');
    setDayEditorError(null);
  };

  const closeDayEditor = () => {
    setEditingDayIndex(null);
    setEditingDayDraft(null);
    setDayAdjustmentPrompt('');
    setDayEditorError(null);
    setIsAdjustingDay(false);
    setIsSavingPlannerWorkout(false);
  };

  const updateEditingExercise = (exerciseIndex: number, field: keyof PlannerAiExercise, value: string) => {
    setEditingDayDraft((current) => {
      if (!current) {
        return current;
      }

      const nextExercises = current.exercises.map((exercise, index) => (
        index === exerciseIndex ? { ...exercise, [field]: value } : exercise
      ));

      return {
        ...current,
        exercises: nextExercises,
      };
    });
  };

  const addEditingExercise = () => {
    setEditingDayDraft((current) => current ? {
      ...current,
      exercises: [...current.exercises, createEmptyPlannerExercise()],
    } : current);
  };

  const removeEditingExercise = (exerciseIndex: number) => {
    setEditingDayDraft((current) => current ? {
      ...current,
      exercises: current.exercises.filter((_, index) => index !== exerciseIndex),
    } : current);
  };

  const saveDayDraftToPlanner = () => {
    if (!aiPlanner || editingDayIndex === null || !editingDayDraft) {
      return;
    }

    const nextPlan: PlannerAiPlan = {
      ...aiPlanner,
      days: aiPlanner.days.map((day, index) => (
        index === editingDayIndex ? clonePlannerDay(editingDayDraft) : day
      )),
    };

    persistAiPlanner(nextPlan);
    setDayEditorError(null);
  };

  const handleAdjustDayWithAi = async () => {
    if (!healthData || !editingDayDraft || !dayAdjustmentPrompt.trim()) {
      return;
    }

    setIsAdjustingDay(true);
    setDayEditorError(null);

    try {
      const adjustedDay = await adaptAiPlannerDay({
        day: editingDayDraft,
        healthData,
        workouts,
        userRequest: dayAdjustmentPrompt.trim(),
      });

      setEditingDayDraft(adjustedDay);
    } catch (error) {
      console.error(error);
      setDayEditorError(getErrorMessage(error, `Adattamento AI non riuscito. Verifica ${getAiConnectionHint()}.`));
    } finally {
      setIsAdjustingDay(false);
    }
  };

  const handleSaveWorkoutForDay = async () => {
    if (!healthData || !editingDayDraft) {
      return;
    }

    const existingWorkoutOnDate = workouts.find((workout) => workout.date === editingDayDraft.date);
    if (existingWorkoutOnDate && !isManualWorkout(existingWorkoutOnDate)) {
      setDayEditorError('Su questa data esiste gia un workout importato. Non lo sovrascrivo dal planner.');
      return;
    }

    setIsSavingPlannerWorkout(true);
    setDayEditorError(null);

    try {
      const baseWorkout = existingWorkoutOnDate && isManualWorkout(existingWorkoutOnDate)
        ? existingWorkoutOnDate
        : null;
      const plannerWorkout: Workout = {
        id: baseWorkout?.id || createAppUuid(),
        date: editingDayDraft.date,
        title: editingDayDraft.focus,
        type: buildWorkoutTypeFromPlannerDay(editingDayDraft),
        sourceKind: 'manual',
        isCompleted: baseWorkout?.isCompleted ?? false,
        completedAt: baseWorkout?.completedAt,
        exercises: buildPlannerExercisesForWorkout(editingDayDraft.exercises),
        durationMinutes: baseWorkout?.durationMinutes,
        caloriesBurned: baseWorkout?.caloriesBurned,
        averageHeartRate: baseWorkout?.averageHeartRate,
      };

      const nextWorkouts = [
        ...workouts.filter((workout) => workout.date !== editingDayDraft.date),
        plannerWorkout,
      ].sort((left, right) => right.date.localeCompare(left.date));

      await saveWorkoutsToSupabase(nextWorkouts);
      setWorkouts(nextWorkouts);
      setSyncError(null);

      if (aiPlanner) {
        persistAiPlanner(aiPlanner, nextWorkouts);
      }

      closeDayEditor();
    } catch (error) {
      console.error(error);
      setDayEditorError(getErrorMessage(error, 'Salvataggio workout dal planner non riuscito.'));
    } finally {
      setIsSavingPlannerWorkout(false);
    }
  };

  if (!healthData) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-950 p-8 text-zinc-400">
        <div className="max-w-2xl rounded-[2rem] border border-zinc-800 bg-zinc-900 p-8 text-center shadow-[0_30px_120px_rgba(0,0,0,0.32)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
            <CalendarIcon className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold text-white">Coach Planner</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            Importa prima i dati salute e gli allenamenti: qui il coach costruisce la vera scheda settimanale AI con esercizi, serie, ripetizioni e note pratiche.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs uppercase tracking-[0.22em] text-zinc-500">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              Coach Planner
            </div>
            <h1 className="text-3xl font-bold text-white">Piano Settimanale AI</h1>
            <p className="mt-2 max-w-3xl text-zinc-400">
              Vista dedicata alla programmazione della settimana: avvisi, scheda giorno per giorno e link rapidi ai tutorial degli esercizi.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {planner ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-right">
                <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Readiness</div>
                <div className="text-3xl font-bold text-white">{planner.readinessScore}</div>
              </div>
            ) : null}
            <button
              onClick={generateAiWeeklyPlanner}
              disabled={isGeneratingAiPlanner}
              className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isGeneratingAiPlanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dumbbell className="h-4 w-4" />}
              {isGeneratingAiPlanner ? 'Generazione piano...' : aiPlanner ? 'Rigenera piano AI' : 'Genera piano AI'}
            </button>
          </div>
        </div>

        {syncError ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
            {syncError}
          </div>
        ) : null}

        {planner ? (
          <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold tracking-tight text-white">{planner.headline}</h2>
              <p className="mt-2 text-sm text-zinc-500">
                Gli avvisi sotto sono reminder del planner deterministico. La scheda AI li usa come vincoli e li traduce in lavoro concreto.
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="mb-4 font-bold text-white">Avvisi</h3>
              <div className="space-y-3">
                {planner.insights.map((insight) => (
                  <div key={insight.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-semibold text-white">{insight.title}</div>
                      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{insight.priority}</span>
                    </div>
                    <div className="text-sm text-zinc-300">{insight.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-[2rem] border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-white">Scheda della settimana</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Ogni giorno contiene focus, esercizi, serie e ripetizioni. Quando disponibile, ogni esercizio mostra una mini preview tecnica embedded.
              </p>
            </div>
            {aiPlanner ? (
              <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                Cache attiva
              </div>
            ) : null}
          </div>

          {aiPlanner ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                {aiPlanner.overview}
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {aiPlanner.days.map((day, index) => {
                  const existingWorkout = workouts.find((workout) => workout.date === day.date);
                  const existingWorkoutSource = existingWorkout ? getWorkoutSourceKind(existingWorkout) : null;

                  return (
                  <div key={day.date} className="overflow-hidden rounded-[1.75rem] border border-zinc-800 bg-zinc-950">
                    <div className="border-b border-zinc-800 bg-zinc-900 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xl font-bold text-white">{day.dayLabel} · {day.focus}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{day.date}</div>
                        </div>
                        <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                          {day.type}
                        </span>
                      </div>
                      <p className="mt-4 text-sm leading-relaxed text-zinc-300">{day.summary}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openDayEditor(day, index)}
                          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15"
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Modifica giorno
                        </button>
                        <button
                          type="button"
                          onClick={() => openDayEditor(day, index)}
                          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-900"
                        >
                          <CalendarIcon className="h-3.5 w-3.5" />
                          {existingWorkout && existingWorkoutSource === 'manual' ? 'Aggiorna workout salvato' : 'Crea workout nel calendario'}
                        </button>
                        {existingWorkout ? (
                          <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${
                            existingWorkoutSource === 'manual'
                              ? 'border-amber-400/25 bg-amber-400/10 text-amber-200'
                              : 'border-sky-400/25 bg-sky-400/10 text-sky-200'
                          }`}>
                            {existingWorkoutSource === 'manual' ? 'Workout manuale presente' : 'Workout importato presente'}
                          </span>
                        ) : (
                          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            Slot libero
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 p-4">
                      {day.exercises.length > 0 ? (
                        day.exercises.map((exercise, index) => {
                          const media = exerciseMediaMap[exercise.name];

                          return (
                            <div key={`${day.date}-${exercise.name}-${index}`} className="rounded-2xl border border-zinc-800 bg-black/60 p-4">
                              <div className="grid gap-4 lg:grid-cols-[1fr_9rem]">
                                <div>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="font-semibold text-white">{exercise.name}</div>
                                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                                      {exercise.sets} x {exercise.reps}
                                    </div>
                                  </div>
                                  {exercise.notes ? (
                                    <p className="mt-2 text-sm text-zinc-400">{exercise.notes}</p>
                                  ) : null}
                                  {media ? (
                                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                                      {media.targetMuscles.slice(0, 2).map((muscle) => (
                                        <span key={`${exercise.name}-${muscle}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1">
                                          {muscle}
                                        </span>
                                      ))}
                                      {media.equipments.slice(0, 2).map((equipment) => (
                                        <span key={`${exercise.name}-${equipment}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1">
                                          {equipment}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                  <a
                                    href={getExerciseTutorialUrl(exercise.name)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Apri fonte
                                  </a>
                                </div>

                                <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                                  {media?.gifUrl ? (
                                    <>
                                      <img
                                        src={media.gifUrl}
                                        alt={exercise.name}
                                        className="h-32 w-full object-cover"
                                        loading="lazy"
                                      />
                                      <div className="border-t border-zinc-800 px-2 py-2 text-center text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                        Preview
                                      </div>
                                    </>
                                  ) : (
                                    <div className="flex h-32 items-center justify-center px-3 text-center text-xs text-zinc-500">
                                      Preview non trovata
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/40 px-4 py-4 text-sm text-zinc-500">
                          Nessun esercizio specifico: usa il giorno per recupero, mobilita o riposo.
                        </div>
                      )}
                    </div>
                  </div>
                );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 px-4 py-5 text-sm text-zinc-500">
              Genera il piano AI per creare la scheda completa della settimana.
            </div>
          )}
        </div>

        {editingDayDraft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950 shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
              <div className="flex items-start justify-between gap-4 border-b border-zinc-800 bg-zinc-900 px-6 py-5">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Workout Builder</div>
                  <h3 className="mt-2 text-2xl font-bold text-white">{editingDayDraft.dayLabel} · {editingDayDraft.focus}</h3>
                  <p className="mt-2 text-sm text-zinc-400">
                    Qui puoi adattare il giorno con AI oppure rifinirlo a mano prima di salvarlo come workout reale nel calendario.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDayEditor}
                  className="rounded-2xl border border-zinc-700 bg-zinc-950 p-3 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid flex-1 gap-0 overflow-y-auto xl:grid-cols-[0.92fr_1.08fr]">
                <div className="border-r border-zinc-800 bg-zinc-900/60 p-6">
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Adattamento AI</div>
                        <div className="mt-1 text-lg font-semibold text-white">Chiedi una variante</div>
                      </div>
                      <Wand2 className="h-5 w-5 text-emerald-300" />
                    </div>
                    <p className="text-sm text-zinc-400">
                      Esempio: "non voglio push up, metti una variante con manubri" oppure "riduci il volume per oggi".
                    </p>
                    <textarea
                      value={dayAdjustmentPrompt}
                      onChange={(event) => setDayAdjustmentPrompt(event.target.value)}
                      placeholder="Scrivi cosa vuoi cambiare in questo giorno..."
                      className="mt-4 h-36 w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleAdjustDayWithAi}
                      disabled={isAdjustingDay || !dayAdjustmentPrompt.trim()}
                      className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      {isAdjustingDay ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      {isAdjustingDay ? 'Adattamento in corso...' : 'Adatta con AI'}
                    </button>
                  </div>

                  <div className="mt-5 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                    <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Meta</div>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Focus</label>
                        <input
                          type="text"
                          value={editingDayDraft.focus}
                          onChange={(event) => setEditingDayDraft((current) => current ? { ...current, focus: event.target.value } : current)}
                          className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Data</label>
                        <input
                          type="text"
                          value={editingDayDraft.date}
                          readOnly
                          className="w-full rounded-xl border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-zinc-400 outline-none"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Summary</label>
                      <textarea
                        value={editingDayDraft.summary}
                        onChange={(event) => setEditingDayDraft((current) => current ? { ...current, summary: event.target.value } : current)}
                        className="h-24 w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {dayEditorError ? (
                    <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      {dayEditorError}
                    </div>
                  ) : null}
                </div>

                <div className="p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Editor manuale</div>
                      <div className="mt-1 text-lg font-semibold text-white">Esercizi del giorno</div>
                    </div>
                    <button
                      type="button"
                      onClick={addEditingExercise}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                    >
                      <Plus className="h-4 w-4" />
                      Aggiungi esercizio
                    </button>
                  </div>

                  <div className="space-y-4">
                    {editingDayDraft.exercises.length > 0 ? editingDayDraft.exercises.map((exercise, exerciseIndex) => (
                      <div key={`${editingDayDraft.date}-${exerciseIndex}`} className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-white">Blocco {exerciseIndex + 1}</div>
                          <button
                            type="button"
                            onClick={() => removeEditingExercise(exerciseIndex)}
                            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-400/30 hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Rimuovi
                          </button>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Nome</label>
                            <input
                              type="text"
                              value={exercise.name}
                              onChange={(event) => updateEditingExercise(exerciseIndex, 'name', event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Serie</label>
                            <input
                              type="text"
                              value={exercise.sets}
                              onChange={(event) => updateEditingExercise(exerciseIndex, 'sets', event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Reps</label>
                            <input
                              type="text"
                              value={exercise.reps}
                              onChange={(event) => updateEditingExercise(exerciseIndex, 'reps', event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">Note</label>
                            <textarea
                              value={exercise.notes || ''}
                              onChange={(event) => updateEditingExercise(exerciseIndex, 'notes', event.target.value)}
                              className="h-20 w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500"
                            />
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-sm text-zinc-500">
                        Nessun esercizio: puoi aggiungerlo a mano o chiedere all'AI una versione del giorno.
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={saveDayDraftToPlanner}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                    >
                      <Save className="h-4 w-4" />
                      Salva nel piano
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveWorkoutForDay}
                      disabled={isSavingPlannerWorkout}
                      className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      {isSavingPlannerWorkout ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarIcon className="h-4 w-4" />}
                      {isSavingPlannerWorkout ? 'Salvataggio...' : 'Salva come workout del giorno'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
