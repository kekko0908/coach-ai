export type ScienceArea =
  | 'concurrent_training'
  | 'strength_hypertrophy'
  | 'injury_prevention'
  | 'readiness_recovery'
  | 'nutrition'
  | 'autoregulation';

export type SciencePriority = 'high' | 'medium' | 'optional';
export type ScienceShortlist = 'read_now' | 'useful_after' | 'optional';

export interface ScienceInsight {
  id: string;
  area: ScienceArea;
  title: string;
  year: number;
  studyType: string;
  population: string;
  whyRelevant: string;
  takeaways: string[];
  priority: SciencePriority;
  shortlist: ScienceShortlist;
  sourceLabel: string;
  sourceReference: string;
  tags: string[];
}

export interface ScienceCitation {
  citationId: string;
  title: string;
  year: number;
  sourceLabel: string;
  sourceReference: string;
}
