import { HealthData, Message } from '../types';
import { buildGlobalCoachContext, CoachContextWindowOptions } from './coachContext';
import { buildKnowledgeContext } from './knowledgeBase';
import { buildRagCitationFooter, buildRagContext } from './retrieval';
import { buildScienceCitationFooter, buildScienceInsightsContext } from './scienceInsights';
import { KnowledgeScope } from '../types/knowledge';

type LlmProvider = 'openai' | 'ollama';

const AI_PROVIDER = (import.meta.env.VITE_LLM_PROVIDER || 'openai') as LlmProvider;
const AI_BASE_URL = import.meta.env.VITE_LLM_BASE_URL || (AI_PROVIDER === 'ollama'
  ? 'http://localhost:11434'
  : 'http://127.0.0.1:1234/v1');
const AI_MODEL = import.meta.env.VITE_LLM_MODEL || 'deepseek-r1';
const AI_PROXY_BASE_URL = '/api/llm';
const AI_CONTEXT_WINDOW = Number(import.meta.env.VITE_LLM_CONTEXT_WINDOW || 0);
const REPORT_LIKE_REQUEST_PATTERN = /\b(report|riepilog|recap|andamento|progressi?|trend|analisi|come sta andando|come stanno andando)\b/i;

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

const DEFAULT_COACH_IDENTITY = `Sei FitSync Coach, un personal trainer digitale esperto di allenamento, recupero, composizione corporea e pianificazione sportiva.

Obiettivo:
- aiutare l'utente a migliorare performance, costanza e recupero;
- personalizzare sempre i consigli in base a profilo, dati salute, calendario allenamenti e record;
- rispondere in italiano con tono chiaro, pratico e professionale.

Regole:
- rispondi prima in modo diretto alla domanda dell'utente;
- se la domanda non riguarda fitness, salute, allenamento o recupero, non forzare collegamenti sportivi non richiesti;
- usa il contesto fitness solo quando e realmente utile alla richiesta;
- considera sempre il contesto reale dell'utente prima di dare consigli;
- se sonno o HRV sono scarsi, non proporre riposo assoluto in automatico: riduci volume, intensita o scegli recupero attivo, mobilita o tecnica;
- rispetta giorni di allenamento, split preferito e impegni sportivi gia pianificati;
- per dimagrimento, ipertrofia, forza e resistenza usa principi base solidi: progressione graduale, recupero sufficiente, tecnica corretta, volume sostenibile;
- evita diagnosi mediche; se emergono segnali di infortunio serio o sintomi anomali, suggerisci valutazione medica;
- quando proponi un piano, rendilo concreto con giorni, focus, volume e note essenziali.`;

export function buildUserContextSummary(healthData?: HealthData | null, options: CoachContextWindowOptions = {}) {
  return buildGlobalCoachContext(healthData, options);
}

export function isReportLikeRequest(content: string) {
  return REPORT_LIKE_REQUEST_PATTERN.test(content);
}

