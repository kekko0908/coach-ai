import { HealthData, Message } from '../types';
import { buildGlobalCoachContext, buildChatCoachContext, CoachContextWindowOptions } from './coachContext';
import { buildKnowledgeContext } from './knowledgeBase';
import { buildRagCitationFooter, buildRagContext } from './retrieval';
import { buildScienceCitationFooter, buildScienceInsightsContext } from './scienceInsights';
import { KnowledgeScope } from '../types/knowledge';
import { RagCitation } from '../types/rag';
import { ScienceCitation } from '../types/science';

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

const DEFAULT_COACH_IDENTITY = `Ruolo:
- Sei FitSync Coach, un personal trainer digitale esperto di allenamento, recupero, composizione corporea e pianificazione sportiva.

Obiettivo:
- aiuta l utente a migliorare performance, costanza e recupero;
- personalizza i consigli usando profilo, dati salute, calendario allenamenti e record quando sono utili;
- rispondi in italiano con tono chiaro, pratico e professionale.

Comportamento:
- apri con una risposta diretta alla domanda;
- usa il contesto fitness quando aumenta precisione o personalizzazione;
- quando sonno o HRV sono bassi, orienta il piano verso riduzione del carico, recupero attivo, mobilita o tecnica;
- rispetta giorni di allenamento, split preferito e impegni gia pianificati;
- usa principi solidi per dimagrimento, ipertrofia, forza e resistenza: progressione graduale, recupero sufficiente, tecnica corretta, volume sostenibile;
- quando emergono segnali compatibili con infortunio serio o sintomi anomali, invita a una valutazione medica;
- quando proponi un piano, rendilo concreto con giorni, focus, volume e note essenziali.`;

export function buildUserContextSummary(healthData?: HealthData | null, options: CoachContextWindowOptions = {}) {
  return buildGlobalCoachContext(healthData, options);
}

export function buildChatContextSummary(healthData?: HealthData | null) {
  return buildChatCoachContext(healthData);
}

export function isReportLikeRequest(content: string) {
  return REPORT_LIKE_REQUEST_PATTERN.test(content);
}

