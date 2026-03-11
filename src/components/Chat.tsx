import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Bot, User, Loader2, Activity, Brain, RotateCcw, Mic, MicOff, History, FlaskConical, Folder, FolderPlus, Inbox, Trash2, GripVertical, Palette, Square, FileText, Clock3, X, CalendarDays, TrendingUp, Dumbbell, Target } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { HealthData, Message } from '../types';
import { AiUsage, buildChatContextSummary, buildResponseStyleInstruction, getAiConnectionHint, getConfiguredContextWindow, prepareCoachRequest, sendCoachRequest, type CoachRequestPreview } from '../utils/aiClient';
import { formatAssistantMarkdown } from '../utils/aiFormatting';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { buildStructuredHealthReportPreview, generateStructuredHealthReport } from '../utils/reportComposer';
import { ChatFolder, ChatSession } from '../types/chat';
import { getStoredScienceModeEnabled, getStoredThinkerModeEnabled, getStoredWorkouts, setStoredScienceModeEnabled, setStoredThinkerModeEnabled } from '../lib/appDataStore';
import ChatInlineCompanion from './ChatInlineCompanion';
import { resolveChatVisualContext } from '../utils/chatVisualContext';
import {
  createGeneralChatFolder,
  deleteGeneralChatFolder,
  deleteGeneralChatSession,
  getGeneralChatFolders,
  getGeneralChatSessions,
  getOrCreateCurrentGeneralChat,
  moveGeneralChatSession,
  setCurrentGeneralChatSession,
  startFreshGeneralChat,
  startFreshGeneralChatFromSummary,
  updateGeneralChatFolderColor,
  upsertChatSession,
} from '../utils/chatSessions';
import { generateChatSummary } from '../utils/chatSummary';
import { buildRequestPlanContextBlock, planChatRequest } from '../utils/requestPlanner';
import { CHAT_SHORTCUTS, ChatShortcutDefinition, ChatShortcutId } from '../utils/chatShortcuts';

interface ChatProps {
  healthData: HealthData | null;
  onNavigateTab: (tab: string) => void;
}

const CHAT_WELCOME_MESSAGE = 'Ciao! Sono il tuo AI coach. Posso aiutarti con allenamento, recupero, split e lettura dei tuoi dati salute.';
const CHAT_CARRY_OVER_MESSAGE = 'Ho aperto una nuova chat e ho mantenuto un riassunto del contesto precedente, cosi possiamo continuare senza trascinare tutta la cronologia.';
const DEFAULT_CHAT_MESSAGES: Message[] = [{ role: 'assistant', content: CHAT_WELCOME_MESSAGE }];
const SCIENCE_BACKED_PATTERN = /\[(S|P)\d+\]/;
const MAX_RAW_CHAT_MESSAGES = 8;
const AUTO_SUMMARY_MIN_MESSAGES = 12;
const AUTO_SUMMARY_REFRESH_INTERVAL = 6;
const FOLDER_COLORS = [
  { id: 'emerald', dot: 'bg-emerald-400', border: 'border-emerald-400/35', surface: 'bg-emerald-500/10', text: 'text-emerald-200' },
  { id: 'amber', dot: 'bg-amber-300', border: 'border-amber-300/35', surface: 'bg-amber-400/10', text: 'text-amber-100' },
  { id: 'sky', dot: 'bg-sky-300', border: 'border-sky-300/35', surface: 'bg-sky-400/10', text: 'text-sky-100' },
  { id: 'rose', dot: 'bg-rose-300', border: 'border-rose-300/35', surface: 'bg-rose-400/10', text: 'text-rose-100' },
  { id: 'violet', dot: 'bg-violet-300', border: 'border-violet-300/35', surface: 'bg-violet-400/10', text: 'text-violet-100' },
  { id: 'zinc', dot: 'bg-zinc-300', border: 'border-zinc-500/40', surface: 'bg-zinc-800/80', text: 'text-zinc-200' },
] as const;

const SHORTCUT_TONE_STYLES: Record<ChatShortcutDefinition['tone'], string> = {
  emerald: 'border-emerald-500/18 bg-emerald-500/[0.06] text-emerald-100 hover:border-emerald-300/30 hover:bg-emerald-500/[0.11] hover:text-white',
  sky: 'border-sky-400/18 bg-sky-400/[0.06] text-sky-100 hover:border-sky-300/30 hover:bg-sky-400/[0.11] hover:text-white',
  amber: 'border-amber-400/18 bg-amber-400/[0.06] text-amber-100 hover:border-amber-300/30 hover:bg-amber-400/[0.11] hover:text-white',
  rose: 'border-rose-400/18 bg-rose-400/[0.06] text-rose-100 hover:border-rose-300/30 hover:bg-rose-400/[0.11] hover:text-white',
};

const EXPLICIT_SOURCE_REQUEST_PATTERN = /\b(scienz|scientif|studio|studi|paper|review|meta-anal|evidenz|citaz|fonte|fonti)\b/i;

function getShortcutIcon(shortcutId: ChatShortcutId) {
  switch (shortcutId) {
    case 'report_this_week':
      return CalendarDays;
    case 'report_this_month':
      return TrendingUp;
    case 'hypertrophy_practical':
      return Dumbbell;
    case 'workout_today':
      return Target;
    default:
      return Activity;
  }
}

function formatTokenCount(value?: number) {
  if (!value) return '--';
  return value.toLocaleString('it-IT');
}

function formatDurationMs(value: number) {
  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
}

