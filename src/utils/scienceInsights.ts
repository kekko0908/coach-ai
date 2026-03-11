import { SCIENCE_INSIGHTS } from '../data/science/insights';
import { ScienceCitation, ScienceInsight } from '../types/science';

const STOPWORDS = new Set([
  'alla',
  'alle',
  'anche',
  'come',
  'con',
  'che',
  'del',
  'della',
  'delle',
  'degli',
  'dello',
  'dopo',
  'dove',
  'gli',
  'hai',
  'ho',
  'il',
  'in',
  'la',
  'le',
  'lo',
  'ma',
  'nei',
  'nel',
  'nella',
  'nelle',
  'non',
  'per',
  'piu',
  'poi',
  'puo',
  'quale',
  'quali',
  'questa',
  'queste',
  'questi',
  'questo',
  'se',
  'sul',
  'sulla',
  'sulle',
  'tra',
  'una',
  'uno',
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  massa: ['ipertrofia', 'forza', 'volume', 'proteine'],
  muscolare: ['ipertrofia', 'forza', 'volume', 'proteine'],
  muscolo: ['ipertrofia', 'forza', 'volume', 'proteine'],
  ipertrofia: ['ipertrofia', 'forza', 'volume', 'proteine'],
  allenamento: ['forza', 'volume', 'recupero'],
  allenamenti: ['forza', 'volume', 'recupero'],
  workout: ['forza', 'volume', 'recupero'],
  forza: ['forza massimale', 'rpe', 'rir', 'volume'],
  proteine: ['proteine', 'leucina', 'nutrizione'],
  dimagrimento: ['nutrizione', 'proteine', 'volume'],
  recupero: ['recupero', 'sonno', 'hrv'],
  sonno: ['sonno', 'hrv', 'readiness'],
  hrv: ['hrv', 'readiness', 'autoregolazione'],
  calorie: ['nutrizione', 'carboidrati', 'proteine'],
};

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function expandQueryTokens(tokens: string[]) {
  const expanded = new Set(tokens);

  tokens.forEach((token) => {
    Object.entries(TOKEN_SYNONYMS).forEach(([key, synonyms]) => {
      if (token.includes(key) || key.includes(token)) {
        synonyms.forEach((synonym) => expanded.add(synonym));
      }
    });
  });

  return Array.from(expanded);
}

function inferPreferredAreas(queryTokens: string[]) {
  const joined = queryTokens.join(' ');
  const preferredAreas = new Set<ScienceInsight['area']>();

  if (/(massa|muscolar|ipertrof|forza|volume)/.test(joined)) {
    preferredAreas.add('strength_hypertrophy');
    preferredAreas.add('nutrition');
  }

  if (/(recuper|sonno|hrv|readiness|fatica)/.test(joined)) {
    preferredAreas.add('readiness_recovery');
    preferredAreas.add('autoregulation');
  }

  if (/(calcio|sprint|agilita|team sports)/.test(joined)) {
    preferredAreas.add('concurrent_training');
    preferredAreas.add('injury_prevention');
  }

  return preferredAreas;
}

function getPriorityBoost(priority: ScienceInsight['priority']) {
  if (priority === 'high') return 4;
  if (priority === 'medium') return 2;
  return 0;
}

function scoreInsight(insight: ScienceInsight, queryTokens: string[]) {
  const searchable = [
    insight.title,
    insight.studyType,
    insight.population,
    insight.whyRelevant,
    insight.tags.join(' '),
    insight.takeaways.join(' '),
  ].join(' ').toLowerCase();

  let score = getPriorityBoost(insight.priority);

  queryTokens.forEach((token) => {
    if (insight.title.toLowerCase().includes(token)) {
      score += 6;
    }

    if (insight.tags.some((tag) => tag.toLowerCase().includes(token))) {
      score += 4;
    }

    if (searchable.includes(token)) {
      score += 2;
    }
  });

  return score;
}

function formatShortlist(shortlist: ScienceInsight['shortlist']) {
  if (shortlist === 'read_now') return 'da leggere subito';
  if (shortlist === 'useful_after') return 'utile dopo';
  return 'piu teorico / opzionale';
}

export function getScienceInsights() {
  return SCIENCE_INSIGHTS;
}

export function getScienceShortlists() {
  return {
    readNow: SCIENCE_INSIGHTS.filter((insight) => insight.shortlist === 'read_now'),
    usefulAfter: SCIENCE_INSIGHTS.filter((insight) => insight.shortlist === 'useful_after'),
    optional: SCIENCE_INSIGHTS.filter((insight) => insight.shortlist === 'optional'),
  };
}

export function getScienceLibraryStats() {
  const highPriority = SCIENCE_INSIGHTS.filter((insight) => insight.priority === 'high').length;

  return {
    total: SCIENCE_INSIGHTS.length,
    highPriority,
    areas: new Set(SCIENCE_INSIGHTS.map((insight) => insight.area)).size,
  };
}

export function getScienceAreaLabel(area: ScienceInsight['area']) {
  switch (area) {
    case 'concurrent_training':
      return 'Concurrent Training';
    case 'strength_hypertrophy':
      return 'Forza e Ipertrofia';
    case 'injury_prevention':
      return 'Prevenzione Infortuni';
    case 'readiness_recovery':
      return 'Readiness e Recupero';
    case 'nutrition':
      return 'Nutrizione';
    case 'autoregulation':
      return 'Autoregolazione';
    default:
      return area;
  }
}

export function getScienceShortlistLabel(shortlist: ScienceInsight['shortlist']) {
  if (shortlist === 'read_now') return 'Da leggere subito';
  if (shortlist === 'useful_after') return 'Utile dopo';
  return 'Piu teorici';
}

export function retrieveScienceInsights({
  query,
  limit = 3,
}: {
  query: string;
  limit?: number;
}) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const expandedTokens = expandQueryTokens(queryTokens);
  const preferredAreas = inferPreferredAreas(expandedTokens);

  return SCIENCE_INSIGHTS
    .map((insight) => ({
      insight,
      score: scoreInsight(insight, expandedTokens) + (preferredAreas.has(insight.area) ? 5 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.insight);
}

export function buildScienceInsightsContext({
  query,
  limit = 3,
}: {
  query: string;
  limit?: number;
}) {
  const insights = retrieveScienceInsights({ query, limit });
  if (insights.length === 0) {
    return {
      context: '',
      citations: [] as ScienceCitation[],
    };
  }

  return {
    context: [
      'Insight scientifici curati rilevanti:',
      ...insights.map((insight, index) => {
        const citationId = `[S${index + 1}]`;
        return `${citationId} ${insight.title} (${insight.year}, ${insight.studyType}, ${formatShortlist(insight.shortlist)}): ${insight.whyRelevant} Takeaway: ${insight.takeaways.join(' ')}`;
      }),
    ].join('\n'),
    citations: insights.map((insight, index) => ({
      citationId: `[S${index + 1}]`,
      title: insight.title,
      year: insight.year,
      sourceLabel: insight.sourceLabel,
      sourceReference: insight.sourceReference,
    })),
  };
}

export function buildScienceCitationFooter(citations: ScienceCitation[]) {
  if (citations.length === 0) {
    return '';
  }

  return [
    '---',
    '**Fonti scientifiche curate**',
    ...citations.map((citation) => `- ${citation.citationId} ${citation.title} (${citation.year}) - ${citation.sourceLabel}: ${citation.sourceReference}`),
  ].join('\n');
}