export function buildResponseStyleInstruction(content: string, scope: 'general' | 'workout' | 'dashboard' = 'general') {
  const compactBaseInstruction = [
    '- rispondi subito al punto principale;',
    '- usa solo dati presenti nel prompt e nel messaggio utente, senza inventare;',
    '- mantieni la risposta breve, ordinata e facile da leggere;',
    '- se proponi modifiche a carico o piano, spiega il motivo in una frase;',
    '- se un dato manca, dichiaralo esplicitamente.',
  ];

  if (!isReportLikeRequest(content)) {
    if (scope === 'workout') {
      return [
        ...compactBaseInstruction,
        '- per i workout usa una mini scheda con focus, esercizi e note essenziali.',
      ].join('\n');
    }

    return compactBaseInstruction.join('\n');
  }

  const compactReportInstruction = scope === 'workout'
    ? [
        '- formatta la risposta come report del workout.',
        '- usa queste sezioni: Verdetto, Numeri chiave, Punti forti, Da migliorare, Prossime azioni.',
      ]
    : [
        '- formatta la risposta come report, non come testo libero.',
        '- usa queste sezioni: Verdetto, Numeri chiave, Punti positivi, Criticita, Prossime azioni.',
      ];

  return [
    ...compactBaseInstruction,
    ...compactReportInstruction,
    '- il verdetto iniziale deve stare in 1-2 frasi.',
  ].join('\n');

  const baseInstruction = [
    '- rispondi in modo diretto alla domanda;',
    '- se suggerisci modifiche al carico, spiega il motivo in modo breve;',
    '- quando proponi una scheda o un piano, usa elenchi puntati;',
    '- scrivi prima il punto centrale, poi i dettagli essenziali;',
    '- usa piccole intestazioni visive con emoji e titolo in grassetto, ad esempio `🔥 Focus` o `📊 Numeri chiave`;',
    '- mantieni la risposta ordinata visivamente, con sezioni facili da scansionare;',
    '- lascia sempre una riga vuota tra una sezione e la successiva;',
    '- quando elenchi piu consigli o esercizi, metti ogni punto su una riga separata;',
    '- usa solo le informazioni presenti in questo prompt e nel messaggio utente.',
  ];

  if (!isReportLikeRequest(content)) {
    if (scope === 'workout') {
      return [
        ...baseInstruction,
        '- per i workout usa massimo 3 sezioni con emoji e testo compatto;',
        '- massimo 3 sezioni;',
        '- massimo 3 bullet per sezione;',
        '- evidenzia solo i numeri davvero importanti.',
      ].join('\n');
    }

    return [
      ...baseInstruction,
      '- quando la risposta e lunga, usa sezioni brevi con emoji e massimo 3-4 bullet per sezione.',
    ].join('\n');
  }

  const reportSpecificInstruction = scope === 'workout'
    ? [
        '- formatta la risposta come report leggibile del workout.',
        '- usa esattamente queste sezioni, con emoji e titolo in grassetto: **🧭 Verdetto**, **📊 Numeri Chiave**, **✅ Punti Forti**, **⚠️ Da Migliorare**, **🎯 Prossime Azioni**.',
        '- in `Numeri Chiave` includi solo metriche realmente presenti nei dati del workout.',
      ]
    : [
        '- formatta la risposta come report leggibile e non come testo libero.',
        '- usa esattamente queste sezioni, con emoji e titolo in grassetto: **🧭 Verdetto**, **📊 Numeri Chiave**, **✅ Punti Positivi**, **⚠️ Criticita**, **🎯 Prossime Azioni**.',
        '- in `Numeri Chiave` metti solo valori realmente presenti nei dati recenti, senza inventare metriche o confronti.',
      ];

  return [
    ...baseInstruction,
    ...reportSpecificInstruction,
    '- massimo 5 sezioni e massimo 3 bullet per sezione.',
    '- se un dato manca, scrivi esplicitamente che non e disponibile.',
    '- il verdetto iniziale deve stare in 1-2 frasi.',
    '- usa confronti solo quando i dati li supportano in modo esplicito.',
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
  if (!content) {
    return content;
  }

  let sanitized = content.replace(/<think>[\s\S]*?<\/think>/g, '');

  if (sanitized.includes('</think>')) {
    sanitized = sanitized.split('</think>').slice(-1)[0];
  }

  return sanitized.replace(/<\/?think>/g, '').trim();
}

function isQwenThinkingSwitchSupported(model: string) {
  return /\bqwen3\b/i.test(model) || /\bqwen\/qwen3/i.test(model);
}

function buildThinkingModeInstruction(thinkingMode: 'default' | 'enabled' | 'disabled') {
  if (!isQwenThinkingSwitchSupported(AI_MODEL)) {
    return '';
  }

  if (thinkingMode === 'enabled') {
    return '/think';
  }

  if (thinkingMode === 'disabled') {
    return '/no_think';
  }

  return '';
}

function sanitizeConversationMessages(messages: Message[]) {
  const firstUserIndex = messages.findIndex((message) => message.role === 'user');

  if (firstUserIndex <= 0) {
    return messages;
  }

  return messages.slice(firstUserIndex);
}

function selectConversationMessages(
  messages: Message[],
  maxRecentMessages?: number,
  summaryMessageCount?: number,
) {
  const firstUserIndex = messages.findIndex((message) => message.role === 'user');
  const sanitizedMessages = sanitizeConversationMessages(messages);

  if (!maxRecentMessages || sanitizedMessages.length <= maxRecentMessages) {
    return sanitizedMessages;
  }

  if (!summaryMessageCount || summaryMessageCount <= 0) {
    return sanitizedMessages;
  }

  const sanitizedOffset = firstUserIndex > 0 ? firstUserIndex : 0;
  const coveredMessages = Math.max(0, (summaryMessageCount || 0) - sanitizedOffset);
  const startIndex = Math.max(coveredMessages, sanitizedMessages.length - maxRecentMessages);
  return sanitizedMessages.slice(startIndex);
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
    '- Quando chiarisce la risposta, esplicita anche la data assoluta.',
  ].join('\n');
}

