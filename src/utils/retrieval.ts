import { RagChunk, RagCitation, RagIndex } from '../types/rag';

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

const RAG_INDEX_URL = '/rag/papers.generated.json';
const RAG_EMBEDDING_MODEL = import.meta.env.VITE_RAG_EMBEDDING_MODEL || '';
const RAG_EMBEDDING_BASE_URL = import.meta.env.VITE_RAG_EMBEDDING_BASE_URL || import.meta.env.VITE_LLM_BASE_URL || 'http://127.0.0.1:1234/v1';
const EMBEDDING_PROXY_BASE_URL = '/api/llm';
const EMPTY_RAG_INDEX: RagIndex = {
  generatedAt: '',
  documents: [],
  chunks: [],
};

const queryEmbeddingCache = new Map<string, number[] | null>();
let ragIndexPromise: Promise<RagIndex> | null = null;

type RetrievedRagChunk = {
  chunk: RagChunk;
  score: number;
  method: 'embedding' | 'lexical';
  citationId: string;
};

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function getEmbeddingRequestBaseUrl() {
  if (import.meta.env.DEV) {
    return EMBEDDING_PROXY_BASE_URL;
  }

  return normalizeBaseUrl(RAG_EMBEDDING_BASE_URL);
}

async function loadRagIndex() {
  if (!ragIndexPromise) {
    ragIndexPromise = fetch(RAG_INDEX_URL)
      .then(async (response) => {
        if (!response.ok) {
          return EMPTY_RAG_INDEX;
        }

        const payload = await response.json() as RagIndex;
        if (!payload || !Array.isArray(payload.documents) || !Array.isArray(payload.chunks)) {
          return EMPTY_RAG_INDEX;
        }

        return payload;
      })
      .catch(() => EMPTY_RAG_INDEX);
  }

  return ragIndexPromise;
}

function scoreChunkLexically(chunk: RagChunk, queryTokens: string[]) {
  const chunkText = `${chunk.documentTitle} ${chunk.keywords.join(' ')} ${chunk.text}`.toLowerCase();
  let score = 0;

  queryTokens.forEach((token) => {
    if (chunk.documentTitle.toLowerCase().includes(token)) {
      score += 6;
    }

    if (chunk.keywords.some((keyword) => keyword.includes(token))) {
      score += 4;
    }

    if (chunkText.includes(token)) {
      score += 2;
    }
  });

  return score;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function formatPageRange(chunk: Pick<RagChunk, 'pageStart' | 'pageEnd'>) {
  return chunk.pageStart === chunk.pageEnd
    ? `p.${chunk.pageStart}`
    : `pp.${chunk.pageStart}-${chunk.pageEnd}`;
}

function truncateChunk(text: string, maxChars = 700) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trim()}...`;
}

async function fetchQueryEmbedding(query: string) {
  if (!RAG_EMBEDDING_MODEL) {
    return null;
  }

  if (queryEmbeddingCache.has(query)) {
    return queryEmbeddingCache.get(query) ?? null;
  }

  try {
    const response = await fetch(`${getEmbeddingRequestBaseUrl()}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RAG_EMBEDDING_MODEL,
        input: query,
      }),
    });

    if (!response.ok) {
      queryEmbeddingCache.set(query, null);
      return null;
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;

    if (!Array.isArray(embedding)) {
      queryEmbeddingCache.set(query, null);
      return null;
    }

    queryEmbeddingCache.set(query, embedding as number[]);
    return embedding as number[];
  } catch {
    queryEmbeddingCache.set(query, null);
    return null;
  }
}

export async function retrieveRagChunks({
  query,
  limit = 4,
}: {
  query: string;
  limit?: number;
}) {
  const queryTokens = tokenize(query);
  const ragIndex = await loadRagIndex();
  if (queryTokens.length === 0 || ragIndex.chunks.length === 0) {
    return [] as RetrievedRagChunk[];
  }

  const queryEmbedding = await fetchQueryEmbedding(query);

  return ragIndex.chunks
    .map((chunk) => {
      const lexicalScore = scoreChunkLexically(chunk, queryTokens);
      const embeddingScore = queryEmbedding && chunk.embedding
        ? Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding))
        : 0;
      const combinedScore = queryEmbedding && chunk.embedding
        ? embeddingScore * 100 + lexicalScore
        : lexicalScore;

      return {
        chunk,
        score: combinedScore,
        method: queryEmbedding && chunk.embedding ? 'embedding' as const : 'lexical' as const,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      citationId: `[P${index + 1}]`,
    }));
}

export async function buildRagContext({
  query,
  limit = 4,
}: {
  query: string;
  limit?: number;
}) {
  const chunks = await retrieveRagChunks({ query, limit });
  if (chunks.length === 0) {
    return {
      context: '',
      citations: [] as RagCitation[],
    };
  }

  return {
    context: [
      'Estratti rilevanti da paper e documenti locali:',
      ...chunks.map(({ chunk, citationId }) => `${citationId} ${chunk.documentTitle} (${formatPageRange(chunk)}): ${truncateChunk(chunk.text)}`),
    ].join('\n'),
    citations: chunks.map(({ chunk, citationId }) => ({
      citationId,
      documentTitle: chunk.documentTitle,
      sourceFile: chunk.sourceFile,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    })),
  };
}

export function buildRagCitationFooter(citations: RagCitation[]) {
  if (citations.length === 0) {
    return '';
  }

  return [
    '---',
    '**Fonti recuperate**',
    ...citations.map((citation) => `- ${citation.citationId} ${citation.documentTitle} (${formatPageRange(citation)}, ${citation.sourceFile})`),
  ].join('\n');
}

export async function getRagLibraryStats() {
  const ragIndex = await loadRagIndex();
  const chunksWithEmbeddings = ragIndex.chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0).length;

  return {
    documents: ragIndex.documents.length,
    chunks: ragIndex.chunks.length,
    chunksWithEmbeddings,
    hasEmbeddings: chunksWithEmbeddings > 0,
    generatedAt: ragIndex.generatedAt,
  };
}

export async function getAllRagDocuments() {
  const index = await loadRagIndex();
  return index.documents;
}
