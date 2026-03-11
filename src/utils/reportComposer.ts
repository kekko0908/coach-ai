import { HealthData } from '../types';
import { buildRecentWindowSnapshot } from './coachContext';
import { buildResponseStyleInstruction, buildUserContextSummary, sendCoachRequest } from './aiClient';

function toIsoDate(value: Date) {
  return value.toISOString().split('T')[0];
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function getStartOfWeek(value: Date) {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseRequestedWindow(userPrompt: string) {
  const now = new Date();
  const normalized = userPrompt.toLowerCase();

  if (/\bsettimana scorsa\b/.test(normalized)) {
    const currentWeekStart = getStartOfWeek(now);
    const end = addDays(currentWeekStart, -1);
    const start = addDays(end, -6);
    return { windowDays: 7, endDate: toIsoDate(end), startDate: toIsoDate(start) };
  }

  if (/\bquesta settimana\b/.test(normalized)) {
    const start = getStartOfWeek(now);
    return { windowDays: Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86400000) + 1), endDate: toIsoDate(now), startDate: toIsoDate(start) };
  }

  if (/\bieri\b/.test(normalized)) {
    const day = addDays(now, -1);
    return { windowDays: 1, endDate: toIsoDate(day), startDate: toIsoDate(day) };
  }

  if (/\boggi\b/.test(normalized)) {
    const today = toIsoDate(now);
    return { windowDays: 1, endDate: today, startDate: today };
  }

  if (/\bmese scorso\b/.test(normalized)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      windowDays: Math.floor((end.getTime() - start.getTime()) / 86400000) + 1,
      endDate: toIsoDate(end),
      startDate: toIsoDate(start),
    };
  }

  if (/\bultim[oi]\s+7\s+giorni\b|\bscorsa settimana\b/.test(normalized)) {
    return { windowDays: 7, endDate: toIsoDate(now), startDate: toIsoDate(addDays(now, -6)) };
  }

  if (/\bultim[oi]\s+14\s+giorni\b/.test(normalized)) {
    return { windowDays: 14, endDate: toIsoDate(now), startDate: toIsoDate(addDays(now, -13)) };
  }

  if (/\bultim[oi]\s+30\s+giorni\b|\bultimo mese\b|\bnell'?ultimo mese\b/.test(normalized)) {
    return { windowDays: 30, endDate: toIsoDate(now), startDate: toIsoDate(addDays(now, -29)) };
  }

  return null;
}

function formatSignedNumber(value: number, digits = 0) {
  const rounded = digits > 0 ? value.toFixed(digits) : Math.round(value).toString();
  return `${value >= 0 ? '+' : ''}${rounded}`;
}

function buildTrendLine(
  label: string,
  stats: ReturnType<typeof buildRecentWindowSnapshot>['sleep'],
  formatter: (value: number) => string,
  extra?: string,
) {
  if (!stats) {
    return null;
  }

  return `- ${label}: media ${formatter(stats.average)}, min ${formatter(stats.min)}, max ${formatter(stats.max)}, primo ${stats.firstDate}=${formatter(stats.firstValue)}, ultimo ${stats.lastDate}=${formatter(stats.lastValue)}, delta ${formatSignedNumber(stats.delta, formatter(1).includes('.') ? 1 : 0)}${extra ? `, ${extra}` : ''}.`;
}

function buildKeyNumbersMarkdown(snapshot: ReturnType<typeof buildRecentWindowSnapshot>) {
  const lines = [
    '**Numeri Chiave**',
    `- Finestra ${snapshot.windowDays} giorni: ${snapshot.startDate} -> ${snapshot.endDate}`,
  ];

  const sleepLine = buildTrendLine(
    'Sonno',
    snapshot.sleep,
    (value) => `${value.toFixed(1)} h`,
    snapshot.sleep?.targetHits !== null && snapshot.sleep ? `target centrato ${snapshot.sleep.targetHits}/${snapshot.sleep.samples}` : undefined,
  );
  if (sleepLine) {
    lines.push(sleepLine);
  }

  const stepsLine = buildTrendLine(
    'Passi',
    snapshot.steps,
    (value) => `${Math.round(value)}`,
    snapshot.steps?.targetHits !== null && snapshot.steps ? `target centrato ${snapshot.steps.targetHits}/${snapshot.steps.samples}` : undefined,
  );
  if (stepsLine) {
    lines.push(stepsLine);
  }

  const bpmLine = buildTrendLine(
    snapshot.hrvAvailable ? 'BPM Base' : 'BPM Base / Recupero stimato',
    snapshot.bpm,
    (value) => `${Math.round(value)} bpm`,
  );
  if (bpmLine) {
    lines.push(bpmLine);
  }

  if (snapshot.workouts.count > 0) {
    const workoutBreakdown = Object.entries(snapshot.workouts.byType)
      .map(([label, count]) => `${label}=${count}`)
      .join(' | ');
    lines.push(`- Allenamenti: ${snapshot.workouts.count} sessioni, ${snapshot.workouts.totalMinutes} min totali, ${snapshot.workouts.totalCalories} kcal, tipi ${workoutBreakdown}.`);
  } else {
    lines.push('- Allenamenti: nessuna sessione registrata nella finestra.');
  }

  lines.push(`- Record recenti: ${snapshot.recordEntriesCount} entry registrate nella finestra.`);

  return lines.join('\n');
}

