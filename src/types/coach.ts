export type CoachPrimaryGoal =
  | 'fat_loss'
  | 'hypertrophy'
  | 'strength'
  | 'performance'
  | 'health';

export type CoachMainSport =
  | 'gym'
  | 'football'
  | 'running'
  | 'cycling'
  | 'hybrid';

export interface CoachMemory {
  primaryGoal: CoachPrimaryGoal;
  mainSport: CoachMainSport;
  availableEquipment: string[];
  limitations: string[];
  injuries: string[];
  preferences: string[];
  coachNotes: string[];
  currentPhase?: string;
  updatedAt: string;
}
