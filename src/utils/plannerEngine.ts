import { HealthData, UserProfile, Workout } from '../types';
import { PlannerAiDayPlan, PlannerAiPlan, PlannerDayPlan, PlannerInsight, PlannerOutput, PlannerReadinessLevel } from '../types/planner';
import { readCoachMemory } from './coachMemory';
import { hasLegLoad, isIntenseWorkout, sortPlannerInsights } from './plannerRules';
import { calculateReadiness } from './readiness';
import { buildUserContextSummary, extractJsonBlock, sendCoachRequest } from './aiClient';

const DAY_IDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

function toIsoDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDayId(date: Date) {
  return DAY_IDS[date.getDay()];
}

function getDayLabel(date: Date) {
  return DAY_LABELS[date.getDay()];
}

function getReadinessLevel(score: number): PlannerReadinessLevel {
  if (score >= 78) return 'high';
  if (score >= 55) return 'moderate';
  return 'low';
}

function buildHeadline(level: PlannerReadinessLevel, score: number) {
  if (level === 'high') {
    return `Readiness ${score}/100: puoi tenere un carico pieno, con attenzione solo alla distribuzione della settimana.`;
  }
  if (level === 'moderate') {
    return `Readiness ${score}/100: settimana gestibile, ma conviene calibrare volume e giorni pesanti.`;
  }
  return `Readiness ${score}/100: meglio alleggerire i primi giorni e proteggere il recupero.`;
}

function getWorkoutForDate(workouts: Workout[], dateIso: string) {
  return workouts.find((workout) => workout.date === dateIso);
}

function getWorkoutsInWindow(workouts: Workout[], endDate: Date, days: number) {
  const endIso = toIsoDate(endDate);
  const startIso = toIsoDate(addDays(endDate, -(days - 1)));

  return workouts.filter((workout) => workout.date >= startIso && workout.date <= endIso);
}

function getFocusFromProfile(profile: UserProfile, date: Date) {
  const dayId = getDayId(date) as keyof UserProfile['weeklySchedule'];
  const scheduledMuscles = profile.weeklySchedule[dayId] || [];

  if (scheduledMuscles.length > 0) {
    return scheduledMuscles.join(' / ');
  }

  return profile.preferredSplit;
}