function stripGeneratedNumberSection(content: string) {
  return content
    .replace(/\*\*Numeri Chiave\*\*[\s\S]*?(?=\*\*(Punti Positivi|Punti Forti|Criticita|Da Migliorare|Prossime Azioni|Fonti))/i, '')
    .replace(/Numeri Chiave[\s\S]*?(?=\*\*(Punti Positivi|Punti Forti|Criticita|Da Migliorare|Prossime Azioni|Fonti))/i, '')
    .trim();
}

function sanitizeReportNarrative(content: string) {
  return content
    .replace(/\brispetto al mese precedente\b/gi, 'nella finestra osservata')
    .replace(/\brispetto alla settimana precedente\b/gi, 'nella finestra osservata')
    .replace(/\bconfronto col mese precedente\b/gi, 'confronto interno alla finestra')
    .replace(/\bse supera i?\s+\d+\s*bpm\b/gi, 'se il BPM continua a salire rispetto agli ultimi giorni')
    .replace(/\bse supera\s+\d+\b/gi, 'se il valore continua a salire rispetto agli ultimi giorni')
    .replace(/\bse scende sotto i?\s+\d+\s*bpm\b/gi, 'se il BPM non si stabilizza nei prossimi giorni')
    .replace(/\bse scende sotto\s+\d+\b/gi, 'se il valore non si stabilizza nei prossimi giorni');
}

interface StructuredHealthReportOptions {
  userPrompt: string;
  healthData: HealthData | null;
  windowDays?: number;
  knowledgeQuery?: string;
  ragQuery?: string;
  extraContextBlocks?: string[];
}

export async function generateStructuredHealthReport({
  userPrompt,
  healthData,
  windowDays = 30,
  knowledgeQuery,
  ragQuery,
  extraContextBlocks = [],
}: StructuredHealthReportOptions) {
  const requestedWindow = parseRequestedWindow(userPrompt);
  const snapshot = buildRecentWindowSnapshot(healthData, {
    windowDays: requestedWindow?.windowDays ?? windowDays,
    endDate: requestedWindow?.endDate,
  });
  const keyNumbersMarkdown = buildKeyNumbersMarkdown(snapshot);
  const aiSections = await sendCoachRequest({
    messages: [{ role: 'user', content: userPrompt }],
    contextBlocks: [
      buildUserContextSummary(healthData, {
        windowDays: snapshot.windowDays,
        endDate: snapshot.endDate,
      }),
      `REPORT NUMBERS BLOCCATI:\n${keyNumbersMarkdown}`,
      requestedWindow ? `FINESTRA RICHIESTA DALL'UTENTE: ${requestedWindow.startDate} -> ${requestedWindow.endDate}. Usa questa finestra come riferimento temporale principale.` : '',
      ...extraContextBlocks.filter(Boolean),
    ],
    knowledgeQuery: knowledgeQuery || userPrompt,
    knowledgeScopes: ['training', 'recovery', 'nutrition'],
    ragQuery: ragQuery || userPrompt,
    extraSystemPrompt: `Stai scrivendo un report su dati reali gia riassunti dal sistema.
${buildResponseStyleInstruction(userPrompt, 'general')}
- Devi scrivere solo queste sezioni: **Verdetto**, **Punti Positivi**, **Criticita**, **Prossime Azioni**.
- NON scrivere la sezione **Numeri Chiave**: viene aggiunta dal sistema.
- NON usare espressioni come "media storica" o confronti extra se non sono nei numeri forniti.
- NON parlare di "mese precedente", "settimana precedente" o altri periodi esterni: usa solo la finestra osservata e il confronto primo vs ultimo dato della finestra.
- NON inventare soglie numeriche, date o warning clinici non supportati dai dati o dalle fonti.
- NON dire che non ci sono infortuni, dolori o sintomi se questi dati non esistono nel contesto.
- NON proporre soglie arbitrarie tipo "sotto 78 bpm" o "sopra 82 bpm" se non sono presenti nei dati o nelle istruzioni.
- Quando un dato manca, limita la conclusione e scrivi che il dato non consente di confermare quel punto.
- Se un dato manca, dillo in modo neutro.`,
  });

  const cleanedSections = sanitizeReportNarrative(stripGeneratedNumberSection(aiSections));
  return `${keyNumbersMarkdown}\n\n${cleanedSections}`.trim();
}
