export type PlannerReadinessLevel = 'high' | 'moderate' | 'low';
export type PlannerPriority = 'high' | 'medium' | 'low';
export type PlannerDayType = 'train' | 'light' | 'recover' | 'rest';
export type FatigueGroupId = 'legs' | 'push' | 'pull' | 'core' | 'cardio';
export type FatigueLevel = 'high' | 'moderate' | 'low';

export interface PlannerInsight {
  id: string;
  title: string;
  detail: string;
  priority: PlannerPriority;
}

export interface PlannerDayPlan {
  date: string;
  dayLabel: string;
  type: PlannerDayType;
  focus: string;
  reason: string;
}

export interface PlannerAiExercise {
  name: string;
  sets: string;
  reps: string;
  notes?: string;
}

export interface PlannerAiDayPlan {
  date: string;
  dayLabel: string;
  type: PlannerDayType;
  focus: string;
  summary: string;
  exercises: PlannerAiExercise[];
}

export interface PlannerAiPlan {
  generatedAt: string;
  overview: string;
  days: PlannerAiDayPlan[];
}

export interface ReadinessFactor {
  id: string;
  label: string;
  value: number;
  impact: number;
}

export interface FatigueGroup {
  id: FatigueGroupId;
  label: string;
  score: number;
  level: FatigueLevel;
  reason: string;
}

export interface PlannerOutput {
  generatedAt: string;
  readinessScore: number;
  readinessLevel: PlannerReadinessLevel;
  headline: string;
  readinessFactors: ReadinessFactor[];
  fatigueGroups: FatigueGroup[];
  insights: PlannerInsight[];
  nextWeek: PlannerDayPlan[];
}