function formatSessionTimestamp(value: string) {
  const date = new Date(value);
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isScienceBacked(content: string) {
  return SCIENCE_BACKED_PATTERN.test(content);
}

function getFolderColorTone(color?: string) {
  return FOLDER_COLORS.find((item) => item.id === color) || FOLDER_COLORS[0];
}

function shouldRefreshSummary(session: ChatSession, messages: Message[]) {
  const messageCount = messages.length;
  const summarizedCount = session.summaryMessageCount ?? 0;
  return messageCount >= AUTO_SUMMARY_MIN_MESSAGES && (messageCount - summarizedCount) >= AUTO_SUMMARY_REFRESH_INTERVAL;
}

function needsPromptCompaction(session: ChatSession, messages: Message[]) {
  return messages.length > MAX_RAW_CHAT_MESSAGES && ((session.summaryMessageCount ?? 0) <= 0 || shouldRefreshSummary(session, messages));
}

export default function Chat({ healthData, onNavigateTab }: ChatProps) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<Message[]>(DEFAULT_CHAT_MESSAGES);
  const [generalSessions, setGeneralSessions] = useState<ChatSession[]>([]);
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [armedMoveSessionId, setArmedMoveSessionId] = useState<string | null>(null);
  const [colorPickerFolderId, setColorPickerFolderId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [isSummarizingChat, setIsSummarizingChat] = useState(false);
  const [lastUsage, setLastUsage] = useState<AiUsage | null>(null);
  const [lastResponseDurationMs, setLastResponseDurationMs] = useState<number | null>(null);
  const [requestElapsedMs, setRequestElapsedMs] = useState(0);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [requestStatusMessage, setRequestStatusMessage] = useState<string | null>(null);
  const [isThinkerModeEnabled, setIsThinkerModeEnabled] = useState(() => getStoredThinkerModeEnabled());
  const [isScienceModeEnabled, setIsScienceModeEnabled] = useState(() => getStoredScienceModeEnabled());
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [isPromptPreviewLoading, setIsPromptPreviewLoading] = useState(false);
  const [promptPreview, setPromptPreview] = useState<CoachRequestPreview | null>(null);
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAutoSummarizingRef = useRef(false);
  const latestMessagesRef = useRef<Message[]>(DEFAULT_CHAT_MESSAGES);
  const latestSessionRef = useRef<ChatSession | null>(null);
  const currentAbortControllerRef = useRef<AbortController | null>(null);
  const configuredContextWindow = getConfiguredContextWindow();
  const contextRatio = configuredContextWindow && lastUsage?.totalTokens
    ? lastUsage.totalTokens / configuredContextWindow
    : null;
  const contextToneClass = contextRatio && contextRatio >= 0.85
    ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
    : 'border-zinc-700 bg-zinc-800 text-zinc-300';
  const {
    isSupported: isSpeechSupported,
    isListening,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    onTranscript: setInput,
  });
  const refreshOrganizer = () => {
    setGeneralSessions(getGeneralChatSessions());
    setFolders(getGeneralChatFolders());
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    latestSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const initialSession = getOrCreateCurrentGeneralChat(DEFAULT_CHAT_MESSAGES);
    setCurrentGeneralChatSession(initialSession.id);
    setSession(initialSession);
    setMessages(initialSession.messages);
    refreshOrganizer();
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    setSession((prev) => {
      if (!prev) {
        return prev;
      }

      const nextSession = upsertChatSession({
        ...prev,
        messages,
      });
      refreshOrganizer();
      return nextSession;
    });
  }, [messages, session?.id]);

  useEffect(() => {
    setStoredThinkerModeEnabled(isThinkerModeEnabled);
    window.dispatchEvent(new CustomEvent('fitsync:thinker-mode-changed', {
      detail: isThinkerModeEnabled,
    }));
  }, [isThinkerModeEnabled]);

  useEffect(() => {
    setStoredScienceModeEnabled(isScienceModeEnabled);
  }, [isScienceModeEnabled]);

  useEffect(() => {
    if (!isLoading || requestStartedAt === null) {
      return;
    }

    setRequestElapsedMs(Date.now() - requestStartedAt);
    const timer = window.setInterval(() => {
      setRequestElapsedMs(Date.now() - requestStartedAt);
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [isLoading, requestStartedAt]);

  const refreshSessionSummary = async (targetSession: ChatSession, targetMessages: Message[], force = false) => {
    if (isAutoSummarizingRef.current) {
      return targetSession;
    }

    if (!force && !shouldRefreshSummary(targetSession, targetMessages)) {
      return targetSession;
    }

    isAutoSummarizingRef.current = true;

    try {
      const summary = await generateChatSummary({
        messages: targetMessages,
        healthData,
        previousSummary: targetSession.summary,
        signal: currentAbortControllerRef.current?.signal,
      });
      if (latestSessionRef.current?.id !== targetSession.id || latestMessagesRef.current.length !== targetMessages.length) {
        return latestSessionRef.current || targetSession;
      }
      const nextSession = upsertChatSession({
        ...targetSession,
        messages: targetMessages,
        summary,
        summaryMessageCount: targetMessages.length,
      });

      setSession((current) => (current?.id === nextSession.id ? nextSession : current));
      refreshOrganizer();
      return nextSession;
    } catch (error) {
      console.error('Auto chat summary error:', error);
      return targetSession;
    } finally {
      isAutoSummarizingRef.current = false;
    }
  };

  const ensureSessionCompactedForPrompt = async (targetSession: ChatSession, targetMessages: Message[]) => {
    if (!needsPromptCompaction(targetSession, targetMessages)) {
      return targetSession;
    }

    return refreshSessionSummary(targetSession, targetMessages, true);
  };

  const buildOperationalSystemPrompt = (userMessage: string, shouldUseScience: boolean, shouldUseThinker: boolean) => `Indicazioni operative per la chat:
- l'utente vuole allenarsi con continuita;
- ${buildResponseStyleInstruction(userMessage, 'general').split('\n').join('\n- ').replace(/^- /, '')}
- thinker=${shouldUseThinker ? 'on' : 'off'}.
- science=${shouldUseScience ? 'on' : 'off'}.
${shouldUseThinker
  ? '- prima di rispondere, fai un ragionamento piu approfondito; poi restituisci una risposta finale ordinata, chiara e sintetica, senza mostrare catena di pensiero privata.'
  : '- rispondi in modo diretto e breve, senza espandere il ragionamento oltre il necessario.'}
${shouldUseScience
  ? '- integra evidenze scientifiche o paper locali quando disponibili; se il sistema ti fornisce fonti curate, usa almeno 1 citazione inline vicina alla frase rilevante.'
  : '- non aggiungere knowledge base, studi o paper se non richiesti esplicitamente dalla modalita science.'}`;

  const buildPlannedRequestConfig = async (userMessage: string, activeSession: ChatSession, baseMessages: Message[]) => {
    const compactedSession = await ensureSessionCompactedForPrompt(activeSession, baseMessages);
    const requestPlan = await planChatRequest({
      input: userMessage,
      healthData,
      manualScienceEnabled: isScienceModeEnabled,
      manualThinkerEnabled: isThinkerModeEnabled,
    });
    const shouldUseScience = requestPlan.scienceEffective;
    const shouldUseThinker = requestPlan.thinkerEffective;
    const contextBlocks = [
      requestPlan.needsCoachContext ? buildChatContextSummary(healthData) : '',
      compactedSession.summary ? `Riassunto chat precedente da portare avanti:\n${compactedSession.summary}` : '',
      buildRequestPlanContextBlock(requestPlan),
    ].filter(Boolean);

    return {
      compactedSession,
      requestPlan,
      shouldUseScience,
      shouldUseThinker,
      contextBlocks,
      knowledgeScopes: requestPlan.knowledgeScopes.length > 0 ? requestPlan.knowledgeScopes : undefined,
      thinkingMode: shouldUseThinker ? 'enabled' as const : 'disabled' as const,
      extraSystemPrompt: buildOperationalSystemPrompt(userMessage, shouldUseScience, shouldUseThinker),
    };
  };

  const buildShortcutSystemPrompt = (shortcut: ChatShortcutDefinition, shouldUseScience: boolean, shouldUseThinker: boolean) => {
    switch (shortcut.id) {
      case 'report_this_week':
      case 'report_this_month':
        return [
          'Flusso shortcut attivo: report guidato dal sistema.',
          'Scrivi un riepilogo operativo usando solo la finestra temporale dello shortcut.',
          'Apri con un verdetto breve, poi punti positivi, criticita e prossime azioni.',
          'Usa i numeri gia calcolati dal sistema come fonte principale.',
          shouldUseScience
            ? 'Integra fonti scientifiche solo quando rafforzano davvero le azioni consigliate.'
            : 'Resta sui dati del sistema e sulle azioni pratiche senza retrieval extra.',
          shouldUseThinker
            ? 'Ragiona con calma sulla priorita degli interventi.'
            : 'Mantieni una risposta compatta e pratica.',
        ].join('\n');
      case 'hypertrophy_practical':
        return [
          'Flusso shortcut attivo: coaching pratico per massa muscolare.',
          'Costruisci una risposta molto concreta e utilizzabile subito.',
          'Dai priorita a progressione del carico, volume sostenibile, recupero e nutrizione.',
          'Mantieni il focus su consigli applicabili ai prossimi 7-14 giorni.',
          shouldUseScience
            ? 'Quando il sistema fornisce fonti curate, aggancia almeno una raccomandazione a una citazione inline.'
            : 'Resta sul coaching pratico e personalizzato.',
        ].join('\n');
      case 'workout_today':
        return [
          'Flusso shortcut attivo: workout di oggi.',
          'Costruisci una singola sessione pronta da eseguire oggi.',
          'Usa readiness, split, ultimo carico e vincoli attuali per scegliere focus e volume.',
          'Scrivi la risposta come mini scheda: focus, esercizi, serie/ripetizioni, note essenziali.',
          shouldUseThinker
            ? 'Bilancia con attenzione carico e recupero residuo.'
            : 'Privilegia chiarezza e velocita operativa.',
        ].join('\n');
      default:
        return '';
    }
  };

  const buildShortcutRequestConfig = async (shortcut: ChatShortcutDefinition, activeSession: ChatSession, baseMessages: Message[]) => {
    const compactedSession = await ensureSessionCompactedForPrompt(activeSession, baseMessages);
    const explicitSourceRequest = EXPLICIT_SOURCE_REQUEST_PATTERN.test(shortcut.prompt);
    const shouldUseScience = isScienceModeEnabled || explicitSourceRequest;
    const shouldUseThinker = isThinkerModeEnabled;
    const baseContextBlocks = [
      buildChatContextSummary(healthData),
      compactedSession.summary ? `Riassunto chat precedente da portare avanti:\n${compactedSession.summary}` : '',
      [
        'SHORTCUT ATTIVO:',
        `- Id: ${shortcut.id}.`,
        `- Label: ${shortcut.label}.`,
        `- Intento guidato dal sistema: ${shortcut.description}.`,
      ].join('\n'),
    ].filter(Boolean);

    const commonConfig = {
      compactedSession,
      shouldUseScience,
      shouldUseThinker,
      contextBlocks: baseContextBlocks,
      knowledgeScopes: shouldUseScience
        ? (shortcut.id === 'hypertrophy_practical'
            ? ['training', 'nutrition'] as const
            : shortcut.id === 'workout_today'
              ? ['training', 'recovery'] as const
              : ['training', 'recovery', 'nutrition'] as const)
        : undefined,
      thinkingMode: shouldUseThinker ? 'enabled' as const : 'disabled' as const,
      extraSystemPrompt: buildShortcutSystemPrompt(shortcut, shouldUseScience, shouldUseThinker),
    };

    return {
      ...commonConfig,
      reportLike: shortcut.id === 'report_this_week' || shortcut.id === 'report_this_month',
      includeKnowledgeContext: shouldUseScience,
      includeScienceInsights: shouldUseScience,
      includeRagContext: explicitSourceRequest,
    };
  };

  const buildChatPromptRequestPreview = async (userMessage: string, activeSession: ChatSession) => {
    const planned = await buildPlannedRequestConfig(userMessage, activeSession, messages);

    if (planned.requestPlan.reportLike && healthData) {
      return buildStructuredHealthReportPreview({
        userPrompt: userMessage,
        healthData,
        windowDays: 30,
        knowledgeQuery: planned.shouldUseScience ? userMessage : undefined,
        ragQuery: planned.shouldUseScience && planned.requestPlan.includeRagContext ? userMessage : undefined,
        thinkingMode: planned.thinkingMode,
        extraContextBlocks: planned.contextBlocks,
      });
    }

    return prepareCoachRequest({
      messages: [...messages, { role: 'user', content: userMessage }],
      contextBlocks: planned.contextBlocks,
      knowledgeQuery: planned.shouldUseScience ? userMessage : undefined,
      knowledgeScopes: planned.knowledgeScopes,
      ragQuery: planned.shouldUseScience && planned.requestPlan.includeRagContext ? userMessage : undefined,
      includeKnowledgeContext: planned.requestPlan.includeKnowledgeContext,
      includeScienceInsights: planned.requestPlan.includeScienceInsights,
      includeRagContext: planned.requestPlan.includeRagContext,
      maxRecentMessages: MAX_RAW_CHAT_MESSAGES,
      summaryMessageCount: planned.compactedSession.summaryMessageCount,
      thinkingMode: planned.thinkingMode,
      extraSystemPrompt: planned.extraSystemPrompt,
    });
  };

  const handleOpenPromptPreview = async () => {
    if (!input.trim() || !session || isLoading) {
      return;
    }

    setIsPromptModalOpen(true);
    setIsPromptPreviewLoading(true);
    setPromptPreviewError(null);

    try {
      const preview = await buildChatPromptRequestPreview(input.trim(), session);
      setPromptPreview(preview);
    } catch (error) {
      console.error('Prompt preview error:', error);
      setPromptPreviewError(error instanceof Error ? error.message : 'Anteprima prompt non disponibile.');
    } finally {
      setIsPromptPreviewLoading(false);
    }
  };

  const handleStopRequest = () => {
    currentAbortControllerRef.current?.abort();
  };

  useEffect(() => {
    if (!session || isLoading || isSummarizingChat) {
      return;
    }

    if (!shouldRefreshSummary(session, messages)) {
      return;
    }

    void refreshSessionSummary(session, messages);
  }, [messages, session, isLoading, isSummarizingChat]);

  const executeChatRequest = async (userMessage: string, shortcut?: ChatShortcutDefinition) => {
    if (!userMessage.trim() || isLoading || !session) return;

    const requestController = new AbortController();
    const requestStartedNow = Date.now();
    currentAbortControllerRef.current = requestController;
    setIsLoading(true);
    setLoadingSessionId(session.id);
    setRequestStartedAt(requestStartedNow);
    setRequestElapsedMs(0);
    setRequestStatusMessage(shortcut ? `Shortcut in corso: ${shortcut.label}...` : 'Planner in corso...');

    try {
      const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];

      setInput('');
      setMessages(newMessages);
      const requestConfig = shortcut
        ? await buildShortcutRequestConfig(shortcut, session, newMessages)
        : await buildPlannedRequestConfig(userMessage, session, newMessages);
      setLoadingSessionId(requestConfig.compactedSession.id);
      setRequestStatusMessage(shortcut
        ? `Shortcut pronto: ${shortcut.label}. Avvio modello principale...`
        : `Planner completato: ${requestConfig.requestPlan.intent} | science ${requestConfig.shouldUseScience ? 'ON' : 'OFF'} | thinker ${requestConfig.shouldUseThinker ? 'ON' : 'OFF'}. Avvio modello principale...`);

      const reply = requestConfig.reportLike && healthData
        ? await generateStructuredHealthReport({
            userPrompt: userMessage,
            healthData,
            windowDays: 30,
            knowledgeQuery: requestConfig.shouldUseScience ? userMessage : undefined,
            ragQuery: requestConfig.shouldUseScience && requestConfig.includeRagContext ? userMessage : undefined,
            thinkingMode: requestConfig.thinkingMode,
            extraContextBlocks: requestConfig.contextBlocks,
            signal: requestController.signal,
          })
        : await sendCoachRequest({
            messages: newMessages,
            contextBlocks: requestConfig.contextBlocks,
            knowledgeQuery: requestConfig.shouldUseScience ? userMessage : undefined,
            knowledgeScopes: requestConfig.knowledgeScopes,
            ragQuery: requestConfig.shouldUseScience && requestConfig.includeRagContext ? userMessage : undefined,
            includeKnowledgeContext: requestConfig.includeKnowledgeContext,
            includeScienceInsights: requestConfig.includeScienceInsights,
            includeRagContext: requestConfig.includeRagContext,
            maxRecentMessages: MAX_RAW_CHAT_MESSAGES,
            summaryMessageCount: requestConfig.compactedSession.summaryMessageCount,
            signal: requestController.signal,
            thinkingMode: requestConfig.thinkingMode,
            extraSystemPrompt: requestConfig.extraSystemPrompt,
            onUsage: setLastUsage,
          });

      const nextMessages = [...newMessages, { role: 'assistant' as const, content: reply }];
      setMessages(nextMessages);
      setLastResponseDurationMs(Date.now() - requestStartedNow);
      setRequestStatusMessage(null);
      void refreshSessionSummary(session, nextMessages);
    } catch (error) {
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      if (isAborted) {
        setRequestStatusMessage('Elaborazione interrotta.');
        return;
      }
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Impossibile contattare il modello locale. Verifica ${getAiConnectionHint()}.`,
        },
      ]);
    } finally {
      currentAbortControllerRef.current = null;
      setIsLoading(false);
      setLoadingSessionId(null);
      setRequestStartedAt(null);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeChatRequest(input.trim());
  };

  const handleShortcutRun = async (shortcut: ChatShortcutDefinition) => {
    await executeChatRequest(shortcut.prompt, shortcut);
  };

  const handleResetChat = () => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    const nextSession = startFreshGeneralChat(DEFAULT_CHAT_MESSAGES);
    setCurrentGeneralChatSession(nextSession.id);
    setSession(nextSession);
    setMessages(nextSession.messages);
    refreshOrganizer();
    setInput('');
    setLastUsage(null);
  };

  const handleStartSummarizedChat = async () => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    setIsSummarizingChat(true);

    try {
      const summary = await generateChatSummary({
        messages,
        healthData,
        previousSummary: session?.summary,
      });

      const nextSession = startFreshGeneralChatFromSummary({
        initialMessages: [
          ...DEFAULT_CHAT_MESSAGES,
          { role: 'assistant', content: CHAT_CARRY_OVER_MESSAGE },
        ],
        summary,
      });

      setCurrentGeneralChatSession(nextSession.id);
      setSession(nextSession);
      setMessages(nextSession.messages);
      refreshOrganizer();
      setInput('');
      setLastUsage(null);
    } catch (error) {
      console.error('Chat summary error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Non sono riuscito a creare il riassunto della chat corrente. Puoi riprovare tra poco.',
        },
      ]);
    } finally {
      setIsSummarizingChat(false);
    }
  };

  const handleToggleListening = () => {
    if (!isSpeechSupported || isLoading) {
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    startListening();
  };

  const handleSelectSession = (selectedSession: ChatSession) => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    setCurrentGeneralChatSession(selectedSession.id);
    setSession(selectedSession);
    setMessages(selectedSession.messages);
    setInput('');
    setLastUsage(null);
  };

  const handleCreateFolder = () => {
    if (isLoading || isSummarizingChat || !newFolderName.trim()) {
      return;
    }

    try {
      createGeneralChatFolder(newFolderName);
      setNewFolderName('');
      refreshOrganizer();
    } catch (error) {
      console.error('Folder create error:', error);
    }
  };

  const handleMoveSession = (sessionId: string, folderId?: string) => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    const movedSession = moveGeneralChatSession(sessionId, folderId);
    if (movedSession && session?.id === sessionId) {
      setSession(movedSession);
    }
    refreshOrganizer();
  };

  const handleArmMoveSession = (sessionId: string) => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    setArmedMoveSessionId((prev) => (prev === sessionId ? null : sessionId));
  };

  const handleQuickMove = (folderId?: string) => {
    if (!armedMoveSessionId) {
      return;
    }

    handleMoveSession(armedMoveSessionId, folderId);
    setArmedMoveSessionId(null);
  };

  const handleDragStart = (event: React.DragEvent<HTMLElement>, sessionId: string) => {
    if (isLoading || isSummarizingChat) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
    setDraggingSessionId(sessionId);
  };

  const handleDragEnd = () => {
    setDraggingSessionId(null);
    setDropTargetId(null);
  };

  const handleDropZoneOver = (event: React.DragEvent<HTMLElement>, targetId: string) => {
    if (!draggingSessionId || isLoading || isSummarizingChat) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetId);
  };

  const handleDropZoneLeave = (targetId: string) => {
    if (dropTargetId === targetId) {
      setDropTargetId(null);
    }
  };

  const handleDropOnTarget = (event: React.DragEvent<HTMLElement>, folderId?: string) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData('text/plain') || draggingSessionId;

    setDropTargetId(null);
    setDraggingSessionId(null);
    setArmedMoveSessionId(null);

    if (!sessionId) {
      return;
    }

    handleMoveSession(sessionId, folderId);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    const isCurrent = session?.id === sessionId;
    deleteGeneralChatSession(sessionId);

    const nextSessions = getGeneralChatSessions();
    refreshOrganizer();
    setArmedMoveSessionId((prev) => (prev === sessionId ? null : prev));

    if (!isCurrent) {
      return;
    }

    const nextSession = nextSessions[0] || startFreshGeneralChat(DEFAULT_CHAT_MESSAGES);
    setCurrentGeneralChatSession(nextSession.id);
    setSession(nextSession);
    setMessages(nextSession.messages);
    setInput('');
    setLastUsage(null);
    refreshOrganizer();
  };

  const handleDeleteFolder = (folderId: string) => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    deleteGeneralChatFolder(folderId);
    if (session?.folderId === folderId) {
      setSession((prev) => (prev ? { ...prev, folderId: undefined } : prev));
    }
    setArmedMoveSessionId(null);
    setColorPickerFolderId((prev) => (prev === folderId ? null : prev));
    refreshOrganizer();
  };

  const handleUpdateFolderColor = (folderId: string, color: string) => {
    if (isLoading || isSummarizingChat) {
      return;
    }

    updateGeneralChatFolderColor(folderId, color);
    refreshOrganizer();
  };

  const inboxSessions = generalSessions.filter((item) => !item.folderId);
  const folderGroups = folders.map((folder) => ({
    folder,
    sessions: generalSessions.filter((item) => item.folderId === folder.id),
  }));
  const latestAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 1; index -= 1) {
      if (messages[index].role === 'assistant' && messages[index - 1].role === 'user') {
        return index;
      }
    }

    return -1;
  }, [messages]);
  const companionPrompt = latestAssistantIndex > 0 ? messages[latestAssistantIndex - 1].content : null;
  const companionWorkouts = useMemo(() => getStoredWorkouts(), [messages.length]);
  const companionContext = useMemo(
    () => (!isLoading && companionPrompt ? resolveChatVisualContext(companionPrompt, healthData, companionWorkouts) : null),
    [isLoading, companionPrompt, healthData, companionWorkouts],
  );
  const companionWorkoutCount = useMemo(
    () => companionContext?.kind === 'trend'
      ? companionWorkouts.filter((workout) => workout.date >= companionContext.startDate && workout.date <= companionContext.endDate).length
      : 0,
    [companionContext, companionWorkouts],
  );

  const renderSessionCard = (item: ChatSession) => {
    const isCurrent = session?.id === item.id;
    const firstUserMessage = item.messages.find((message) => message.role === 'user')?.content;
    const isDragging = draggingSessionId === item.id;
    const isArmedForMove = armedMoveSessionId === item.id;

    return (
      <article
        key={item.id}
        className={`rounded-2xl border p-3 transition-colors ${
          isCurrent
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
        } ${isDragging ? 'opacity-55 ring-1 ring-emerald-400/40' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => handleSelectSession(item)}
            disabled={isLoading || isSummarizingChat}
            className="min-w-0 flex-1 text-left disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`truncate text-sm font-semibold ${isCurrent ? 'text-emerald-300' : 'text-white'}`}>
                  {item.title}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {formatSessionTimestamp(item.updatedAt)}
                </div>
              </div>
              {item.summary && (
                <span className="shrink-0 rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sky-300">
                  Summary
                </span>
              )}
            </div>
            {firstUserMessage && (
              <div className="mt-2 line-clamp-2 text-xs text-zinc-400">
                {firstUserMessage}
              </div>
            )}
          </button>
          <button
            type="button"
            draggable={!isLoading && !isSummarizingChat}
            onDragStart={(event) => handleDragStart(event, item.id)}
            onDragEnd={handleDragEnd}
            onClick={() => handleArmMoveSession(item.id)}
            className={`mt-0.5 flex h-8 w-8 shrink-0 cursor-grab active:cursor-grabbing items-center justify-center rounded-xl border bg-zinc-900 transition-colors ${
              isArmedForMove
                ? 'border-emerald-400/40 text-emerald-300'
                : 'border-zinc-800 text-zinc-500'
            }`}
            title="Trascina o clicca per scegliere una cartella"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {item.folderId ? 'In cartella' : 'Inbox'}
            </div>
            {isArmedForMove && (
              <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-300">
                Scegli destinazione
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleDeleteSession(item.id)}
            disabled={isLoading || isSummarizingChat}
            className="rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 transition-colors hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-60"
            aria-label="Elimina chat"
            title="Elimina chat"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 h-screen">
      <div className="bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <Bot className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">AI Coach (Local)</h2>
            <p className="text-xs text-zinc-400">Personal trainer locale con contesto FitSync</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleResetChat}
            className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Nuova chat
          </button>
          {contextRatio && contextRatio >= 0.7 && (
            <button
              type="button"
              onClick={handleStartSummarizedChat}
              disabled={isLoading || isSummarizingChat}
              className="flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-400/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSummarizingChat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Nuova chat con riassunto
            </button>
          )}
          <div className={`hidden sm:flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${contextToneClass}`}>
            <span>Context</span>
            <span className="font-semibold text-white">
              {formatTokenCount(lastUsage?.totalTokens)}
              {configuredContextWindow ? ` / ${formatTokenCount(configuredContextWindow)}` : ' tok'}
            </span>
          </div>
          {(isLoading || lastResponseDurationMs !== null) && (
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300">
              <Clock3 className="h-3.5 w-3.5 text-emerald-300" />
              {isLoading ? `Risposta in corso ${formatDurationMs(requestElapsedMs)}` : `Ultima risposta ${formatDurationMs(lastResponseDurationMs || 0)}`}
            </div>
          )}
          {healthData && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">
              <Activity className="w-3.5 h-3.5" />
              Dati Salute Sincronizzati
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside className="hidden xl:flex w-80 shrink-0 border-r border-zinc-800 bg-zinc-900/70 flex-col">
          <div className="p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-white font-semibold">
              <History className="w-4 h-4 text-emerald-400" />
              Organizer chat
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Crea cartelle, sposta chat e riprendi la sessione che ti serve.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="Nuova cartella"
                className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-500"
                disabled={isLoading || isSummarizingChat}
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={isLoading || isSummarizingChat || !newFolderName.trim()}
                className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-2 text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                aria-label="Crea cartella"
                title="Crea cartella"
              >
                <FolderPlus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <section
              onDragOver={(event) => handleDropZoneOver(event, 'inbox')}
              onDragLeave={() => handleDropZoneLeave('inbox')}
              onDrop={(event) => handleDropOnTarget(event)}
              className={`rounded-3xl border bg-zinc-950/60 p-3 transition-colors ${
                dropTargetId === 'inbox'
                  ? 'border-emerald-400/40 bg-emerald-500/10'
                  : 'border-zinc-800'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Inbox className="h-4 w-4 text-emerald-400" />
                  Inbox
                </div>
                <div className="flex items-center gap-2">
                  {armedMoveSessionId && (
                    <button
                      type="button"
                      onClick={() => handleQuickMove()}
                      className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-300"
                    >
                      Sposta qui
                    </button>
                  )}
                  <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-500">
                    {inboxSessions.length}
                  </span>
                </div>
              </div>
              {draggingSessionId && (
                <div className={`mb-3 rounded-2xl border border-dashed px-3 py-2 text-[11px] uppercase tracking-[0.18em] ${
                  dropTargetId === 'inbox'
                    ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                    : 'border-zinc-800 text-zinc-500'
                }`}>
                  Rilascia qui per spostare in Inbox
                </div>
              )}
              <div className="space-y-2">
                {inboxSessions.length > 0 ? inboxSessions.map(renderSessionCard) : (
                  <div className="rounded-2xl border border-dashed border-zinc-800 px-3 py-4 text-xs text-zinc-500">
                    Nessuna chat senza cartella.
                  </div>
                )}
              </div>
            </section>

            {folderGroups.map(({ folder, sessions }) => (
              (() => {
                const folderTone = getFolderColorTone(folder.color);
                const isDropTarget = dropTargetId === `folder:${folder.id}`;
                const isColorPickerOpen = colorPickerFolderId === folder.id;

                return (
              <section
                key={folder.id}
                onDragOver={(event) => handleDropZoneOver(event, `folder:${folder.id}`)}
                onDragLeave={() => handleDropZoneLeave(`folder:${folder.id}`)}
                onDrop={(event) => handleDropOnTarget(event, folder.id)}
                className={`rounded-3xl border bg-zinc-950/60 p-3 transition-colors ${
                  isDropTarget
                    ? `${folderTone.border} ${folderTone.surface}`
                    : 'border-zinc-800'
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setColorPickerFolderId((prev) => (prev === folder.id ? null : folder.id))}
                    className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold text-white"
                  >
                    <Folder className={`h-4 w-4 ${folderTone.text}`} />
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${folderTone.dot}`} />
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <div className="flex items-center gap-2">
                    {armedMoveSessionId && (
                      <button
                        type="button"
                        onClick={() => handleQuickMove(folder.id)}
                        className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${folderTone.border} ${folderTone.surface} ${folderTone.text}`}
                      >
                        Sposta qui
                      </button>
                    )}
                    <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-500">
                      {sessions.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setColorPickerFolderId((prev) => (prev === folder.id ? null : folder.id))}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
                      aria-label="Cambia colore cartella"
                      title="Cambia colore cartella"
                    >
                      <Palette className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(folder.id)}
                      disabled={isLoading || isSummarizingChat}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-60"
                      aria-label="Elimina cartella"
                      title="Elimina cartella"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {isColorPickerOpen && (
                  <div className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      Colore cartella
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {FOLDER_COLORS.map((color) => {
                        const isSelected = color.id === folderTone.id;

                        return (
                          <button
                            key={color.id}
                            type="button"
                            onClick={() => handleUpdateFolderColor(folder.id, color.id)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full border transition-transform hover:scale-105 ${
                              isSelected ? `${color.border} ${color.surface}` : 'border-zinc-700 bg-zinc-950'
                            }`}
                            title={color.id}
                          >
                            <span className={`h-4 w-4 rounded-full ${color.dot}`} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {draggingSessionId && (
                  <div className={`mb-3 rounded-2xl border border-dashed px-3 py-2 text-[11px] uppercase tracking-[0.18em] ${
                    isDropTarget
                      ? `${folderTone.border} ${folderTone.surface} ${folderTone.text}`
                      : 'border-zinc-800 text-zinc-500'
                  }`}>
                    Rilascia qui per spostare nella cartella
                  </div>
                )}
                <div className="space-y-2">
                  {sessions.length > 0 ? sessions.map(renderSessionCard) : (
                    <div className="rounded-2xl border border-dashed border-zinc-800 px-3 py-4 text-xs text-zinc-500">
                      Cartella vuota. Sposta qui una chat dal menu sotto ogni sessione.
                    </div>
                  )}
                </div>
              </section>
                );
              })()
            ))}
          </div>
        </aside>

        <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex gap-4 max-w-3xl mx-auto ${
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      msg.role === 'user'
                        ? 'bg-zinc-800 text-zinc-300'
                        : 'bg-emerald-500 text-zinc-950'
                    }`}
                  >
                    {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div
                    className={`px-5 py-3.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-zinc-800 text-white rounded-tr-sm'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' && isScienceBacked(msg.content) && (
                      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-200">
                        <FlaskConical className="h-3 w-3" />
                        Science-backed
                      </div>
                    )}
                    {msg.role === 'assistant' ? (
                      <>
                        <div className="prose prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-li:my-1 prose-strong:text-white">
                          <ReactMarkdown>{formatAssistantMarkdown(msg.content)}</ReactMarkdown>
                        </div>
                        {index === latestAssistantIndex && companionContext && companionContext.kind !== 'overview' ? (
                          <ChatInlineCompanion
                            context={companionContext}
                            healthData={healthData}
                            onNavigateTab={onNavigateTab}
                            workoutsCount={companionWorkoutCount}
                          />
                        ) : null}
                      </>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}
              {isLoading && session?.id === loadingSessionId && (
                <div className="flex gap-4 max-w-3xl mx-auto">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="px-5 py-3.5 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-tl-sm">
                    {isThinkerModeEnabled && (
                      <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sky-300">
                        <Brain className="h-3 w-3" />
                        Thinker attivo
                      </div>
                    )}
                    <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      Tempo trascorso {formatDurationMs(requestElapsedMs)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Elaborazione risposta...
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-zinc-950 border-t border-zinc-800">
              <div className="max-w-3xl mx-auto">
                <div className="mb-2 flex flex-wrap gap-2">
                  {CHAT_SHORTCUTS.map((shortcut) => {
                    const Icon = getShortcutIcon(shortcut.id);
                    return (
                      <button
                        key={shortcut.id}
                        type="button"
                        onClick={() => void handleShortcutRun(shortcut)}
                        disabled={isLoading || isSummarizingChat}
                        className={`group inline-flex h-8 items-center gap-2 rounded-full border px-3 text-left transition-all ${SHORTCUT_TONE_STYLES[shortcut.tone]} disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-white/70 transition-colors group-hover:text-white">
                          <Icon className="h-3 w-3" />
                        </span>
                        <span className="text-[12px] font-medium tracking-[-0.01em] text-white/88 transition-colors group-hover:text-white">
                          {shortcut.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsThinkerModeEnabled((current) => !current)}
                    disabled={isLoading}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-all ${
                      isThinkerModeEnabled
                        ? 'border-sky-300/40 bg-sky-400/15 text-sky-200 shadow-[0_0_0_1px_rgba(125,211,252,0.08)]'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    Thinker
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsScienceModeEnabled((current) => !current)}
                    disabled={isLoading}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-all ${
                      isScienceModeEnabled
                        ? 'border-amber-300/40 bg-amber-400/15 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-amber-300/30 hover:text-amber-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    Science
                  </button>
                  <div className="ml-auto rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Raw chat window {MAX_RAW_CHAT_MESSAGES} messaggi
                  </div>
                </div>

                <form
                  onSubmit={handleSend}
                  className="relative flex items-center"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Chiedi consiglio su allenamento o recupero..."
                    className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl pl-4 pr-36 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder:text-zinc-600"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={handleOpenPromptPreview}
                    disabled={!input.trim() || isLoading}
                    className="absolute right-24 p-2 rounded-lg bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Apri anteprima prompt"
                    title="Mostra tutto il payload inviato all'AI"
                  >
                    <FileText className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleListening}
                    disabled={!isSpeechSupported || isLoading}
                    className={`absolute right-12 p-2 rounded-lg transition-colors ${
                      isListening
                        ? 'bg-rose-500 text-white hover:bg-rose-400'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    aria-label={isListening ? 'Ferma microfono' : 'Attiva microfono'}
                    title={isSpeechSupported ? (isListening ? 'Ferma dettatura' : 'Parla con il microfono') : 'Riconoscimento vocale non supportato'}
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button
                    type={isLoading ? 'button' : 'submit'}
                    onClick={isLoading ? handleStopRequest : undefined}
                    disabled={isLoading ? false : !input.trim()}
                    className={`absolute right-2 p-2 rounded-lg transition-colors ${
                      isLoading
                        ? 'bg-rose-500 hover:bg-rose-400 text-white'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    aria-label={isLoading ? 'Ferma AI' : 'Invia messaggio'}
                    title={isLoading ? 'Ferma elaborazione AI' : 'Invia messaggio'}
                  >
                    {isLoading ? <Square className="w-4 h-4" /> : <Send className="w-5 h-5" />}
                  </button>
                </form>
              </div>
              <div className="text-center mt-3 text-xs text-zinc-600">
                La chat usa memoria compressa: summary persistente, ultimi messaggi raw, contesto coach corto. Thinker: {isThinkerModeEnabled ? 'attiva' : 'disattiva'}; Science: {isScienceModeEnabled ? 'attiva' : 'disattiva'}.
              </div>
              {requestStatusMessage && (
                <div className="mt-2 text-center text-xs text-amber-300">
                  {requestStatusMessage}
                </div>
              )}
              {isListening && (
                <div className="mt-2 text-center text-xs text-sky-300">
                  Microfono attivo. Sto trascrivendo quello che dici.
                </div>
              )}
              {speechError && (
                <div className="mt-2 text-center text-xs text-rose-300">
                  Riconoscimento vocale non riuscito: {speechError}.
                </div>
              )}
              {isSummarizingChat && (
                <div className="mt-2 text-center text-xs text-sky-300">
                  Sto creando un riassunto della chat per aprire una nuova sessione pulita.
                </div>
              )}
              {contextRatio && contextRatio >= 0.85 && (
                <div className="mt-2 text-center text-xs text-amber-300">
                  Contesto quasi pieno. Conviene usare "Nuova chat con riassunto" per mantenere risposte piu stabili.
                </div>
              )}
            </div>
        </div>
      </div>
      {isPromptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 bg-zinc-900/80 px-6 py-5">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Prompt Inspect</div>
                <h3 className="mt-1 text-lg font-semibold text-white">Payload inviato all&apos;AI</h3>
                <p className="mt-1 text-sm text-zinc-400">Anteprima organizzata di system prompt, contesto, messaggi selezionati e retrieval attivi.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPromptModalOpen(false)}
                className="rounded-2xl border border-zinc-700 bg-zinc-900 p-2 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
                aria-label="Chiudi anteprima prompt"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isPromptPreviewLoading ? (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 px-6 py-5 text-sm text-zinc-300">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Costruzione anteprima prompt...
                    </div>
                  </div>
                </div>
              ) : promptPreviewError ? (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                  {promptPreviewError}
                </div>
              ) : promptPreview ? (
                <div className="space-y-5">
                  <section className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Provider</div>
                      <div className="mt-2 text-sm font-semibold text-white">{promptPreview.provider}</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Model</div>
                      <div className="mt-2 text-sm font-semibold text-white">{promptPreview.model}</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Messages</div>
                      <div className="mt-2 text-sm font-semibold text-white">{promptPreview.selectedMessages.length}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {promptPreview.selectedMessages.filter((message) => message.role === 'user').length} user / {promptPreview.selectedMessages.filter((message) => message.role === 'assistant').length} assistant
                      </div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Temperature</div>
                      <div className="mt-2 text-sm font-semibold text-white">{promptPreview.temperature}</div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="mb-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.18em]">
                      <span className={`rounded-full border px-2.5 py-1 ${promptPreview.flags.thinkingMode === 'enabled' ? 'border-violet-300/20 bg-violet-400/10 text-violet-200' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>Thinker {promptPreview.flags.thinkingMode === 'enabled' ? 'ON' : 'OFF'}</span>
                      <span className={`rounded-full border px-2.5 py-1 ${promptPreview.flags.includeKnowledgeContext ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>Knowledge {promptPreview.flags.includeKnowledgeContext ? 'ON' : 'OFF'}</span>
                      <span className={`rounded-full border px-2.5 py-1 ${promptPreview.flags.includeScienceInsights ? 'border-amber-300/20 bg-amber-400/10 text-amber-200' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>Science {promptPreview.flags.includeScienceInsights ? 'ON' : 'OFF'}</span>
                      <span className={`rounded-full border px-2.5 py-1 ${promptPreview.flags.includeRagContext ? 'border-sky-300/20 bg-sky-400/10 text-sky-200' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>RAG {promptPreview.flags.includeRagContext ? 'ON' : 'OFF'}</span>
                    </div>
                    <div className="text-sm text-zinc-400">Messaggi effettivamente selezionati, non tutta la cronologia grezza.</div>
                  </section>

                  <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">System Prompt</div>
                    <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs leading-6 text-zinc-300">{promptPreview.systemMessage}</pre>
                    <div className="mt-3 text-xs text-zinc-500">
                      Questo e il messaggio di sistema finale gia assemblato. I blocchi sotto sono mostrati separatamente solo per ispezione, non vengono aggiunti una seconda volta al payload.
                    </div>
                  </section>

                  <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">System Components</div>
                    <div className="mt-3 space-y-3">
                      {promptPreview.contextBlocks.map((block, index) => (
                        <pre key={`context-${index}`} className="whitespace-pre-wrap break-words rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs leading-6 text-zinc-300">{block}</pre>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Domanda inviata</div>
                    <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs leading-6 text-zinc-300">{promptPreview.currentUserMessage || 'Nessuna domanda utente disponibile.'}</pre>
                    <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-zinc-500">Cronologia allegata</div>
                    <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs leading-6 text-zinc-400">
                      Il modello riceve anche una finestra compatta di cronologia per continuita conversazionale, ma qui il focus e sulla domanda corrente e sul contesto costruito dal sistema.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {promptPreview.selectedMessages.filter((message) => message.role === 'user').map((message, index) => (
                        <div key={`user-message-${index}`} className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-[11px] text-zinc-400">
                          User msg {index + 1}: {message.content.slice(0, 72)}{message.content.length > 72 ? '...' : ''}
                        </div>
                      ))}
                    </div>
                  </section>

                  {promptPreview.knowledgeContext && (
                    <section className="rounded-3xl border border-emerald-400/15 bg-emerald-500/5 p-5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300">Knowledge Context</div>
                      <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-emerald-400/10 bg-zinc-950/80 p-4 text-xs leading-6 text-zinc-200">{promptPreview.knowledgeContext}</pre>
                    </section>
                  )}

                  {promptPreview.scienceContext && (
                    <section className="rounded-3xl border border-amber-300/15 bg-amber-400/5 p-5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-amber-200">Science Insights</div>
                      <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-amber-300/10 bg-zinc-950/80 p-4 text-xs leading-6 text-zinc-200">{promptPreview.scienceContext}</pre>
                    </section>
                  )}

                  {promptPreview.ragContext && (
                    <section className="rounded-3xl border border-sky-300/15 bg-sky-400/5 p-5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sky-200">RAG Context</div>
                      <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-sky-300/10 bg-zinc-950/80 p-4 text-xs leading-6 text-zinc-200">{promptPreview.ragContext}</pre>
                    </section>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
