import React, { useState, useEffect } from 'react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addDays,
} from 'date-fns';
import { it } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, X, Dumbbell, Trash2, Edit2, Activity, Map as MapIcon, Upload, Heart, Flame, Clock3, Footprints, Waves, Archive, CheckCircle2, Circle } from 'lucide-react';
import { Workout, Exercise, WorkoutType } from '../types';
import WorkoutDashboard from './WorkoutDashboard';
import { getWorkoutDefaultTitle, getWorkoutTheme, getWorkoutTypeLabel, resolveWorkoutTitle, workoutSupportsGpx } from '../utils/workoutMeta';
import { deriveWorkoutSummary, extractWorkoutActivityDate, extractWorkoutImportMetadata } from '../utils/workoutData';
import { hydrateWorkoutsFromSupabase, saveWorkoutsToSupabase } from '../lib/supabase/workoutRepository';
import { getErrorMessage } from '../utils/errorMessage';
import { createAppUuid } from '../utils/uuid';
import { getWorkoutSourceKind, isManualWorkout, isWorkoutCompleted } from '../utils/workoutStatus';
import { consumePendingCalendarIntent } from '../lib/navigationIntent';

function WorkoutTypeIcon({
  type,
  sourceSportLabel,
  className = 'w-5 h-5',
}: {
  type?: WorkoutType;
  sourceSportLabel?: string;
  className?: string;
}) {
  const normalizedLabel = sourceSportLabel?.toLowerCase();
  if (normalizedLabel === 'camminata') {
    return <Footprints className={className} />;
  }
  if (normalizedLabel === 'nuoto libero') {
    return <Waves className={className} />;
  }
  if (normalizedLabel === 'stretching') {
    return <Activity className={className} />;
  }
  if (normalizedLabel === 'esport') {
    return <Archive className={className} />;
  }
  if (type === 'running' || type === 'cycling') {
    return <Activity className={className} />;
  }
  return <Dumbbell className={className} />;
}