export function buildResponseStyleInstruction(content: string, scope: 'general' | 'workout' | 'dashboard' = 'general') {
  const baseInstruction = [
    '- rispondi in modo diretto alla domanda;',
    '- se la richiesta non e su fitness o salute, non trasformarla in coaching non richiesto;',
    '- se suggerisci modifiche al carico, spiega il motivo in modo breve;',
    '- usa elenchi puntati quando proponi una scheda o un piano;',
    '- evita muri di testo: prima il verdetto, poi i dettagli essenziali.',
  ];

  if (!isReportLikeRequest(content)) {
    if (scope === 'workout') {
      return [
        ...baseInstruction,
        '- usa markdown con titoli brevi;',
        '- massimo 3 sezioni;',
        '- massimo 3 bullet per sezione;',
        '- evidenzia solo i numeri davvero importanti.',
      ].join('\n');
    }

    return [
      ...baseInstruction,
      '- quando la risposta e lunga, usa titoli markdown brevi e massimo 3-4 bullet per sezione.',
    ].join('\n');
  }

  const reportSpecificInstruction = scope === 'workout'
    ? [
        '- formatta la risposta come report leggibile del workout.',
        '- usa esattamente queste sezioni in markdown: **Verdetto**, **Numeri Chiave**, **Punti Forti**, **Da Migliorare**, **Prossime Azioni**.',
        '- in `Numeri Chiave` includi solo metriche realmente presenti nei dati del workout.',
      ]
    : [
        '- formatta la risposta come report leggibile e non come testo libero.',
        '- usa esattamente queste sezioni in markdown: **Verdetto**, **Numeri Chiave**, **Punti Positivi**, **Criticita**, **Prossime Azioni**.',
        '- in `Numeri Chiave` metti solo valori realmente presenti nei dati recenti, senza inventare metriche o confronti.',
      ];

  return [
    ...baseInstruction,
    ...reportSpecificInstruction,
    '- massimo 5 sezioni e massimo 3 bullet per sezione.',
    '- se un dato manca, scrivi esplicitamente che non e disponibile invece di dedurlo.',
    '- il verdetto iniziale deve stare in 1-2 frasi.',
    '- non usare frasi vaghe tipo "media storica" se non hai un confronto esplicito nei dati.',
  ].join('\n');
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function getRequestBaseUrl() {
  if (import.meta.env.DEV) {
    return AI_PROXY_BASE_URL;
  }

  return normalizeBaseUrl(AI_BASE_URL);
}

function stripThinkingTags(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function sanitizeConversationMessages(messages: Message[]) {
  const firstUserIndex = messages.findIndex((message) => message.role === 'user');

  if (firstUserIndex <= 0) {
    return messages;
  }

  return messages.slice(firstUserIndex);
}

function formatLocalDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';

  return { year, month, day };
}

function formatLocalTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hourText = parts.find((part) => part.type === 'hour')?.value || '00';
  const minuteText = parts.find((part) => part.type === 'minute')?.value || '00';

  return {
    hour: Number(hourText),
    label: `${hourText}:${minuteText}`,
  };
}

function getCurrentTemporalContext() {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { year, month, day } = formatLocalDateParts(now, timeZone);
  const { hour, label: timeLabel } = formatLocalTimeParts(now, timeZone);
  const isoDate = `${year}-${month}-${day}`;
  const weekday = new Intl.DateTimeFormat('it-IT', {
    timeZone,
    weekday: 'long',
  }).format(now);
  const isWeekend = weekday === 'sabato' || weekday === 'domenica';
  const dayPhase = hour < 12
    ? 'mattina'
    : hour < 18
      ? 'pomeriggio'
      : hour < 22
        ? 'sera'
        : 'notte';

  return [
    'Contesto temporale attuale:',
    `- Data locale corrente: ${isoDate}.`,
    `- Giorno della settimana corrente: ${weekday}.`,
    `- Ora locale corrente: ${timeLabel} (${dayPhase}).`,
    `- Timezone locale: ${timeZone}.`,
    `- Tipo di giorno: ${isWeekend ? 'weekend' : 'feriale'}.`,
    '- Interpreta riferimenti relativi come oggi, ieri, domani, questa settimana e settimana prossima usando questa data locale come riferimento principale.',
    '- Se utile, esplicita anche la data assoluta per evitare ambiguita temporali.',
  ].join('\n');
}

