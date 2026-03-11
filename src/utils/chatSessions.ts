import { Message } from '../types';
import { ChatFolder, ChatScope, ChatSession } from '../types/chat';
import { readLocalJson, writeLocalJson } from './storage';

const CHAT_SESSIONS_KEY = 'fitsync_chat_sessions_v1';
const CHAT_FOLDERS_KEY = 'fitsync_chat_folders_v1';
const CURRENT_GENERAL_CHAT_ID_KEY = 'fitsync_current_general_chat_id_v1';
const DEFAULT_FOLDER_COLOR = 'emerald';

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNowIso() {
  return new Date().toISOString();
}

export function readChatSessions() {
  return readLocalJson<ChatSession[]>(CHAT_SESSIONS_KEY, []);
}

function saveChatSessions(sessions: ChatSession[]) {
  writeLocalJson(CHAT_SESSIONS_KEY, sessions);
}

export function readChatFolders() {
  return readLocalJson<ChatFolder[]>(CHAT_FOLDERS_KEY, []);
}

function saveChatFolders(folders: ChatFolder[]) {
  writeLocalJson(CHAT_FOLDERS_KEY, folders);
}

export function createChatSession({
  scope,
  title,
  initialMessages,
  workoutId,
}: {
  scope: ChatScope;
  title: string;
  initialMessages: Message[];
  workoutId?: string;
}) {
  const session: ChatSession = {
    id: createSessionId(),
    scope,
    workoutId,
    title,
    messages: initialMessages,
    createdAt: getNowIso(),
    updatedAt: getNowIso(),
  };

  const sessions = readChatSessions();
  sessions.unshift(session);
  saveChatSessions(sessions);

  if (scope === 'general') {
    localStorage.setItem(CURRENT_GENERAL_CHAT_ID_KEY, session.id);
  }

  return session;
}

export function getChatSessionById(sessionId: string) {
  return readChatSessions().find((session) => session.id === sessionId) || null;
}

export function getCurrentGeneralChatSession() {
  const sessionId = localStorage.getItem(CURRENT_GENERAL_CHAT_ID_KEY);
  if (!sessionId) {
    return null;
  }

  return getChatSessionById(sessionId);
}

export function setCurrentGeneralChatSession(sessionId: string) {
  localStorage.setItem(CURRENT_GENERAL_CHAT_ID_KEY, sessionId);
}

export function getGeneralChatSessions() {
  return readChatSessions().filter((session) => session.scope === 'general');
}

export function getGeneralChatFolders() {
  return readChatFolders();
}

export function createGeneralChatFolder(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Il nome della cartella non puo essere vuoto.');
  }

  const folders = readChatFolders();
  const folder: ChatFolder = {
    id: createSessionId(),
    name: trimmedName,
    color: DEFAULT_FOLDER_COLOR,
    createdAt: getNowIso(),
    updatedAt: getNowIso(),
  };

  folders.push(folder);
  saveChatFolders(folders);
  return folder;
}

export function updateGeneralChatFolderColor(folderId: string, color: string) {
  const folders = readChatFolders();
  const folderIndex = folders.findIndex((folder) => folder.id === folderId);
  if (folderIndex < 0) {
    return null;
  }

  const nextFolder: ChatFolder = {
    ...folders[folderIndex],
    color,
    updatedAt: getNowIso(),
  };
  folders[folderIndex] = nextFolder;
  saveChatFolders(folders);
  return nextFolder;
}

export function deleteGeneralChatFolder(folderId: string) {
  const folders = readChatFolders().filter((folder) => folder.id !== folderId);
  saveChatFolders(folders);

  const sessions = readChatSessions().map((session) => (
    session.folderId === folderId
      ? { ...session, folderId: undefined }
      : session
  ));
  saveChatSessions(sessions);
}

export function moveGeneralChatSession(sessionId: string, folderId?: string) {
  const sessions = readChatSessions();
  const sessionIndex = sessions.findIndex((session) => session.id === sessionId && session.scope === 'general');
  if (sessionIndex < 0) {
    return null;
  }

  const nextSession: ChatSession = {
    ...sessions[sessionIndex],
    folderId: folderId || undefined,
    updatedAt: sessions[sessionIndex].updatedAt,
  };
  sessions[sessionIndex] = nextSession;
  saveChatSessions(sessions);
  return nextSession;
}

export function deleteGeneralChatSession(sessionId: string) {
  const sessions = readChatSessions();
  const nextSessions = sessions.filter((session) => !(session.scope === 'general' && session.id === sessionId));
  saveChatSessions(nextSessions);

  const currentGeneralId = localStorage.getItem(CURRENT_GENERAL_CHAT_ID_KEY);
  if (currentGeneralId === sessionId) {
    const fallbackGeneral = nextSessions.find((session) => session.scope === 'general');
    if (fallbackGeneral) {
      localStorage.setItem(CURRENT_GENERAL_CHAT_ID_KEY, fallbackGeneral.id);
    } else {
      localStorage.removeItem(CURRENT_GENERAL_CHAT_ID_KEY);
    }
  }
}

function deriveChatTitle(messages: Message[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content.trim();
  if (!firstUserMessage) {
    return 'Nuova chat coach';
  }

  return firstUserMessage.length > 44
    ? `${firstUserMessage.slice(0, 44).trim()}...`
    : firstUserMessage;
}

export function upsertChatSession(session: ChatSession) {
  const sessions = readChatSessions();
  const existingIndex = sessions.findIndex((item) => item.id === session.id);
  const nextSession = {
    ...session,
    title: deriveChatTitle(session.messages),
    updatedAt: getNowIso(),
  };

  if (existingIndex >= 0) {
    sessions[existingIndex] = nextSession;
  } else {
    sessions.unshift(nextSession);
  }

  saveChatSessions(sessions);
  return nextSession;
}

export function getOrCreateCurrentGeneralChat(initialMessages: Message[]) {
  return getCurrentGeneralChatSession() || createChatSession({
    scope: 'general',
    title: 'Nuova chat coach',
    initialMessages,
  });
}

export function startFreshGeneralChat(initialMessages: Message[]) {
  return createChatSession({
    scope: 'general',
    title: 'Nuova chat coach',
    initialMessages,
  });
}

export function startFreshGeneralChatFromSummary({
  initialMessages,
  summary,
}: {
  initialMessages: Message[];
  summary: string;
}) {
  const session = createChatSession({
    scope: 'general',
    title: 'Nuova chat coach',
    initialMessages,
  });

  return upsertChatSession({
    ...session,
    summary,
  });
}