function wrapXmlBlock(tag: string, content: string) {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

function buildSystemMessage(contextBlocks: string[], extraSystemPrompt?: string) {
  const semanticBlocks = [
    wrapXmlBlock('persona', DEFAULT_COACH_IDENTITY),
    wrapXmlBlock('temporal_context', getCurrentTemporalContext()),
    contextBlocks.filter(Boolean).length > 0
      ? wrapXmlBlock('user_context', contextBlocks.filter(Boolean).join('\n\n'))
      : '',
    extraSystemPrompt ? wrapXmlBlock('response_rules', extraSystemPrompt) : '',
  ].filter(Boolean);

  return semanticBlocks.join('\n\n');
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
  includeKnowledgeContext?: boolean;
  includeScienceInsights?: boolean;
  includeRagContext?: boolean;
  maxRecentMessages?: number;
  summaryMessageCount?: number;
  signal?: AbortSignal;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
}

export interface CoachRequestPreview {
  provider: LlmProvider;
  model: string;
  temperature: number;
  systemMessage: string;
  payloadMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  selectedMessages: Message[];
  contextBlocks: string[];
  knowledgeContext: string;
  scienceContext: string;
  ragContext: string;
  flags: {
    includeKnowledgeContext: boolean;
    includeScienceInsights: boolean;
    includeRagContext: boolean;
    annotateRagSources: boolean;
    thinkingMode: 'default' | 'enabled' | 'disabled';
  };
  scienceCitations: ScienceCitation[];
  ragCitations: RagCitation[];
  currentUserMessage: string | null;
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

function sanitizeInlineCitationPlaceholders(content: string, allowedCitationIds: string[]) {
  if (!content) {
    return content;
  }

  const firstScienceCitation = allowedCitationIds.find((id) => id.startsWith('[S')) || '';
  const firstPaperCitation = allowedCitationIds.find((id) => id.startsWith('[P')) || '';

  return content
    .replace(/\[S#\]/g, firstScienceCitation)
    .replace(/\[P#\]/g, firstPaperCitation)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

export async function prepareCoachRequest({
  messages,
  extraSystemPrompt,
  contextBlocks = [],
  temperature = 0.7,
  knowledgeQuery,
  knowledgeScopes,
  ragQuery,
  annotateRagSources = true,
  includeKnowledgeContext = true,
  includeScienceInsights = true,
  includeRagContext = true,
  maxRecentMessages,
  summaryMessageCount,
  thinkingMode = 'default',
}: Omit<CoachRequestOptions, 'onUsage' | 'signal'>): Promise<CoachRequestPreview> {
  const selectedMessages = selectConversationMessages(messages, maxRecentMessages, summaryMessageCount);
  const knowledgeContext = includeKnowledgeContext && knowledgeQuery
    ? buildKnowledgeContext({
        query: knowledgeQuery,
        scopes: knowledgeScopes,
      })
    : '';
  const sciencePayload = includeScienceInsights && (ragQuery || knowledgeQuery)
    ? buildScienceInsightsContext({
        query: ragQuery || knowledgeQuery || '',
      })
    : { context: '', citations: [] };
  const ragPayload = includeRagContext && ragQuery
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
  const thinkingModeInstruction = buildThinkingModeInstruction(thinkingMode);
  const systemMessage = buildSystemMessage([
    thinkingModeInstruction,
    ...contextBlocks,
    ragCitationInstruction,
    internalFormattingInstruction,
  ], extraSystemPrompt);
  const payloadMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: [systemMessage, knowledgeContext, sciencePayload.context, ragPayload.context].filter(Boolean).join('\n\n') },
    ...selectedMessages,
  ];

  return {
    provider: AI_PROVIDER,
    model: AI_MODEL,
    temperature,
    systemMessage,
    payloadMessages,
    selectedMessages,
    contextBlocks,
    knowledgeContext,
    scienceContext: sciencePayload.context,
    ragContext: ragPayload.context,
    flags: {
      includeKnowledgeContext,
      includeScienceInsights,
      includeRagContext,
      annotateRagSources,
      thinkingMode,
    },
    scienceCitations: sciencePayload.citations,
    ragCitations: ragPayload.citations,
    currentUserMessage: [...selectedMessages].reverse().find((message) => message.role === 'user')?.content || null,
  };
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
  includeKnowledgeContext = true,
  includeScienceInsights = true,
  includeRagContext = true,
  maxRecentMessages,
  summaryMessageCount,
  signal,
  thinkingMode = 'default',
}: CoachRequestOptions) {
  const preview = await prepareCoachRequest({
    messages,
    extraSystemPrompt,
    contextBlocks,
    temperature,
    knowledgeQuery,
    knowledgeScopes,
    ragQuery,
    annotateRagSources,
    includeKnowledgeContext,
    includeScienceInsights,
    includeRagContext,
    maxRecentMessages,
    summaryMessageCount,
    thinkingMode,
  });
  const allowedCitationIds = [
    ...preview.scienceCitations.map((citation) => citation.citationId),
    ...preview.ragCitations.map((citation) => citation.citationId),
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
        messages: preview.payloadMessages,
        stream: false,
        options: {
          temperature,
        },
      }),
      signal,
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
      sanitizeInlineCitationPlaceholders(stripThinkingTags(content), allowedCitationIds),
      [
        buildScienceCitationFooter(preview.scienceCitations),
        buildRagCitationFooter(preview.ragCitations),
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
      messages: preview.payloadMessages,
      temperature,
    }),
    signal,
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
    sanitizeInlineCitationPlaceholders(stripThinkingTags(content), allowedCitationIds),
    [
      buildScienceCitationFooter(preview.scienceCitations),
      buildRagCitationFooter(preview.ragCitations),
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
