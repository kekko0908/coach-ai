import { Message } from '../types';

export type ChatScope = 'general' | 'workout';

export interface ChatFolder {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSession {
  id: string;
  scope: ChatScope;
  workoutId?: string;
  folderId?: string;
  title: string;
  messages: Message[];
  summary?: string;
  summaryMessageCount?: number;
  createdAt: string;
  updatedAt: string;
}
