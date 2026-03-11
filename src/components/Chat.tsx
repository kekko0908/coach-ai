import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Loader2, Activity, Brain, RotateCcw, Mic, MicOff, History, FlaskConical, Folder, FolderPlus, Inbox, Trash2, GripVertical, Palette } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { HealthData, Message } from '../types';
import { AiUsage, buildResponseStyleInstruction, buildUserContextSummary, getAiConnectionHint, getConfiguredContextWindow, isReportLikeRequest, sendCoachRequest } from '../utils/aiClient';
import { formatAssistantMarkdown } from '../utils/aiFormatting';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { generateStructuredHealthReport } from '../utils/reportComposer';
import { ChatFolder, ChatSession } from '../types/chat';
import { getStoredThinkerModeEnabled, setStoredThinkerModeEnabled } from '../lib/appDataStore';
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

interface ChatProps {
  healthData: HealthData | null;
}

const CHAT_WELCOME_MESSAGE = 'Ciao! Sono il tuo AI coach. Posso aiutarti con allenamento, recupero, split e lettura dei tuoi dati salute.';
const CHAT_CARRY_OVER_MESSAGE = 'Ho aperto una nuova chat e ho mantenuto un riassunto del contesto precedente, cosi possiamo continuare senza trascinare tutta la cronologia.';
const DEFAULT_CHAT_MESSAGES: Message[] = [{ role: 'assistant', content: CHAT_WELCOME_MESSAGE }];
const SCIENCE_BACKED_PATTERN = /\[(S|P)\d+\]/;
const FOLDER_COLORS = [
  { id: 'emerald', dot: 'bg-emerald-400', border: 'border-emerald-400/35', surface: 'bg-emerald-500/10', text: 'text-emerald-200' },
  { id: 'amber', dot: 'bg-amber-300', border: 'border-amber-300/35', surface: 'bg-amber-400/10', text: 'text-amber-100' },
  { id: 'sky', dot: 'bg-sky-300', border: 'border-sky-300/35', surface: 'bg-sky-400/10', text: 'text-sky-100' },
  { id: 'rose', dot: 'bg-rose-300', border: 'border-rose-300/35', surface: 'bg-rose-400/10', text: 'text-rose-100' },
  { id: 'violet', dot: 'bg-violet-300', border: 'border-violet-300/35', surface: 'bg-violet-400/10', text: 'text-violet-100' },
  { id: 'zinc', dot: 'bg-zinc-300', border: 'border-zinc-500/40', surface: 'bg-zinc-800/80', text: 'text-zinc-200' },
] as const;

function formatTokenCount(value?: number) {
  if (!value) return '--';
  return value.toLocaleString('it-IT');
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

export default function Chat({ healthData }: ChatProps) {
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
  const [isThinkerModeEnabled, setIsThinkerModeEnabled] = useState(() => getStoredThinkerModeEnabled());
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !session) return;

    const userMessage = input.trim();
    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }];

    setInput('');
    setMessages(newMessages);
    setIsLoading(true);
    setLoadingSessionId(session.id);

    try {
      const sharedContextBlocks = [
        buildUserContextSummary(healthData),
        session.summary ? `Riassunto chat precedente da portare avanti:\n${session.summary}` : '',
      ];

      const reply = isReportLikeRequest(userMessage) && healthData
        ? await generateStructuredHealthReport({
            userPrompt: userMessage,
            healthData,
            windowDays: 30,
            knowledgeQuery: userMessage,
            ragQuery: userMessage,
            extraContextBlocks: [
              session.summary ? `Riassunto chat precedente da portare avanti:\n${session.summary}` : '',
            ],
          })
        : await sendCoachRequest({
            messages: newMessages,
            contextBlocks: sharedContextBlocks,
            knowledgeQuery: userMessage,
            knowledgeScopes: ['training', 'recovery', 'nutrition'],
            ragQuery: userMessage,
            extraSystemPrompt: `Indicazioni operative per la chat:
- l'utente vuole allenarsi con continuita;
- ${buildResponseStyleInstruction(userMessage, 'general').split('\n').join('\n- ').replace(/^- /, '')}
- modalita thinker: ${isThinkerModeEnabled ? 'attiva' : 'disattiva'}.
${isThinkerModeEnabled
  ? '- prima di rispondere, fai un ragionamento piu approfondito; poi restituisci una risposta finale ordinata, chiara e sintetica, senza mostrare catena di pensiero privata.'
  : '- rispondi in modo diretto e breve, senza espandere il ragionamento oltre il necessario.'}`,
            onUsage: setLastUsage,
          });

      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Impossibile contattare il modello locale. Verifica ${getAiConnectionHint()}.`,
        },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingSessionId(null);
    }
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
          <button
            type="button"
            onClick={() => setIsThinkerModeEnabled((prev) => !prev)}
            className={`flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              isThinkerModeEnabled
                ? 'border-sky-400/30 bg-sky-400/10 text-sky-300'
                : 'border-zinc-700 bg-zinc-800 text-zinc-300'
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            Thinker
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${
                isThinkerModeEnabled ? 'bg-sky-400/80' : 'bg-zinc-700'
              }`}
            >
              <span
                className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
                style={{ transform: isThinkerModeEnabled ? 'translateX(18px)' : 'translateX(2px)' }}
              />
            </span>
          </button>
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
                  <div className="prose prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-li:my-0 prose-strong:text-white">
                    <ReactMarkdown>{formatAssistantMarkdown(msg.content)}</ReactMarkdown>
                  </div>
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
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Elaborazione risposta...
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-4 bg-zinc-950 border-t border-zinc-800">
        <form
          onSubmit={handleSend}
          className="max-w-3xl mx-auto relative flex items-center"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Chiedi consiglio su allenamento o recupero..."
            className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl pl-4 pr-24 py-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder:text-zinc-600"
            disabled={isLoading}
          />
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
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        <div className="text-center mt-3 text-xs text-zinc-600">
          I messaggi includono automaticamente profilo, salute, workout e record salvati. Modalita thinker: {isThinkerModeEnabled ? 'attiva' : 'disattiva'}.
        </div>
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
  );
}
