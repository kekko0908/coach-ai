import { NUTRITION_KNOWLEDGE } from '../data/knowledge/nutrition';
import { RECOVERY_KNOWLEDGE } from '../data/knowledge/recovery';
import { TRAINING_KNOWLEDGE } from '../data/knowledge/training';
import { KnowledgeEntry, KnowledgeScope } from '../types/knowledge';

const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  ...TRAINING_KNOWLEDGE,
  ...RECOVERY_KNOWLEDGE,
  ...NUTRITION_KNOWLEDGE,
];

function formatScopeLabel(scope: KnowledgeScope) {
  if (scope === 'training') {
    return 'allenamento';
  }

  if (scope === 'recovery') {
    return 'recupero';
  }

  return 'nutrizione';
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function getEntryScore(entry: KnowledgeEntry, queryTokens: string[]) {
  const searchable = tokenize(`${entry.topic} ${entry.summary} ${entry.tags.join(' ')}`);
  const searchableSet = new Set(searchable);
  let score = 0;

  queryTokens.forEach((token) => {
    if (searchableSet.has(token)) {
      score += 3;
    }

    if (entry.tags.some((tag) => tag.toLowerCase().includes(token))) {
      score += 2;
    }

    if (entry.summary.toLowerCase().includes(token)) {
      score += 1;
    }
  });

  return score;
}

export function retrieveKnowledgeEntries({
  query,
  scopes,
  limit = 4,
}: {
  query: string;
  scopes?: KnowledgeScope[];
  limit?: number;
}) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const filteredEntries = scopes && scopes.length > 0
    ? KNOWLEDGE_BASE.filter((entry) => scopes.includes(entry.scope))
    : KNOWLEDGE_BASE;

  return filteredEntries
    .map((entry) => ({
      entry,
      score: getEntryScore(entry, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

export function buildKnowledgeContext({
  query,
  scopes,
}: {
  query: string;
  scopes?: KnowledgeScope[];
}) {
  const entries = retrieveKnowledgeEntries({ query, scopes });
  if (entries.length === 0) {
    return '';
  }

  return [
    'Knowledge base locale rilevante:',
    ...entries.map((entry) => `- Area ${formatScopeLabel(entry.scope)} · ${entry.topic}: ${entry.summary} (Fonte: ${entry.sourceLabel})`),
  ].join('\n');
}
