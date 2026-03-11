import { HealthData } from '../types';
import { KnowledgeScope } from '../types/knowledge';
import { extractJsonBlock } from './aiClient';

type PlannerProvider = 'openai' | 'ollama';
type PlannerIntent =
  | 'general_chat'
  | 'general_fitness'
  | 'workout_advice'
  | 'hypertrophy_advice'
  | 'nutrition_advice'
  | 'recovery_advice'
  | 'readiness_check'
  | 'progress_report';
type TimeScopeKind =
  | 'none'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_7_days'
  | 'last_14_days'
  | 'last_30_days'
  | 'explicit_range';

const PLANNER_PROVIDER = (import.meta.env.VITE_REQUEST_PLANNER_PROVIDER || import.meta.env.VITE_LLM_PROVIDER || 'openai') as PlannerProvider;
const PLANNER_BASE_URL = import.meta.env.VITE_REQUEST_PLANNER_BASE_URL || import.meta.env.VITE_LLM_BASE_URL || (PLANNER_PROVIDER === 'ollama'
  ? 'http://localhost:11434'
  : 'http://127.0.0.1:1234/v1');
const PLANNER_MODEL = import.meta.env.VITE_REQUEST_PLANNER_MODEL || '';
const PLANNER_PROXY_BASE_URL = '/api/llm';

const MONTH_NAME_MAP: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

export interface RequestTimeScope {
  kind: TimeScopeKind;
  startDate: string | null;
  endDate: string | null;
  windowDays: number | null;
  explicitRange: boolean;
}

export interface RequestPlan {
  source: 'deterministic' | 'planner-model' | 'planner-fallback';
  model: string | null;
  confidence: number;
  intent: PlannerIntent;
  fitnessRelated: boolean;
  reportLike: boolean;
  timeScope: RequestTimeScope;
  needsCoachContext: boolean;
  needsHealthStats: boolean;
  needsRecentWorkouts: boolean;
  includeKnowledgeContext: boolean;
  includeScienceInsights: boolean;
  includeRagContext: boolean;
  knowledgeScopes: KnowledgeScope[];
  scienceSuggested: boolean;
  scienceEffective: boolean;
  thinkerSuggested: boolean;
  thinkerEffective: boolean;
  reason: string;
}