export function generatePlannerOutput({
  profile,
  workouts,
  healthData,
  currentDate = new Date(),
}: {
  profile: UserProfile;
  workouts: Workout[];
  healthData: HealthData;
  currentDate?: Date;
}): PlannerOutput {
  const coachMemory = readCoachMemory();
  const todayIso = toIsoDate(currentDate);
  const yesterdayIso = toIsoDate(addDays(currentDate, -1));
  const tomorrowIso = toIsoDate(addDays(currentDate, 1));
  const insights: PlannerInsight[] = [];
  const readiness = calculateReadiness({
    profile,
    healthData,
    workouts,
    currentDate,
  });

  const sleepFactor = readiness.factors.find((factor) => factor.id === 'sleep');
  const hrvFactor = readiness.factors.find((factor) => factor.id === 'hrv');
  const bpmFactor = readiness.factors.find((factor) => factor.id === 'resting-bpm');
  const recentLoadFactor = readiness.factors.find((factor) => factor.id === 'recent-load');
  const topFatigue = readiness.fatigueGroups[0];
  const isHrvAvailable = healthData.meta?.hrvAvailable !== false;
  const recentWeekWorkouts = getWorkoutsInWindow(workouts, currentDate, 7);
  const recentSteps = healthData.trends.steps.slice(-7);
  const recentStepsAverage = recentSteps.length > 0
    ? recentSteps.reduce((sum, point) => sum + point.value, 0) / recentSteps.length
    : null;
  const plannedTrainingDays = profile.activeDays.length || profile.trainingDays;

  if (sleepFactor && sleepFactor.impact < 0) {
    insights.push({
      id: 'sleep-load',
      title: 'Sonno sotto target',
      detail: `Ultima notte ${healthData.sleep.total}h vs target ${profile.targetSleep}h. Meglio abbassare il volume se apri la settimana con un giorno pesante.`,
      priority: Math.abs(sleepFactor.impact) >= 10 ? 'high' : 'medium',
    });
  }

  if (hrvFactor && hrvFactor.impact < 0) {
    insights.push({
      id: 'hrv-load',
      title: 'Recupero autonomico da monitorare',
      detail: isHrvAvailable
        ? `HRV attuale ${healthData.hrv} ms. Conviene privilegiare tecnica, buffer e recuperi ordinati finche non risale.`
        : `Il recupero stimato arriva da efficienza del sonno e andamento dei BPM recenti. Oggi conviene privilegiare tecnica, buffer e recuperi ordinati.`,
      priority: Math.abs(hrvFactor.impact) >= 10 ? 'high' : 'medium',
    });
  }

  if (bpmFactor && bpmFactor.impact < 0) {
    insights.push({
      id: 'bpm-load',
      title: 'BPM a riposo elevato',
      detail: `Battito a riposo ${healthData.bpm} bpm. Segnale utile per non concentrare troppo stress nei primi 2 giorni.`,
      priority: Math.abs(bpmFactor.impact) >= 10 ? 'medium' : 'low',
    });
  }

  const yesterdayWorkout = getWorkoutForDate(workouts, yesterdayIso);
  const tomorrowWorkout = getWorkoutForDate(workouts, tomorrowIso);

  if (yesterdayWorkout && isIntenseWorkout(yesterdayWorkout) && recentLoadFactor && recentLoadFactor.impact < 0) {
    insights.push({
      id: 'recent-intense-load',
      title: 'Carico intenso recente',
      detail: `Ieri hai fatto ${yesterdayWorkout.title || yesterdayWorkout.type || 'un allenamento intenso'}. Primo giorno utile: meglio evitare un altro picco ravvicinato.`,
      priority: 'high',
    });
  }

  if (tomorrowWorkout?.type === 'football') {
    insights.push({
      id: 'football-tomorrow',
      title: 'Partita vicina',
      detail: 'Domani hai calcio. Evita oggi una seduta gambe pesante o molto tassante a livello nervoso.',
      priority: 'high',
    });
  }

  if (coachMemory.injuries.length > 0 || coachMemory.limitations.length > 0) {
    insights.push({
      id: 'coach-memory-constraints',
      title: 'Vincoli permanenti attivi',
      detail: `Il planner tiene presenti: ${[...coachMemory.injuries, ...coachMemory.limitations].join(' | ')}.`,
      priority: 'medium',
    });
  }

  if (topFatigue && topFatigue.level !== 'low') {
    insights.push({
      id: 'top-fatigue-group',
      title: `Fatica residua su ${topFatigue.label}`,
      detail: `${topFatigue.label} a ${topFatigue.score}/100. ${topFatigue.reason}`,
      priority: topFatigue.level === 'high' ? 'high' : 'medium',
    });
  }

  if (recentStepsAverage !== null && recentStepsAverage < profile.targetSteps * 0.85) {
    insights.push({
      id: 'steps-below-target',
      title: 'Passi sotto obiettivo',
      detail: `Negli ultimi giorni sei su circa ${Math.round(recentStepsAverage)} passi medi contro target ${profile.targetSteps}. Vale la pena usare camminate leggere come recupero attivo.`,
      priority: 'medium',
    });
  }

  if (recentWeekWorkouts.length === 0) {
    insights.push({
      id: 'no-recent-workouts',
      title: 'Nessuna seduta recente registrata',
      detail: 'Negli ultimi 7 giorni non risultano allenamenti salvati. Il piano della settimana va trattato come ripartenza graduale.',
      priority: 'high',
    });
  } else if (plannedTrainingDays >= 3 && recentWeekWorkouts.length < Math.max(2, plannedTrainingDays - 1)) {
    insights.push({
      id: 'weekly-volume-low',
      title: 'Volume settimanale sotto target',
      detail: `Hai registrato ${recentWeekWorkouts.length} sessioni negli ultimi 7 giorni, meno di quanto suggerisce la tua routine da ${plannedTrainingDays} giorni.`,
      priority: 'medium',
    });
  }

  if (readiness.readinessScore >= 78 && topFatigue?.level === 'low') {
    insights.push({
      id: 'good-window',
      title: 'Finestra favorevole',
      detail: 'Recupero e fatica residua sono in buona zona: puoi usare uno dei prossimi giorni per una seduta qualitativa ben eseguita.',
      priority: 'low',
    });
  }

  const readinessScore = readiness.readinessScore;
  const readinessLevel = getReadinessLevel(readinessScore);

  const nextWeek: PlannerDayPlan[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(currentDate, offset);
    const dateIso = toIsoDate(date);
    const dayId = getDayId(date);
    const dayLabel = getDayLabel(date);
    const existingWorkout = getWorkoutForDate(workouts, dateIso);
    const isActiveDay = profile.activeDays.includes(dayId);
    const focus = getFocusFromProfile(profile, date);

    if (existingWorkout) {
      nextWeek.push({
        date: dateIso,
        dayLabel,
        type: existingWorkout.type === 'workout' ? 'train' : 'light',
        focus: existingWorkout.title || existingWorkout.type || 'Workout programmato',
        reason: `Allenamento gia presente in calendario${existingWorkout.type === 'football' ? ': proteggi le gambe attorno a questo impegno.' : '.'}`,
      });
      continue;
    }

    if (!isActiveDay) {
      nextWeek.push({
        date: dateIso,
        dayLabel,
        type: readinessLevel === 'low' && offset <= 1 ? 'recover' : 'rest',
        focus: readinessLevel === 'low' && offset <= 1 ? 'Mobilita / camminata leggera' : 'Recupero',
        reason: 'Giorno non attivo nel profilo.',
      });
      continue;
    }

    const footballTomorrow = getWorkoutForDate(workouts, toIsoDate(addDays(date, 1)))?.type === 'football';
    const legHeavyDay = focus.toLowerCase().includes('gambe') || focus.toLowerCase().includes('legs');

    if ((readinessLevel === 'low' && offset <= 1) || (footballTomorrow && legHeavyDay)) {
      nextWeek.push({
        date: dateIso,
        dayLabel,
        type: 'light',
        focus: footballTomorrow && legHeavyDay ? 'Upper / tecnica / core' : 'Riduci volume del 20-30%',
        reason: footballTomorrow && legHeavyDay
          ? 'Domani c e un impegno sportivo: meglio non caricare troppo le gambe.'
          : 'Readiness bassa: primo giorno da tenere controllato.',
      });
      continue;
    }

    const previousDayWorkout = getWorkoutForDate(workouts, toIsoDate(addDays(date, -1)));
    if (previousDayWorkout && hasLegLoad(previousDayWorkout) && legHeavyDay) {
      nextWeek.push({
        date: dateIso,
        dayLabel,
        type: 'light',
        focus: 'Lower tecnico o volume ridotto',
        reason: 'Le gambe hanno gia carico ravvicinato. Tieni buffer e densita piu bassa.',
      });
      continue;
    }

    nextWeek.push({
      date: dateIso,
      dayLabel,
      type: 'train',
      focus,
      reason: readinessLevel === 'high'
        ? 'Finestra buona per tenere il piano previsto.'
        : 'Seduta coerente con il piano, ma con attenzione a recuperi e buffer.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    readinessScore,
    readinessLevel,
    headline: buildHeadline(readinessLevel, readinessScore),
    readinessFactors: readiness.factors,
    fatigueGroups: readiness.fatigueGroups,
    insights: sortPlannerInsights(insights).slice(0, 4),
    nextWeek,
  };
}

type PlannerAiResponse = {
  overview?: string;
  days?: Array<{
    date?: string;
    dayLabel?: string;
    type?: PlannerDayPlan['type'];
    focus?: string;
    summary?: string;
    exercises?: Array<{
      name?: string;
      sets?: string;
      reps?: string;
      notes?: string;
    }>;
  }>;
};

function normalizeExerciseName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getDuplicateExerciseNames(exercises: PlannerAiDayPlan['exercises']) {
  const counts = new Map<string, number>();

  exercises.forEach((exercise) => {
    const key = normalizeExerciseName(exercise.name);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
}

function normalizePlannerAiDay(day: PlannerAiResponse['days'][number] | undefined, fallback: PlannerDayPlan): PlannerAiDayPlan {
  const exercises = Array.isArray(day?.exercises)
    ? day.exercises
        .filter((exercise) => exercise?.name)
        .map((exercise) => ({
          name: exercise?.name?.trim() || 'Esercizio',
          sets: exercise?.sets?.trim() || '-',
          reps: exercise?.reps?.trim() || '-',
          notes: exercise?.notes?.trim() || undefined,
        }))
    : [];

  return {
    date: day?.date || fallback.date,
    dayLabel: day?.dayLabel || fallback.dayLabel,
    type: day?.type || fallback.type,
    focus: day?.focus?.trim() || fallback.focus,
    summary: day?.summary?.trim() || fallback.reason,
    exercises,
  };
}

function buildDuplicateRepairPrompt({
  originalDay,
  currentDay,
  duplicateNames,
  userRequest,
}: {
  originalDay: PlannerAiDayPlan;
  currentDay: PlannerAiDayPlan;
  duplicateNames: string[];
  userRequest: string;
}) {
  return `
La proposta precedente contiene esercizi duplicati nello stesso giorno e va corretta.

Richiesta utente originale:
${userRequest}

Giorno originale:
${JSON.stringify(originalDay, null, 2)}

Proposta da correggere:
${JSON.stringify(currentDay, null, 2)}

Duplicati rilevati:
${duplicateNames.join(', ')}

Regole:
- restituisci un giorno corretto senza esercizi duplicati;
- se l'utente ha chiesto una variante o alternativa, il nuovo esercizio deve essere diverso dagli altri gia presenti nello stesso giorno;
- non ripetere lo stesso pattern con lo stesso nome due volte;
- mantieni il focus del giorno;
- massimo 5 esercizi;
- restituisci solo JSON valido.
`.trim();
}

function buildAiPlannerPrompt(planner: PlannerOutput) {
  const weeklySkeleton = planner.nextWeek
    .map((day) => `${day.date} | ${day.dayLabel} | ${day.type} | ${day.focus} | ${day.reason}`)
    .join('\n');

  return `
Genera una scheda settimanale pratica di 7 giorni partendo da questo skeleton del planner:

${weeklySkeleton}

Regole:
- rispetta il focus di ogni giorno;
- se il giorno e "rest" o "recover", non inventare una scheda pesante;
- per i giorni "train" o "light" proponi esercizi concreti con serie e ripetizioni;
- massimo 5 esercizi per giorno;
- se il focus include calcio o recupero, usa mobilita, tecnica, core, camminata o lavoro leggero coerente;
- non inventare attrezzatura estrema se non serve;
- usa l attrezzatura disponibile nel contesto utente e evita esercizi che richiedono attrezzi non disponibili;
- formato sintetico e utile.

Rispondi solo con JSON valido, con questa struttura:
{
  "overview": "stringa breve",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "dayLabel": "Lun",
      "type": "train|light|recover|rest",
      "focus": "stringa breve",
      "summary": "1 frase",
      "exercises": [
        { "name": "Squat", "sets": "4", "reps": "6-8", "notes": "facoltative" }
      ]
    }
  ]
}
`.trim();
}

export async function generateAiPlannerPlan({
  profile,
  workouts,
  healthData,
  currentDate = new Date(),
}: {
  profile: UserProfile;
  workouts: Workout[];
  healthData: HealthData;
  currentDate?: Date;
}): Promise<PlannerAiPlan> {
  const planner = generatePlannerOutput({
    profile,
    workouts,
    healthData,
    currentDate,
  });
  const currentDateIso = toIsoDate(currentDate);
  const context = buildUserContextSummary(healthData, {
    windowDays: 30,
    endDate: currentDateIso,
  });

  const content = await sendCoachRequest({
    messages: [{ role: 'user', content: buildAiPlannerPrompt(planner) }],
    contextBlocks: [context, `Planner deterministico di base:\n- Readiness ${planner.readinessScore}/100 (${planner.readinessLevel})\n- Headline: ${planner.headline}`],
    extraSystemPrompt: [
      'Stai generando il piano settimanale operativo di FitSync.',
      'Devi produrre una scheda realmente utilizzabile, con esercizi, serie e reps.',
      'Non aggiungere testo fuori dal JSON.',
      'Non contraddire i vincoli del planner deterministico.',
    ].join('\n'),
    temperature: 0.4,
    knowledgeQuery: `${profile.preferredSplit} piano settimanale esercizi serie ripetizioni recupero ${planner.nextWeek.map((day) => day.focus).join(' ')}`,
    knowledgeScopes: ['training', 'recovery'],
    ragQuery: `${profile.preferredSplit} piano settimanale esercizi serie ripetizioni recupero ${planner.nextWeek.map((day) => day.focus).join(' ')}`,
    annotateRagSources: false,
  });

  const parsed = JSON.parse(extractJsonBlock(content)) as PlannerAiResponse;
  const parsedDays = Array.isArray(parsed.days) ? parsed.days : [];

  return {
    generatedAt: new Date().toISOString(),
    overview: parsed.overview?.trim() || 'Piano settimanale generato in base a readiness, recupero e struttura dei tuoi allenamenti.',
    days: planner.nextWeek.map((day, index) => normalizePlannerAiDay(parsedDays[index], day)),
  };
}

type PlannerAiDayResponse = {
  date?: string;
  dayLabel?: string;
  type?: PlannerDayPlan['type'];
  focus?: string;
  summary?: string;
  exercises?: Array<{
    name?: string;
    sets?: string;
    reps?: string;
    notes?: string;
  }>;
};

function buildAiPlannerDayAdjustmentPrompt(day: PlannerAiDayPlan, userRequest: string) {
  return `
Adatta solo questo giorno del piano settimanale.

Giorno attuale:
${JSON.stringify(day, null, 2)}

Richiesta utente:
${userRequest}

Regole:
- modifica solo questo giorno;
- mantieni il focus del giorno coerente, salvo richiesta esplicita di cambiarlo;
- se l'utente chiede una variante, sostituisci solo l'esercizio o il blocco necessario;
- non proporre un esercizio che e gia presente nello stesso giorno, a meno che l utente chieda esplicitamente di ripeterlo;
- se l utente chiede di rimuovere o sostituire un esercizio, non reinserirlo con lo stesso nome e non sostituirlo con un duplicato di un altro esercizio gia presente;
- mantieni al massimo 5 esercizi;
- non usare attrezzatura non disponibile nel contesto;
- se il giorno è recover o rest, non trasformarlo in una seduta pesante;
- restituisci solo JSON valido.

Formato:
{
  "date": "YYYY-MM-DD",
  "dayLabel": "Lun",
  "type": "train|light|recover|rest",
  "focus": "stringa breve",
  "summary": "1 frase",
  "exercises": [
    { "name": "Push-up inclinati", "sets": "3", "reps": "10-12", "notes": "facoltative" }
  ]
}
`.trim();
}

export async function adaptAiPlannerDay({
  day,
  healthData,
  workouts,
  currentDate = new Date(),
  userRequest,
}: {
  day: PlannerAiDayPlan;
  healthData: HealthData;
  workouts: Workout[];
  currentDate?: Date;
  userRequest: string;
}): Promise<PlannerAiDayPlan> {
  const currentDateIso = toIsoDate(currentDate);
  const context = buildUserContextSummary(healthData, {
    windowDays: 30,
    endDate: currentDateIso,
  });

  const content = await sendCoachRequest({
    messages: [{ role: 'user', content: buildAiPlannerDayAdjustmentPrompt(day, userRequest) }],
    contextBlocks: [context, `Giorno da adattare:\n- ${day.date} ${day.dayLabel}\n- Tipo: ${day.type}\n- Focus: ${day.focus}\n- Summary: ${day.summary}`],
    extraSystemPrompt: [
      'Stai adattando un solo giorno del Coach Planner di FitSync.',
      'Non rigenerare l intera settimana.',
      'Restituisci solo JSON valido.',
    ].join('\n'),
    temperature: 0.35,
    knowledgeQuery: `${day.focus} ${userRequest} varianti esercizi serie ripetizioni`,
    knowledgeScopes: ['training', 'recovery'],
    ragQuery: `${day.focus} ${userRequest} varianti esercizi serie ripetizioni`,
    annotateRagSources: false,
  });

  const parsed = JSON.parse(extractJsonBlock(content)) as PlannerAiDayResponse;
  const normalizedDay = normalizePlannerAiDay(parsed, day);
  const duplicateNames = getDuplicateExerciseNames(normalizedDay.exercises);

  if (duplicateNames.length === 0) {
    return normalizedDay;
  }

  const repairedContent = await sendCoachRequest({
    messages: [{
      role: 'user',
      content: buildDuplicateRepairPrompt({
        originalDay: day,
        currentDay: normalizedDay,
        duplicateNames,
        userRequest,
      }),
    }],
    contextBlocks: [context, `Giorno da correggere:\n- ${day.date} ${day.dayLabel}\n- Focus: ${day.focus}`],
    extraSystemPrompt: [
      'Stai correggendo un giorno del Coach Planner che contiene duplicati.',
      'La risposta finale deve contenere esercizi unici nello stesso giorno.',
      'Restituisci solo JSON valido.',
    ].join('\n'),
    temperature: 0.2,
    knowledgeQuery: `${day.focus} ${userRequest} alternative esercizi senza duplicati`,
    knowledgeScopes: ['training', 'recovery'],
    ragQuery: `${day.focus} ${userRequest} alternative esercizi senza duplicati`,
    annotateRagSources: false,
  });

  const repairedParsed = JSON.parse(extractJsonBlock(repairedContent)) as PlannerAiDayResponse;
  const repairedDay = normalizePlannerAiDay(repairedParsed, day);
  const repairedDuplicates = getDuplicateExerciseNames(repairedDay.exercises);

  if (repairedDuplicates.length > 0) {
    throw new Error(`Planner day adaptation produced duplicate exercises: ${repairedDuplicates.join(', ')}`);
  }

  return repairedDay;
}
