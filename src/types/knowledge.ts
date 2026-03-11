export type KnowledgeScope = 'training' | 'recovery' | 'nutrition';

export interface KnowledgeEntry {
  id: string;
  scope: KnowledgeScope;
  topic: string;
  summary: string;
  tags: string[];
  sourceLabel: string;
}
