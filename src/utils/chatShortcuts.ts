export type ChatShortcutId =
  | 'report_this_week'
  | 'report_this_month'
  | 'hypertrophy_practical'
  | 'workout_today';

export interface ChatShortcutDefinition {
  id: ChatShortcutId;
  label: string;
  prompt: string;
  description: string;
  tone: 'emerald' | 'sky' | 'amber' | 'rose';
}

export const CHAT_SHORTCUTS: ChatShortcutDefinition[] = [
  {
    id: 'report_this_week',
    label: 'Report settimana',
    prompt: 'Fammi un report della settimana corrente.',
    description: 'Riepilogo rapido con numeri e prossime azioni.',
    tone: 'emerald',
  },
  {
    id: 'report_this_month',
    label: 'Report mese',
    prompt: 'Fammi un report di questo mese.',
    description: 'Panoramica mensile con trend e costanza.',
    tone: 'sky',
  },
  {
    id: 'hypertrophy_practical',
    label: 'Massa muscolare',
    prompt: 'Dammi consigli pratici per aumentare la massa muscolare.',
    description: 'Coaching concreto per ipertrofia e progressione.',
    tone: 'amber',
  },
  {
    id: 'workout_today',
    label: 'Workout di oggi',
    prompt: 'Costruisci il workout di oggi in base al mio contesto attuale.',
    description: 'Sessione pronta da eseguire oggi.',
    tone: 'rose',
  },
];