interface PlanChatRequestOptions {
  input: string;
  healthData: HealthData | null;
  manualScienceEnabled: boolean;
  manualThinkerEnabled: boolean;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function getPlannerRequestBaseUrl() {
  if (import.meta.env.DEV) {
    return PLANNER_PROXY_BASE_URL;
  }

  return normalizeBaseUrl(PLANNER_BASE_URL);
}

function toIsoDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00`);
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

function clampConfidence(value: number, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function uniqueScopes(scopes: KnowledgeScope[]) {
  return Array.from(new Set(scopes));
}

function parseExplicitDate(prompt: string, todayIso: string) {
  const isoMatch = prompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  const slashMatch = prompt.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const [, dayText, monthText, yearText] = slashMatch;
    const fallbackYear = parseIsoDate(todayIso).getFullYear();
    const year = yearText
      ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
      : fallbackYear;
    const month = Number(monthText);
    const day = Number(dayText);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
    }
  }

  const namedMonthMatch = prompt.toLowerCase().match(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\b/);
  if (namedMonthMatch) {
    const [, dayText, monthName, yearText] = namedMonthMatch;
    const fallbackYear = parseIsoDate(todayIso).getFullYear();
    const year = yearText ? Number(yearText) : fallbackYear;
    const month = MONTH_NAME_MAP[monthName];
    const day = Number(dayText);
    return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
  }

  return null;
}

function parseRequestedTimeScope(input: string) {
  const normalized = input.toLowerCase();
  const now = new Date();
  const today = toIsoDate(now);
  const rangeMatch = normalized.match(/\bdal\s+(.+?)\s+al\s+(.+?)(?=$|\s+(?:con|per|che|dove|e)\b)/);

  if (rangeMatch) {
    const [, startText, endText] = rangeMatch;
    const startDate = parseExplicitDate(startText.trim(), today);
    const endDate = parseExplicitDate(endText.trim(), today);

    if (startDate && endDate) {
      const normalizedStart = startDate <= endDate ? startDate : endDate;
      const normalizedEnd = startDate <= endDate ? endDate : startDate;
      const start = parseIsoDate(normalizedStart);
      const end = parseIsoDate(normalizedEnd);
      return {
        kind: 'explicit_range' as const,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        windowDays: Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1),
        explicitRange: true,
      };
    }
  }

  if (/\bieri\b/.test(normalized)) {
    const day = addDays(now, -1);
    const iso = toIsoDate(day);
    return { kind: 'yesterday' as const, startDate: iso, endDate: iso, windowDays: 1, explicitRange: false };
  }

  if (/\boggi\b/.test(normalized)) {
    return { kind: 'today' as const, startDate: today, endDate: today, windowDays: 1, explicitRange: false };
  }

  if (/\bsettimana scorsa\b|\bscorsa settimana\b/.test(normalized)) {
    const currentWeekStart = getStartOfWeek(now);
    const end = addDays(currentWeekStart, -1);
    const start = addDays(end, -6);
    return { kind: 'last_week' as const, startDate: toIsoDate(start), endDate: toIsoDate(end), windowDays: 7, explicitRange: true };
  }

  if (/\bquesta settimana\b|\bsettimanal[ei]\b|\bsettimana\b/.test(normalized) && !/\bultim[oi]\s+7\s+giorni\b/.test(normalized)) {
    const start = getStartOfWeek(now);
    return {
      kind: 'this_week' as const,
      startDate: toIsoDate(start),
      endDate: today,
      windowDays: Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86400000) + 1),
      explicitRange: false,
    };
  }

  if (/\bmese scorso\b/.test(normalized)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      kind: 'last_month' as const,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end),
      windowDays: Math.floor((end.getTime() - start.getTime()) / 86400000) + 1,
      explicitRange: true,
    };
  }

  if (/\bquesto mese\b|\bmese corrente\b/.test(normalized)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      kind: 'this_month' as const,
      startDate: toIsoDate(start),
      endDate: today,
      windowDays: Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86400000) + 1),
      explicitRange: false,
    };
  }

  if (/\bultim[oi]\s+7\s+giorni\b/.test(normalized)) {
    return { kind: 'last_7_days' as const, startDate: toIsoDate(addDays(now, -6)), endDate: today, windowDays: 7, explicitRange: false };
  }

  if (/\bultim[oi]\s+14\s+giorni\b/.test(normalized)) {
    return { kind: 'last_14_days' as const, startDate: toIsoDate(addDays(now, -13)), endDate: today, windowDays: 14, explicitRange: false };
  }

  if (/\bultim[oi]\s+30\s+giorni\b|\bultimo mese\b|\bnell'?ultimo mese\b/.test(normalized)) {
    return { kind: 'last_30_days' as const, startDate: toIsoDate(addDays(now, -29)), endDate: today, windowDays: 30, explicitRange: false };
  }

  return {
    kind: 'none' as const,
    startDate: null,
    endDate: null,
    windowDays: null,
    explicitRange: false,
  };
}

function inferIntent(input: string): PlannerIntent {
  const normalized = input.toLowerCase();

  if (/\b(report|riepilog|resoconto|analisi|trend|andamento|progressi?)\b/.test(normalized)) {
    return 'progress_report';
  }

  if (/\b(readiness|recuper|stanchezz|fatica|doms|hrv|sonno|bpm)\b/.test(normalized)) {
    return 'readiness_check';
  }

  if (/\b(nutrizion|proteine|carbo|calorie|massa magra|surplus|deficit|idratazion)\b/.test(normalized)) {
    return 'nutrition_advice';
  }

  if (/\b(ipertrof|massa muscolar|aumentare la massa|muscolo|bulk)\b/.test(normalized)) {
    return 'hypertrophy_advice';
  }

  if (/\b(scheda|allenament|workout|eserciz|split|push|pull|legs|petto|spalle|dorso|gambe|braccia)\b/.test(normalized)) {
    return 'workout_advice';
  }

  if (/\b(calcio|corsa|running|bike|cycling|performance|forza)\b/.test(normalized)) {
    return 'general_fitness';
  }

  return /\b(chat|ciao|salve|grazie)\b/.test(normalized) ? 'general_chat' : 'general_fitness';
}

function inferKnowledgeScopes(input: string, intent: PlannerIntent) {
  const normalized = input.toLowerCase();
  const scopes: KnowledgeScope[] = [];

  if (intent === 'workout_advice' || intent === 'hypertrophy_advice' || intent === 'general_fitness' || intent === 'progress_report') {
    scopes.push('training');
  }

  if (intent === 'nutrition_advice' || /\b(proteine|carbo|calorie|surplus|deficit|idratazion|leucina)\b/.test(normalized)) {
    scopes.push('nutrition');
  }

  if (intent === 'readiness_check' || /\b(recuper|sonno|hrv|bpm|fatica|stress|doms)\b/.test(normalized)) {
    scopes.push('recovery');
  }

  return uniqueScopes(scopes);
}

function buildDeterministicPlan({
  input,
  healthData,
  manualScienceEnabled,
  manualThinkerEnabled,
}: PlanChatRequestOptions): RequestPlan {
  const normalized = input.toLowerCase();
  const intent = inferIntent(input);
  const timeScope = parseRequestedTimeScope(input);
  const fitnessRelated = intent !== 'general_chat';
  const reportLike = intent === 'progress_report';
  const explicitScience = /\b(scienz|scientif|studio|studi|paper|evidenz|fonti|fonte|letteratura|research|citaz)\b/.test(normalized);
  const scienceSuggested = explicitScience
    || ['hypertrophy_advice', 'nutrition_advice', 'readiness_check', 'progress_report'].includes(intent)
    || /\b(ipertrof|massa muscolar|recuper|proteine|volume|intensit|readiness|hrv|sonno)\b/.test(normalized);
  const thinkerSuggested = reportLike
    || /\b(confront|analizza|spiega|ottimizza|strategia|piano settimanale|programma completo|perche)\b/.test(normalized)
    || input.length > 220;
  const knowledgeScopes = inferKnowledgeScopes(input, intent);
  const scienceEffective = manualScienceEnabled || (scienceSuggested && fitnessRelated);
  const thinkerEffective = manualThinkerEnabled;
  const includeRagContext = scienceEffective && (reportLike || explicitScience || /\b(paper|studio|studi|review|meta-anal)/.test(normalized));
  const needsHealthStats = Boolean(healthData) && (reportLike || intent === 'readiness_check' || /\b(passi|sonno|bpm|hrv|calorie|trend|andamento)\b/.test(normalized));
  const needsRecentWorkouts = reportLike || intent === 'workout_advice' || intent === 'hypertrophy_advice' || intent === 'general_fitness' || /\b(workout|allenament|split|ultima sessione|ultimi workout)\b/.test(normalized);
  const needsCoachContext = fitnessRelated;
  const confidence = clampConfidence(
    reportLike
      ? 0.92
      : intent === 'general_chat'
        ? 0.78
        : intent === 'hypertrophy_advice' || intent === 'nutrition_advice'
          ? 0.84
          : 0.8,
  );
  const reasons: string[] = [`intent ${intent}`];

  if (timeScope.kind !== 'none') {
    reasons.push(`finestra ${timeScope.kind}`);
  }
  if (scienceEffective) {
    reasons.push(manualScienceEnabled ? 'science manuale ON' : 'science auto');
  }
  if (manualThinkerEnabled) {
    reasons.push('thinker manuale ON');
  } else if (thinkerSuggested) {
    reasons.push('thinker suggerito ma non applicato');
  }

  return {
    source: 'deterministic',
    model: null,
    confidence,
    intent,
    fitnessRelated,
    reportLike,
    timeScope,
    needsCoachContext,
    needsHealthStats,
    needsRecentWorkouts,
    includeKnowledgeContext: scienceEffective && knowledgeScopes.length > 0,
    includeScienceInsights: scienceEffective,
    includeRagContext,
    knowledgeScopes,
    scienceSuggested,
    scienceEffective,
    thinkerSuggested,
    thinkerEffective,
    reason: reasons.join(' | '),
  };
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function toIntent(value: unknown, fallback: PlannerIntent) {
  const allowed: PlannerIntent[] = [
    'general_chat',
    'general_fitness',
    'workout_advice',
    'hypertrophy_advice',
    'nutrition_advice',
    'recovery_advice',
    'readiness_check',
    'progress_report',
  ];
  return typeof value === 'string' && allowed.includes(value as PlannerIntent) ? value as PlannerIntent : fallback;
}

function toKnowledgeScopes(value: unknown, fallback: KnowledgeScope[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const allowed: KnowledgeScope[] = ['training', 'recovery', 'nutrition'];
  return uniqueScopes(value.filter((item): item is KnowledgeScope => typeof item === 'string' && allowed.includes(item as KnowledgeScope)));
}

function mergePlannerPlan(basePlan: RequestPlan, modelPlan: Record<string, unknown>): RequestPlan {
  const intent = toIntent(modelPlan.intent, basePlan.intent);
  const knowledgeScopes = toKnowledgeScopes(modelPlan.knowledgeScopes, inferKnowledgeScopes(String(modelPlan.intent || ''), intent));
  const scienceSuggested = toBoolean(modelPlan.scienceSuggested, basePlan.scienceSuggested);
  const thinkerSuggested = toBoolean(modelPlan.thinkerSuggested, basePlan.thinkerSuggested);
  const fitnessRelated = toBoolean(modelPlan.fitnessRelated, basePlan.fitnessRelated);
  const reportLike = toBoolean(modelPlan.reportLike, basePlan.reportLike);
  const scienceEffective = basePlan.scienceEffective || (scienceSuggested && fitnessRelated);
  const thinkerEffective = basePlan.thinkerEffective;

  return {
    ...basePlan,
    source: 'planner-model',
    model: PLANNER_MODEL || null,
    confidence: clampConfidence(typeof modelPlan.confidence === 'number' ? modelPlan.confidence : Number(modelPlan.confidence), basePlan.confidence),
    intent,
    fitnessRelated,
    reportLike,
    needsCoachContext: toBoolean(modelPlan.needsCoachContext, basePlan.needsCoachContext),
    needsHealthStats: toBoolean(modelPlan.needsHealthStats, basePlan.needsHealthStats),
    needsRecentWorkouts: toBoolean(modelPlan.needsRecentWorkouts, basePlan.needsRecentWorkouts),
    includeKnowledgeContext: toBoolean(modelPlan.includeKnowledgeContext, basePlan.includeKnowledgeContext || scienceEffective),
    includeScienceInsights: toBoolean(modelPlan.includeScienceInsights, basePlan.includeScienceInsights || scienceEffective),
    includeRagContext: toBoolean(modelPlan.includeRagContext, basePlan.includeRagContext),
    knowledgeScopes: knowledgeScopes.length > 0 ? knowledgeScopes : basePlan.knowledgeScopes,
    scienceSuggested,
    scienceEffective,
    thinkerSuggested,
    thinkerEffective,
    reason: typeof modelPlan.reason === 'string' && modelPlan.reason.trim()
      ? `${basePlan.reason} | planner ${modelPlan.reason.trim()}`
      : `${basePlan.reason} | planner model`,
  };
}

async function parsePlannerResponse(response: Response) {
  if (PLANNER_PROVIDER === 'ollama') {
    const data = await response.json();
    return data?.message?.content;
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content;
}

async function requestPlannerModel(input: string, basePlan: RequestPlan) {
  if (!PLANNER_MODEL) {
    return null;
  }

  const baseUrl = getPlannerRequestBaseUrl();
  const systemPrompt = [
    'Sei FitSync Request Planner.',
    'Rispondi solo con JSON valido, senza markdown e senza testo aggiuntivo.',
    'Decidi solo il routing della richiesta, non rispondere all utente finale.',
    'Mantieni le date gia dedotte dal sistema come riferimento, non inventare nuove date.',
    'Usa questi intent: general_chat, general_fitness, workout_advice, hypertrophy_advice, nutrition_advice, recovery_advice, readiness_check, progress_report.',
    'Campi obbligatori: intent, fitnessRelated, reportLike, scienceSuggested, thinkerSuggested, needsCoachContext, needsHealthStats, needsRecentWorkouts, includeKnowledgeContext, includeScienceInsights, includeRagContext, knowledgeScopes, confidence, reason.',
    'Regola chiave: parti dal piano deterministico e cambialo solo se c e un motivo forte e chiaro nel messaggio utente.',
    'Sii conservativo: non attivare science, rag o thinker senza un segnale esplicito o una complessita reale.',
    'Per un report semplice o un riepilogo settimanale, non attivare science o rag di default se l utente non chiede studi, evidenze, paper o citazioni.',
    'Puoi suggerire thinker solo per richieste davvero ambigue, multi-step, strategiche o molto analitiche. Il toggle thinker effettivo resta sotto controllo della UI.',
    'Attiva rag solo se la richiesta menziona paper, studi, review, meta-analisi, evidenze o necessita di fonti esterne specifiche.',
    'Se il messaggio riguarda solo coaching pratico o report operativo, preferisci piano leggero.',
  ].join('\n');
  const userPrompt = [
    `Messaggio utente: ${input}`,
    `Piano deterministico iniziale: ${JSON.stringify({
      intent: basePlan.intent,
      reportLike: basePlan.reportLike,
      fitnessRelated: basePlan.fitnessRelated,
      scienceSuggested: basePlan.scienceSuggested,
      thinkerSuggested: basePlan.thinkerSuggested,
      needsCoachContext: basePlan.needsCoachContext,
      needsHealthStats: basePlan.needsHealthStats,
      needsRecentWorkouts: basePlan.needsRecentWorkouts,
      includeKnowledgeContext: basePlan.includeKnowledgeContext,
      includeScienceInsights: basePlan.includeScienceInsights,
      includeRagContext: basePlan.includeRagContext,
      knowledgeScopes: basePlan.knowledgeScopes,
    })}`,
    'Se il piano iniziale e gia corretto, confermalo con modifiche minime.',
    'Non espandere aggressivamente science, rag o thinker se il messaggio non lo richiede davvero.',
    'Confidence alta solo se la richiesta e chiara e la modifica proposta e ben giustificata.',
  ].join('\n');

  const payload = PLANNER_PROVIDER === 'ollama'
    ? {
        model: PLANNER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        options: {
          temperature: 0.1,
        },
      }
    : {
        model: PLANNER_MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };
  const path = PLANNER_PROVIDER === 'ollama' ? '/api/chat' : '/chat/completions';
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return null;
  }

  const rawContent = await parsePlannerResponse(response);
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(extractJsonBlock(rawContent));
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function planChatRequest(options: PlanChatRequestOptions): Promise<RequestPlan> {
  const basePlan = buildDeterministicPlan(options);
  const modelPlan = await requestPlannerModel(options.input, basePlan).catch(() => null);

  if (!modelPlan) {
    return PLANNER_MODEL
      ? { ...basePlan, source: 'planner-fallback', model: PLANNER_MODEL }
      : basePlan;
  }

  return mergePlannerPlan(basePlan, modelPlan);
}

export function buildRequestPlanContextBlock(plan: RequestPlan) {
  const compactScopeLabel = plan.timeScope.kind !== 'none'
    ? plan.timeScope.kind
    : 'none';
  const compactRangeLabel = plan.timeScope.startDate && plan.timeScope.endDate
    ? `${plan.timeScope.startDate} -> ${plan.timeScope.endDate}`
    : 'none';
  const compactKnowledgeLabel = plan.knowledgeScopes.length > 0 ? plan.knowledgeScopes.join(',') : 'none';

  return [
    'REQUEST FLAGS:',
    `- intent=${plan.intent}`,
    `- time_scope=${compactScopeLabel}`,
    `- date_range=${compactRangeLabel}`,
    `- coach_context=${plan.needsCoachContext ? 'on' : 'off'} health_stats=${plan.needsHealthStats ? 'on' : 'off'} recent_workouts=${plan.needsRecentWorkouts ? 'on' : 'off'}`,
    `- science=${plan.includeScienceInsights ? 'on' : 'off'} knowledge=${plan.includeKnowledgeContext ? 'on' : 'off'} rag=${plan.includeRagContext ? 'on' : 'off'} thinker=${plan.thinkerEffective ? 'on' : 'off'}`,
    `- knowledge_scopes=${compactKnowledgeLabel}`,
  ].join('\n');

  const scopeLabel = plan.timeScope.startDate && plan.timeScope.endDate
    ? `${plan.timeScope.startDate} -> ${plan.timeScope.endDate}`
    : 'nessuna finestra esplicita';
  const knowledgeLabel = plan.knowledgeScopes.length > 0 ? plan.knowledgeScopes.join(', ') : 'nessuno';

  return [
    'REQUEST PLAN VALIDATO:',
    `- Sorgente piano: ${plan.source}${plan.model ? ` (${plan.model})` : ''}.`,
    `- Intento: ${plan.intent}.`,
    `- Fitness related: ${plan.fitnessRelated ? 'si' : 'no'}.`,
    `- Report: ${plan.reportLike ? 'si' : 'no'}.`,
    `- Finestra temporale: ${scopeLabel}.`,
    `- Science: suggerita ${plan.scienceSuggested ? 'si' : 'no'}, effettiva ${plan.scienceEffective ? 'si' : 'no'}.`,
    `- Thinker: suggerito ${plan.thinkerSuggested ? 'si' : 'no'}, effettivo ${plan.thinkerEffective ? 'si' : 'no'}.`,
    `- Contesto coach: ${plan.needsCoachContext ? 'si' : 'no'}, health stats: ${plan.needsHealthStats ? 'si' : 'no'}, recent workouts: ${plan.needsRecentWorkouts ? 'si' : 'no'}.`,
    `- Retrieval: knowledge ${plan.includeKnowledgeContext ? 'si' : 'no'}, science ${plan.includeScienceInsights ? 'si' : 'no'}, rag ${plan.includeRagContext ? 'si' : 'no'}, scopes ${knowledgeLabel}.`,
    `- Confidence: ${Math.round(plan.confidence * 100)}%.`,
    `- Motivo sintetico: ${plan.reason}.`,
  ].join('\n');
}