function buildSystemMessage(contextBlocks: string[], extraSystemPrompt?: string) {
  return [
    DEFAULT_COACH_IDENTITY,
    getCurrentTemporalContext(),
    ...contextBlocks.filter(Boolean),
    extraSystemPrompt,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function parseErrorResponse(response: Response) {
  const fallbackMessage = `AI request failed with status ${response.status}`;

  try {
    const rawText = await response.text();
    if (!rawText) {
      return fallbackMessage;
    }

    try {
      const parsed = JSON.parse(rawText) as { error?: string; message?: string };
      return parsed.error || parsed.message || `${fallbackMessage}: ${rawText}`;
    } catch {
      return `${fallbackMessage}: ${rawText}`;
    }
  } catch {
    return fallbackMessage;
  }
}

export function extractJsonBlock(content: string) {
  if (content.includes('```json')) {
    return content.split('```json')[1].split('```')[0].trim();
  }
  if (content.includes('```')) {
    return content.split('```')[1].split('```')[0].trim();
  }
  return content.trim();
}

interface CoachRequestOptions {
  messages: Message[];
  extraSystemPrompt?: string;
  contextBlocks?: string[];
  temperature?: number;
  onUsage?: (usage: AiUsage | null) => void;
  knowledgeQuery?: string;
  knowledgeScopes?: KnowledgeScope[];
  ragQuery?: string;
  annotateRagSources?: boolean;
}

function appendSourceFooters(content: string, footers: string[], shouldAppend: boolean) {
  const footer = footers.filter(Boolean).join('\n\n');
  if (!shouldAppend || !footer) {
    return content;
  }

  if (content.includes('**Fonti recuperate**') || content.includes('**Fonti scientifiche curate**')) {
    return content;
  }

  return `${content.trim()}\n\n${footer}`;
}

export async function sendCoachRequest({
  messages,
  extraSystemPrompt,
  contextBlocks = [],
  temperature = 0.7,
  onUsage,
  knowledgeQuery,
  knowledgeScopes,
  ragQuery,
  annotateRagSources = true,
}: CoachRequestOptions) {
  const sanitizedMessages = sanitizeConversationMessages(messages);
  const knowledgeContext = knowledgeQuery
    ? buildKnowledgeContext({
        query: knowledgeQuery,
        scopes: knowledgeScopes,
      })
    : '';
  const sciencePayload = ragQuery || knowledgeQuery
    ? buildScienceInsightsContext({
        query: ragQuery || knowledgeQuery || '',
      })
    : { context: '', citations: [] };
  const ragPayload = ragQuery
    ? await buildRagContext({
        query: ragQuery,
      })
    : { context: '', citations: [] };
  const availableCitationIds = [
    ...sciencePayload.citations.map((citation) => citation.citationId),
    ...ragPayload.citations.map((citation) => citation.citationId),
  ];
  const ragCitationInstruction = annotateRagSources && availableCitationIds.length > 0
    ? `Se usi insight scientifici curati o estratti da paper locali, cita inline la fonte con i tag disponibili come ${availableCitationIds.join(', ')}. Mantieni le citazioni vicine alle frasi rilevanti e non inventare tag nuovi.`
    : '';
  const internalFormattingInstruction = 'Non esporre all utente etichette interne della knowledge base o scope tecnici come training, recovery o nutrition tra parentesi quadre. In output mostra solo citazioni scientifiche [S#] e [P#] quando servono.';
  const systemMessage = buildSystemMessage([
    ...contextBlocks,
    ragCitationInstruction,
    internalFormattingInstruction,
  ], extraSystemPrompt);
  const payloadMessages = [
    { role: 'system' as const, content: [systemMessage, knowledgeContext, sciencePayload.context, ragPayload.context].filter(Boolean).join('\n\n') },
    ...sanitizedMessages,
  ];
  const baseUrl = getRequestBaseUrl();

  if (AI_PROVIDER === 'ollama') {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: payloadMessages,
        stream: false,
        options: {
          temperature,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }

    const data = await response.json();
    const content = data?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('AI response payload missing message content');
    }

    onUsage?.(null);

    return appendSourceFooters(
      stripThinkingTags(content),
      [
        buildScienceCitationFooter(sciencePayload.citations),
        buildRagCitationFooter(ragPayload.citations),
      ],
      annotateRagSources,
    );
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: payloadMessages,
      temperature,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const usage: AiUsage | null = data?.usage
    ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      }
    : null;

  if (typeof content !== 'string') {
    throw new Error('AI response payload missing choices[0].message.content');
  }

  onUsage?.(usage);

  return appendSourceFooters(
    stripThinkingTags(content),
    [
      buildScienceCitationFooter(sciencePayload.citations),
      buildRagCitationFooter(ragPayload.citations),
    ],
    annotateRagSources,
  );
}

export function getAiConnectionHint() {
  if (AI_PROVIDER === 'ollama') {
    return `Ollama su ${normalizeBaseUrl(AI_BASE_URL)} con modello ${AI_MODEL}`;
  }

  return `endpoint OpenAI-compatible su ${normalizeBaseUrl(AI_BASE_URL)} con modello ${AI_MODEL}`;
}

export function getConfiguredContextWindow() {
  return Number.isFinite(AI_CONTEXT_WINDOW) && AI_CONTEXT_WINDOW > 0 ? AI_CONTEXT_WINDOW : null;
}
