import { readLocalJson, writeLocalJson } from './storage';

export interface ExerciseMedia {
  exerciseId: string;
  name: string;
  gifUrl: string;
  bodyParts: string[];
  targetMuscles: string[];
  equipments: string[];
  instructions: string[];
}

type ExerciseDbSearchResponse = {
  success: boolean;
  data?: Array<{
    exerciseId: string;
    name: string;
    gifUrl: string;
    bodyParts: string[];
    targetMuscles: string[];
    equipments: string[];
    instructions: string[];
  }>;
};

const EXERCISE_MEDIA_CACHE_KEY = 'fitsync_exercise_media_cache_v3';
const EXERCISE_DB_PROXY_BASE_URL = '/api/exercise-db';
const EXERCISE_DB_DIRECT_BASE_URL = 'https://exercisedb.dev';
const EXERCISE_DB_LIMIT = 8;
const EXERCISE_DB_MAX_RETRIES = 2;
const EXERCISE_DB_RETRY_DELAY_MS = 700;
const EXERCISE_DB_GOOD_MATCH_SCORE = 80;
const inFlightRequests = new Map<string, Promise<ExerciseMedia | null>>();

const EXERCISE_NAME_ALIASES: Array<[RegExp, string]> = [
  [/\bpiegamenti?\b/, 'push up'],
  [/\bpush up a corpo libero\b/, 'push up'],
  [/\bpanca\b/, 'bench press'],
  [/\bpanca inclinata\b/, 'incline bench press'],
  [/\balzate laterali\b/, 'lateral raise'],
  [/\blateral raise\b/, 'lateral raise'],
  [/\bface pull\b/, 'face pull'],
  [/\btrazioni?\b/, 'pull up'],
  [/\bbarra trazioni\b/, 'pull up'],
  [/\bplank\b/, 'plank'],
  [/\baffondi\b/, 'lunge'],
  [/\bsquat\b/, 'squat'],
  [/\bstacco\b/, 'deadlift'],
  [/\bmilitary press\b/, 'shoulder press'],
  [/\bspinte sopra la testa\b/, 'shoulder press'],
  [/\bpike push up\b/, 'pike push up'],
  [/\bcurl\b/, 'biceps curl'],
  [/\brematore con bilanciere\b/, 'barbell bent over row'],
  [/\brematore bilanciere\b/, 'barbell bent over row'],
  [/\brematore con manubri?\b/, 'dumbbell bent over row'],
  [/\brematore con manubrio\b/, 'dumbbell bent over row'],
  [/\brematore unilaterale\b/, 'one arm dumbbell row'],
  [/\brematore\b/, 'bent over row'],
  [/\blat machine\b/, 'lat pulldown'],
  [/\blat pulldown\b/, 'lat pulldown'],
  [/\bpulldown\b/, 'lat pulldown'],
  [/\bhip thrust\b/, 'hip thrust'],
  [/\bponte glutei\b/, 'glute bridge'],
];

function normalizeExerciseName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCache() {
  return readLocalJson<Record<string, ExerciseMedia | null>>(EXERCISE_MEDIA_CACHE_KEY, {});
}

function setCache(cache: Record<string, ExerciseMedia | null>) {
  writeLocalJson(EXERCISE_MEDIA_CACHE_KEY, cache);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scoreCandidate(query: string, candidate: ExerciseMedia) {
  const normalizedQuery = normalizeExerciseName(query);
  const normalizedName = normalizeExerciseName(candidate.name);

  if (normalizedName === normalizedQuery) {
    return 100;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return 80;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const candidateTokens = new Set(normalizedName.split(' ').filter(Boolean));
  const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length;
  return overlap * 10;
}

function buildSearchQueries(exerciseName: string) {
  const normalized = normalizeExerciseName(exerciseName);
  const queries = new Set<string>([exerciseName, normalized]);

  EXERCISE_NAME_ALIASES.forEach(([pattern, replacement]) => {
    if (pattern.test(normalized)) {
      queries.add(replacement);
    }
  });

  const withoutExtraNotes = normalized
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bo\b\s+manubri\b/g, '')
    .replace(/\bo\b\s+elastici lunghi\b/g, '')
    .replace(/\bo\b\s+elastico\b/g, '')
    .replace(/\ba corpo libero\b/g, '')
    .replace(/\bo tavolo stabile\b/g, '')
    .replace(/\bpresa\b\s+(neutra|larga|stretta)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (withoutExtraNotes && withoutExtraNotes !== normalized) {
    queries.add(withoutExtraNotes);
  }

  return Array.from(queries).filter(Boolean).slice(0, 4);
}

async function searchExerciseDb(query: string, attempt = 0): Promise<ExerciseMedia[]> {
  const baseUrl = import.meta.env.DEV ? EXERCISE_DB_PROXY_BASE_URL : EXERCISE_DB_DIRECT_BASE_URL;
  const response = await fetch(`${baseUrl}/api/v1/exercises?search=${encodeURIComponent(query)}&limit=${EXERCISE_DB_LIMIT}`);
  if (response.status === 429) {
    if (attempt >= EXERCISE_DB_MAX_RETRIES) {
      throw new Error('ExerciseDB rate limited');
    }

    await wait(EXERCISE_DB_RETRY_DELAY_MS * (attempt + 1));
    return searchExerciseDb(query, attempt + 1);
  }

  if (!response.ok) {
    return [] as ExerciseMedia[];
  }

  const payload = (await response.json()) as ExerciseDbSearchResponse;
  const candidates = Array.isArray(payload.data) ? payload.data : [];

  return candidates.map((candidate) => ({
    exerciseId: candidate.exerciseId,
    name: candidate.name,
    gifUrl: candidate.gifUrl,
    bodyParts: candidate.bodyParts || [],
    targetMuscles: candidate.targetMuscles || [],
    equipments: candidate.equipments || [],
    instructions: candidate.instructions || [],
  }));
}

export async function fetchExerciseMedia(exerciseName: string): Promise<ExerciseMedia | null> {
  const normalizedKey = normalizeExerciseName(exerciseName);
  if (!normalizedKey) {
    return null;
  }

  const cache = getCache();
  if (normalizedKey in cache) {
    return cache[normalizedKey];
  }

  const existingRequest = inFlightRequests.get(normalizedKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const queries = buildSearchQueries(exerciseName);
      const seenIds = new Set<string>();
      let bestMatch: { candidate: ExerciseMedia; score: number } | null = null;

      for (const query of queries) {
        const candidates = await searchExerciseDb(query);

        candidates.forEach((candidate) => {
          if (seenIds.has(candidate.exerciseId)) {
            return;
          }

          seenIds.add(candidate.exerciseId);
          const score = scoreCandidate(exerciseName, candidate);

          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { candidate, score };
          }
        });

        if (bestMatch && bestMatch.score >= EXERCISE_DB_GOOD_MATCH_SCORE) {
          break;
        }
      }

      const result = bestMatch && bestMatch.score >= 10 ? bestMatch.candidate : null;
      cache[normalizedKey] = result;
      setCache(cache);
      return result;
    } catch (error) {
      const isRateLimited = error instanceof Error && error.message.includes('rate limited');
      if (!isRateLimited) {
        cache[normalizedKey] = null;
        setCache(cache);
      }

      return null;
    } finally {
      inFlightRequests.delete(normalizedKey);
    }
  })();

  inFlightRequests.set(normalizedKey, request);
  return request;
}