function formatDurationTag(minutes?: number) {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes} min`;
}

function parseCalendarIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function buildCompletionState(workout: Workout, isCompleted: boolean) {
  return {
    ...workout,
    sourceKind: getWorkoutSourceKind(workout),
    isCompleted,
    completedAt: isCompleted ? workout.completedAt || new Date().toISOString() : undefined,
  };
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
  const [viewingWorkout, setViewingWorkout] = useState<Workout | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isRemoteEmpty, setIsRemoteEmpty] = useState(false);

  const openDateIntent = (day: Date, mode: 'focus' | 'editor' = 'focus') => {
    setSelectedDate(day);
    setCurrentDate(day);
    const targetDate = format(day, 'yyyy-MM-dd');
    const existingWorkout = workouts.find((w) => w.date === targetDate);

    if (existingWorkout && mode !== 'editor') {
      setViewingWorkout(existingWorkout);
      setIsModalOpen(false);
      return;
    }

    setViewingWorkout(null);
    setEditingWorkout(existingWorkout || {
      id: createAppUuid(),
      date: targetDate,
      type: 'workout',
      sourceKind: 'manual',
      isCompleted: false,
      title: '',
      exercises: [],
    });
    setIsModalOpen(true);
  };

  useEffect(() => {
    let isMounted = true;

    const loadWorkouts = async () => {
      try {
        const parsedWorkouts = await hydrateWorkoutsFromSupabase();
        if (!isMounted) {
          return;
        }

        const normalizedWorkouts = parsedWorkouts.map((workout) => {
          const activityDate = extractWorkoutActivityDate(workout);
          const summary = deriveWorkoutSummary(workout);
          return activityDate && activityDate !== workout.date
            ? { ...workout, date: activityDate, ...summary }
            : { ...workout, ...summary };
        });

        setWorkouts(normalizedWorkouts);
        setIsRemoteEmpty(normalizedWorkouts.length === 0);
        setSyncError(null);
      } catch (error) {
        console.error('Workout sync error:', error);
        setSyncError(getErrorMessage(error, 'Sync allenamenti non riuscita.'));
      }
    };

    loadWorkouts();

    return () => {
      isMounted = false;
    };
  }, []);

  const saveWorkouts = async (newWorkouts: Workout[]) => {
    setWorkouts(newWorkouts);
    try {
      await saveWorkoutsToSupabase(newWorkouts);
      setSyncError(null);
      setIsRemoteEmpty(newWorkouts.length === 0);
    } catch (error) {
      console.error('Workout save error:', error);
      setSyncError(getErrorMessage(error, 'Salvataggio allenamenti non riuscito su Supabase.'));
    }
  };

  const toggleWorkoutCompletion = async (workout: Workout, nextCompleted: boolean) => {
    if (!isManualWorkout(workout)) {
      return;
    }

    const updatedWorkout = buildCompletionState(workout, nextCompleted);
    const nextWorkouts = workouts.map((item) => (item.id === workout.id ? updatedWorkout : item));
    await saveWorkouts(nextWorkouts);

    if (viewingWorkout?.id === workout.id) {
      setViewingWorkout(updatedWorkout);
    }

    if (editingWorkout?.id === workout.id) {
      setEditingWorkout(updatedWorkout);
    }
  };

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const onDateClick = (day: Date) => {
    openDateIntent(day);
  };

  useEffect(() => {
    const intent = consumePendingCalendarIntent();
    if (!intent?.date) {
      return;
    }

    openDateIntent(parseCalendarIsoDate(intent.date), intent.mode || 'focus');
  }, [workouts]);

  const renderHeader = () => {
    return (
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white capitalize">
          {format(currentDate, 'MMMM yyyy', { locale: it })}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={prevMonth}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors border border-zinc-800"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={nextMonth}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors border border-zinc-800"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  };

  const handleDirectImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsImporting(true);

    try {
      const fileContent = await file.text();
      const isTcx = file.name.toLowerCase().endsWith('.tcx');
      const importMetadata = extractWorkoutImportMetadata({
        tcxData: isTcx ? fileContent : undefined,
        gpxData: isTcx ? undefined : fileContent,
      });
      const summary = deriveWorkoutSummary({
        tcxData: isTcx ? fileContent : undefined,
        gpxData: isTcx ? undefined : fileContent,
      });
      const importedWorkout: Workout = {
        id: createAppUuid(),
        date: importMetadata.date || format(new Date(), 'yyyy-MM-dd'),
        type: importMetadata.type,
        sourceKind: 'imported',
        isCompleted: true,
        completedAt: new Date().toISOString(),
        title: importMetadata.title,
        exercises: [],
        durationMinutes: summary.durationMinutes,
        caloriesBurned: summary.caloriesBurned,
        averageHeartRate: summary.averageHeartRate,
        tcxData: isTcx ? fileContent : undefined,
        gpxData: isTcx ? undefined : fileContent,
      };

      const nextWorkouts = workouts.filter((workout) => workout.date !== importedWorkout.date);
      nextWorkouts.push(importedWorkout);
      await saveWorkouts(nextWorkouts);
      setViewingWorkout(importedWorkout);
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  const renderDays = () => {
    const days = [];
    const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
    for (let i = 0; i < 7; i++) {
      days.push(
        <div key={i} className="text-center font-medium text-zinc-500 text-sm py-2 uppercase tracking-wider">
          {format(addDays(startDate, i), 'EEEEEE', { locale: it })}
        </div>
      );
    }
    return <div className="grid grid-cols-7 mb-2">{days}</div>;
  };

  const renderCells = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        const formattedDate = format(day, 'd');
        const cloneDay = day;
        const isCurrentMonth = isSameMonth(day, monthStart);
        const isToday = isSameDay(day, new Date());
        const workout = workouts.find((w) => w.date === format(cloneDay, 'yyyy-MM-dd'));
        const workoutTheme = workout ? getWorkoutTheme(workout.type, workout.sourceSportLabel) : null;
        const manualWorkout = workout ? isManualWorkout(workout) : false;
        const completedWorkout = workout ? isWorkoutCompleted(workout) : false;

        days.push(
          <div
            key={day.toString()}
            onClick={() => onDateClick(cloneDay)}
            className={`min-h-[100px] p-2 border border-zinc-800/50 relative cursor-pointer transition-all duration-200 hover:bg-zinc-800/50 group flex flex-col ${
              !isCurrentMonth ? 'text-zinc-600 bg-zinc-950/50' : 'text-zinc-300 bg-zinc-900'
            } ${isToday ? 'ring-2 ring-emerald-500 ring-inset' : ''}`}
          >
            <span
              className={`text-sm font-medium mb-1 ${
                isToday ? 'text-emerald-400' : ''
              }`}
            >
              {formattedDate}
            </span>
            {workout && (
              <div className="absolute bottom-2 left-2 right-2">
                <div className={`${workoutTheme?.badgeClass} text-xs px-2 py-1 rounded-md flex items-center gap-1`}>
                  <span className={`h-2 w-2 rounded-full shrink-0 ${workoutTheme?.dotClass}`}></span>
                  <WorkoutTypeIcon type={workout.type} sourceSportLabel={workout.sourceSportLabel} className="w-3 h-3 shrink-0" />
                  <span className="truncate">{resolveWorkoutTitle(workout)}</span>
                </div>
              </div>
            )}
            <div className="absolute top-2 right-2 transition-opacity">
              {workout ? (
                manualWorkout ? (
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    completedWorkout
                      ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                  }`}>
                    {completedWorkout ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                  </div>
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-sky-400/30 bg-sky-400/10 text-sky-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </div>
                )
              ) : (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus className="w-4 h-4 text-zinc-500" />
                </div>
              )}
            </div>
          </div>
        );
        day = addDays(day, 1);
      }

      rows.push(
        <div className="grid grid-cols-7" key={day.toString()}>
          {days}
        </div>
      );
      days = [];
    }

    return <div className="border border-zinc-800 rounded-xl overflow-hidden">{rows}</div>;
  };

  const renderWorkoutList = () => {
    if (workouts.length === 0) return null;

    const visibleMonthWorkouts = workouts
      .filter((workout) => isSameMonth(new Date(workout.date), currentDate))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (visibleMonthWorkouts.length === 0) {
      return (
        <div className="mt-12">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                <Dumbbell className="w-5 h-5 text-emerald-400" />
                Allenamenti del mese
              </h3>
              <p className="text-sm text-zinc-500">
                Stai vedendo solo {format(currentDate, 'MMMM yyyy', { locale: it })}. Usa le frecce sopra per cambiare mese.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">
            Nessun allenamento nel mese selezionato.
          </div>
        </div>
      );
    }

    return (
      <div className="mt-12">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Dumbbell className="w-5 h-5 text-emerald-400" />
              Allenamenti del mese
            </h3>
            <p className="text-sm text-zinc-500">
              Stai vedendo solo {format(currentDate, 'MMMM yyyy', { locale: it })}. Usa le frecce sopra per cambiare mese.
            </p>
          </div>
          <div className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
            {visibleMonthWorkouts.length} elementi
          </div>
        </div>
        <div className="space-y-4">
          {visibleMonthWorkouts.map((workout) => {
            const theme = getWorkoutTheme(workout.type, workout.sourceSportLabel);
            const manualWorkout = isManualWorkout(workout);
            const completedWorkout = isWorkoutCompleted(workout);

            return (
              <div key={workout.id} onClick={() => setViewingWorkout(workout)} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors cursor-pointer">
                <div className="flex justify-between items-center mb-4 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg shrink-0 ${theme.iconClass}`}>
                      <WorkoutTypeIcon type={workout.type} sourceSportLabel={workout.sourceSportLabel} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-white text-lg truncate">{resolveWorkoutTitle(workout)}</div>
                      <div className="text-zinc-500 text-sm">
                        {format(new Date(workout.date), 'EEEE d MMMM yyyy', { locale: it })} • {getWorkoutTypeLabel(workout.type, workout.sourceSportLabel)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {manualWorkout && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleWorkoutCompletion(workout, !completedWorkout);
                        }}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          completedWorkout
                            ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                            : 'border-amber-400/25 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15'
                        }`}
                      >
                        {completedWorkout ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        {completedWorkout ? 'Confermato' : 'Conferma svolto'}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingWorkout(workout);
                        setIsModalOpen(true);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors text-sm font-medium shrink-0"
                    >
                      <Edit2 className="w-4 h-4" />
                      Modifica
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  <span className={`${theme.badgeClass} inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium`}>
                    <span className={`h-2 w-2 rounded-full ${theme.dotClass}`}></span>
                    {getWorkoutTypeLabel(workout.type, workout.sourceSportLabel)}
                  </span>
                  <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                    manualWorkout
                      ? 'border border-zinc-700 bg-zinc-950 text-zinc-200'
                      : 'border border-sky-400/25 bg-sky-400/10 text-sky-200'
                  }`}>
                    {manualWorkout ? 'Inserito manualmente' : 'Importato'}
                  </span>
                  {manualWorkout && (
                    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                      completedWorkout
                        ? 'border border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                        : 'border border-amber-400/25 bg-amber-400/10 text-amber-200'
                    }`}>
                      {completedWorkout ? 'Svolto' : 'Da confermare'}
                    </span>
                  )}
                  {formatDurationTag(workout.durationMinutes) && (
                    <span className="bg-zinc-950 border border-zinc-800 text-zinc-100 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium">
                      <Clock3 className="w-3.5 h-3.5" />
                      Tempo: {formatDurationTag(workout.durationMinutes)}
                    </span>
                  )}
                  {workout.caloriesBurned ? (
                    <span className="bg-red-500/10 border border-red-500/25 text-red-300 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium">
                      <Flame className="w-3.5 h-3.5" />
                      Calorie: {workout.caloriesBurned} kcal
                    </span>
                  ) : null}
                  {workout.averageHeartRate ? (
                    <span className="bg-amber-500/10 border border-amber-500/25 text-amber-300 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium">
                      <Heart className="w-3.5 h-3.5" />
                      BPM medio: {workout.averageHeartRate} bpm
                    </span>
                  ) : null}
                </div>

                {workout.type === 'workout' && workout.exercises.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {workout.exercises.map((exercise, index) => (
                      <div key={exercise.id} className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/50">
                        <div className="font-medium text-zinc-200 mb-1 truncate">{exercise.name || `Esercizio ${index + 1}`}</div>
                        <div className="text-xs text-zinc-500 flex flex-wrap gap-2">
                          <span className="bg-zinc-900 px-1.5 py-0.5 rounded">{exercise.sets}x{exercise.reps}</span>
                          <span className="bg-zinc-900 px-1.5 py-0.5 rounded">{exercise.weight}kg</span>
                          <span className="bg-zinc-900 px-1.5 py-0.5 rounded">{exercise.rest}s rec.</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (viewingWorkout) {
    return (
      <WorkoutDashboard
        workout={viewingWorkout}
        onClose={() => setViewingWorkout(null)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Training Planner</h1>
              <p className="text-zinc-400">Pianifica e traccia i tuoi allenamenti.</p>
            </div>
            <label className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-4 py-2 rounded-xl font-bold transition-colors shadow-lg shadow-emerald-500/20 cursor-pointer shrink-0">
              <Upload className="w-4 h-4" />
              {isImporting ? 'Importazione...' : 'Importa TCX / GPX'}
              <input
                type="file"
                accept=".tcx,.gpx"
                className="hidden"
                disabled={isImporting}
                onChange={handleDirectImport}
              />
            </label>
          </div>
          {selectedDate && (
            <p className="mt-3 text-xs uppercase tracking-[0.28em] text-zinc-500">
              Giorno selezionato: {format(selectedDate, 'dd MMMM yyyy', { locale: it })}
            </p>
          )}
          {syncError ? (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {syncError}
            </div>
          ) : null}
          {isRemoteEmpty ? (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Supabase non contiene ancora allenamenti per questo account.
            </div>
          ) : null}
        </div>

        {renderHeader()}
        {renderDays()}
        {renderCells()}
        {renderWorkoutList()}
      </div>

      {isModalOpen && editingWorkout && (
        <WorkoutModal
          workout={editingWorkout}
          onClose={() => setIsModalOpen(false)}
          onSave={(updatedWorkout) => {
            const newWorkouts = workouts.filter((w) => w.id !== updatedWorkout.id);
            newWorkouts.push(updatedWorkout);
            void saveWorkouts(newWorkouts);
            setIsModalOpen(false);
            if (viewingWorkout && viewingWorkout.id === updatedWorkout.id) {
              setViewingWorkout(updatedWorkout);
            }
          }}
          onDelete={() => {
            void saveWorkouts(workouts.filter((w) => w.id !== editingWorkout.id));
            setIsModalOpen(false);
            if (viewingWorkout && viewingWorkout.id === editingWorkout.id) {
              setViewingWorkout(null);
            }
          }}
        />
      )}
    </div>
  );
}

interface WorkoutModalProps {
  workout: Workout;
  onClose: () => void;
  onSave: (workout: Workout) => void;
  onDelete: () => void;
}

function WorkoutModal({ workout, onClose, onSave, onDelete }: WorkoutModalProps) {
  const [exercises, setExercises] = useState<Exercise[]>(workout.exercises || []);
  const [title, setTitle] = useState(workout.title || '');
  const [type, setType] = useState<WorkoutType>(workout.type || 'workout');
  const [gpxData, setGpxData] = useState(workout.gpxData || '');
  const [tcxData, setTcxData] = useState(workout.tcxData || '');
  const [durationMinutes, setDurationMinutes] = useState<string>(workout.durationMinutes ? String(workout.durationMinutes) : '');
  const [caloriesBurned, setCaloriesBurned] = useState<string>(workout.caloriesBurned ? String(workout.caloriesBurned) : '');
  const [averageHeartRate, setAverageHeartRate] = useState<string>(workout.averageHeartRate ? String(workout.averageHeartRate) : '');
  const workoutSourceKind = getWorkoutSourceKind(workout);
  const manualWorkout = workoutSourceKind === 'manual';
  const [isCompleted, setIsCompleted] = useState(() => isWorkoutCompleted(workout));

  const handleFileRead = (file: File, setter: (value: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      setter(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleGpxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileRead(file, setGpxData);
    }
  };

  const handleTcxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileRead(file, setTcxData);
    }
  };

  const addExercise = () => {
    setExercises([
      ...exercises,
      {
        id: createAppUuid(),
        name: '',
        sets: 3,
        reps: 10,
        rest: 60,
        weight: 0,
      },
    ]);
  };

  const updateExercise = (id: string, field: keyof Exercise, value: string | number) => {
    setExercises(
      exercises.map((exercise) => (exercise.id === id ? { ...exercise, [field]: value } : exercise))
    );
  };

  const removeExercise = (id: string) => {
    setExercises(exercises.filter((exercise) => exercise.id !== id));
  };

  const handleSave = () => {
    const importedMetadata = tcxData ? extractWorkoutImportMetadata({ tcxData, gpxData: undefined }) : null;
    const resolvedType = importedMetadata?.type || type;
    const resolvedTitle = importedMetadata?.title || (
      resolvedType === 'football'
        ? getWorkoutDefaultTitle(resolvedType)
        : title.trim() || getWorkoutDefaultTitle(resolvedType)
    );
    const activityDate = extractWorkoutActivityDate({ tcxData, gpxData });
    const derivedSummary = deriveWorkoutSummary({
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      caloriesBurned: caloriesBurned ? Number(caloriesBurned) : undefined,
      averageHeartRate: averageHeartRate ? Number(averageHeartRate) : undefined,
      tcxData: tcxData || undefined,
      gpxData: gpxData || undefined,
    });

    onSave({
      ...workout,
      date: activityDate || workout.date,
      title: resolvedTitle,
      type: resolvedType,
      sourceKind: workoutSourceKind,
      isCompleted: manualWorkout ? isCompleted : true,
      completedAt: (manualWorkout ? isCompleted : true) ? workout.completedAt || new Date().toISOString() : undefined,
      exercises: resolvedType === 'workout' ? exercises : [],
      durationMinutes: derivedSummary.durationMinutes,
      caloriesBurned: derivedSummary.caloriesBurned,
      averageHeartRate: derivedSummary.averageHeartRate,
      gpxData: workoutSupportsGpx(resolvedType) ? gpxData || undefined : undefined,
      tcxData: tcxData || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 rounded-t-2xl">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Dumbbell className="text-emerald-400" />
              Allenamento del {format(new Date(workout.date), 'dd/MM/yyyy')}
            </h3>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Titolo</label>
              <input
                type="text"
                value={type === 'football' ? getWorkoutDefaultTitle(type) : title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`es. ${getWorkoutDefaultTitle(type)}`}
                disabled={type === 'football'}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white disabled:text-zinc-500 disabled:cursor-not-allowed focus:ring-1 focus:ring-emerald-500 outline-none"
              />
              {type === 'football' && (
                <p className="mt-2 text-xs text-sky-300">Le partite di calcio salvano automaticamente il titolo "Calcio".</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Tipo di Allenamento</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as WorkoutType)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="workout">Palestra / Workout</option>
                <option value="running">Corsa all'aperto</option>
                <option value="cycling">Ciclismo</option>
                <option value="football">Partita di Calcio</option>
                <option value="other">Altro</option>
              </select>
            </div>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5">
            <div className="mb-4">
              <h4 className="font-bold text-white">Riepilogo allenamento</h4>
              <p className="text-sm text-zinc-500">Questi valori finiscono nei tag della card allenamento. Se il file TCX li contiene, vengono recuperati automaticamente.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Tempo (min)</label>
                <input
                  type="number"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="es. 60"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Calorie Bruciate</label>
                <input
                  type="number"
                  value={caloriesBurned}
                  onChange={(e) => setCaloriesBurned(e.target.value)}
                  placeholder="es. 540"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">BPM Medio</label>
                <input
                  type="number"
                  value={averageHeartRate}
                  onChange={(e) => setAverageHeartRate(e.target.value)}
                  placeholder="es. 148"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
          </div>

          <div className={`rounded-xl border p-5 ${
            manualWorkout
              ? isCompleted
                ? 'border-emerald-400/25 bg-emerald-500/10'
                : 'border-amber-400/25 bg-amber-400/10'
              : 'border-sky-400/20 bg-sky-400/10'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="font-bold text-white">Stato allenamento</h4>
                <p className="mt-1 text-sm text-zinc-300">
                  {manualWorkout
                    ? 'I workout inseriti manualmente possono restare pianificati finche non li confermi come svolti.'
                    : 'I workout importati vengono considerati gia svolti e non richiedono conferma manuale.'}
                </p>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                manualWorkout
                  ? isCompleted
                    ? 'bg-emerald-500/15 text-emerald-200'
                    : 'bg-amber-400/15 text-amber-100'
                  : 'bg-sky-400/15 text-sky-100'
              }`}>
                {manualWorkout ? (isCompleted ? 'Svolto' : 'Da confermare') : 'Importato'}
              </div>
            </div>
            {manualWorkout && (
              <label className="mt-4 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-white">
                <input
                  type="checkbox"
                  checked={isCompleted}
                  onChange={(event) => setIsCompleted(event.target.checked)}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/40"
                />
                Conferma che questo allenamento e stato effettivamente svolto
              </label>
            )}
          </div>

          {type === 'workout' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-white">Esercizi</h4>
                <button
                  onClick={addExercise}
                  className="flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Aggiungi
                </button>
              </div>

              {exercises.length === 0 ? (
                <div className="text-center py-8 text-zinc-500 border-2 border-dashed border-zinc-800 rounded-xl">
                  <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>Nessun esercizio aggiunto.</p>
                </div>
              ) : (
                exercises.map((exercise, index) => (
                  <div key={exercise.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 relative group">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-emerald-400 font-bold text-sm bg-emerald-400/10 px-2 py-1 rounded">
                        Esercizio {index + 1}
                      </span>
                      <button
                        onClick={() => removeExercise(exercise.id)}
                        className="text-zinc-500 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="col-span-1 md:col-span-2">
                        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Nome Esercizio</label>
                        <input
                          type="text"
                          value={exercise.name}
                          onChange={(e) => updateExercise(exercise.id, 'name', e.target.value)}
                          placeholder="es. Panca Piana"
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Serie (Sets)</label>
                        <input
                          type="number"
                          value={exercise.sets}
                          onChange={(e) => updateExercise(exercise.id, 'sets', Number(e.target.value))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Ripetizioni (Reps)</label>
                        <input
                          type="number"
                          value={exercise.reps}
                          onChange={(e) => updateExercise(exercise.id, 'reps', Number(e.target.value))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Recupero (sec)</label>
                        <input
                          type="number"
                          value={exercise.rest}
                          onChange={(e) => updateExercise(exercise.id, 'rest', Number(e.target.value))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Peso (kg)</label>
                        <input
                          type="number"
                          value={exercise.weight}
                          onChange={(e) => updateExercise(exercise.id, 'weight', Number(e.target.value))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 text-center">
              <Activity className="w-12 h-12 mx-auto mb-4 text-emerald-400" />
              <h4 className="font-bold text-white mb-2">Metriche avanzate (TCX)</h4>
              <p className="text-sm text-zinc-400 mb-6">
                Carica un file `.tcx` per visualizzare passo, bpm, zona cardiaca, cadenza e falcata nella schermata dedicata all&apos;allenamento.
              </p>

              <label className="cursor-pointer inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg font-medium transition-colors border border-zinc-700">
                <Plus className="w-4 h-4" />
                {tcxData ? 'Cambia File TCX' : 'Carica File TCX'}
                <input
                  type="file"
                  accept=".tcx"
                  className="hidden"
                  onChange={handleTcxUpload}
                />
              </label>

              {tcxData && (
                <div className="mt-4 text-emerald-400 text-sm flex items-center justify-center gap-1">
                  <Activity className="w-4 h-4" />
                  File TCX caricato con successo
                </div>
              )}
            </div>

            <div className={`border rounded-xl p-6 text-center ${workoutSupportsGpx(type) ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-950/50 border-zinc-800/60'}`}>
              <MapIcon className={`w-12 h-12 mx-auto mb-4 ${workoutSupportsGpx(type) ? 'text-sky-400' : 'text-zinc-600'}`} />
              <h4 className="font-bold text-white mb-2">Tracciato GPS (GPX)</h4>
              <p className="text-sm text-zinc-400 mb-6">
                Il file `.gpx` è disponibile solo per `Corsa all&apos;aperto` e `Partita di Calcio`.
              </p>

              {workoutSupportsGpx(type) ? (
                <>
                  <label className="cursor-pointer inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg font-medium transition-colors border border-zinc-700">
                    <Plus className="w-4 h-4" />
                    {gpxData ? 'Cambia File GPX' : 'Carica File GPX'}
                    <input
                      type="file"
                      accept=".gpx"
                      className="hidden"
                      onChange={handleGpxUpload}
                    />
                  </label>

                  {gpxData && (
                    <div className="mt-4 text-sky-300 text-sm flex items-center justify-center gap-1">
                      <MapIcon className="w-4 h-4" />
                      File GPX caricato con successo
                    </div>
                  )}
                </>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-500">
                  <MapIcon className="w-4 h-4" />
                  GPX non disponibile per questo tipo
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-zinc-800 flex justify-between bg-zinc-900/50 rounded-b-2xl">
          <button
            onClick={onDelete}
            className="px-4 py-2 text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors font-medium flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Elimina Tutto
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors font-medium"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-lg font-bold transition-colors shadow-lg shadow-emerald-500/20"
            >
              Salva Allenamento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
