import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import type { RagChunk, RagDocument, RagIndex } from '../src/types/rag';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const papersDir = path.join(projectRoot, 'data', 'papers');
const outputDir = path.join(projectRoot, 'public', 'rag');
const outputFile = path.join(outputDir, 'papers.generated.json');
const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || process.env.VITE_RAG_EMBEDDING_MODEL || '';
const EMBEDDING_BASE_URL = process.env.RAG_EMBEDDING_BASE_URL || process.env.VITE_RAG_EMBEDDING_BASE_URL || process.env.VITE_LLM_BASE_URL || 'http://127.0.0.1:1234/v1';
const EMBEDDING_BATCH_SIZE = 12;

const MAX_CHARS_PER_CHUNK = 1400;
const MIN_CHARS_PER_CHUNK = 500;
const KEYWORD_LIMIT = 12;

const STOPWORDS = new Set([
  'alla',
  'alle',
  'anche',
  'che',
  'come',
  'con',
  'del',
  'della',
  'delle',
  'degli',
  'dello',
  'dopo',
  'gli',
  'il',
  'in',
  'la',
  'le',
  'lo',
  'nei',
  'nel',
  'nella',
  'nelle',
  'non',
  'per',
  'piu',
  'sono',
  'sul',
  'sulla',
  'sulle',
  'tra',
  'una',
  'uno',
]);

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeText(value: string) {
  return value
    .replace(/-\s*\n/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function extractKeywords(text: string) {
  const counts = new Map<string, number>();

  tokenize(text).forEach((token) => {
    counts.set(token, (counts.get(token) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, KEYWORD_LIMIT)
    .map(([token]) => token);
}

type PageUnit = {
  page: number;
  text: string;
};

function splitLargeUnit(unit: PageUnit) {
  if (unit.text.length <= MAX_CHARS_PER_CHUNK) {
    return [unit];
  }

  const sentences = unit.text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const parts: PageUnit[] = [];
  let current = '';

  sentences.forEach((sentence) => {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > MAX_CHARS_PER_CHUNK && current) {
      parts.push({ page: unit.page, text: current });
      current = sentence;
      return;
    }

    current = candidate;
  });

  if (current) {
    parts.push({ page: unit.page, text: current });
  }

  return parts.length > 0 ? parts : [unit];
}

function buildUnits(pages: Array<{ num: number; text: string }>) {
  return pages.flatMap((page) => {
    const normalized = normalizeText(page.text);
    if (!normalized) {
      return [];
    }

    const paragraphs = normalized
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
      .filter(Boolean);

    const units = (paragraphs.length > 0 ? paragraphs : [normalized]).map((text) => ({
      page: page.num,
      text,
    }));

    return units.flatMap(splitLargeUnit);
  });
}

function buildChunks(documentId: string, title: string, sourceFile: string, units: PageUnit[]) {
  const chunks: RagChunk[] = [];
  let buffer: PageUnit[] = [];
  let charCount = 0;

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }

    const text = buffer.map((unit) => unit.text).join('\n\n').trim();
    if (!text) {
      buffer = [];
      charCount = 0;
      return;
    }

    chunks.push({
      id: `${documentId}-chunk-${chunks.length + 1}`,
      documentId,
      documentTitle: title,
      sourceFile,
      pageStart: buffer[0].page,
      pageEnd: buffer[buffer.length - 1].page,
      text,
      keywords: extractKeywords(text),
      approxTokens: Math.ceil(text.length / 4),
    });

    buffer = [];
    charCount = 0;
  };

  units.forEach((unit) => {
    const nextLength = charCount + unit.text.length;
    if (buffer.length > 0 && nextLength > MAX_CHARS_PER_CHUNK && charCount >= MIN_CHARS_PER_CHUNK) {
      flush();
    }

    buffer.push(unit);
    charCount += unit.text.length;
  });

  flush();

  return chunks;
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function buildEmbeddings(texts: string[]) {
  if (!EMBEDDING_MODEL || texts.length === 0) {
    return null;
  }

  const response = await fetch(`${normalizeBaseUrl(EMBEDDING_BASE_URL)}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${raw}`);
  }

  const data = await response.json();
  const embeddings = data?.data?.map((item: { embedding?: number[] }) => item.embedding);

  if (!Array.isArray(embeddings) || embeddings.some((embedding) => !Array.isArray(embedding))) {
    throw new Error('Embedding response payload missing vectors');
  }

  return embeddings as number[][];
}

async function attachEmbeddings(chunks: RagChunk[]) {
  if (!EMBEDDING_MODEL || chunks.length === 0) {
    return chunks;
  }

  const enrichedChunks = [...chunks];

  for (let index = 0; index < enrichedChunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = enrichedChunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    const embeddings = await buildEmbeddings(batch.map((chunk) => chunk.text));

    if (!embeddings) {
      break;
    }

    batch.forEach((chunk, batchIndex) => {
      chunk.embedding = embeddings[batchIndex];
    });
  }

  return enrichedChunks;
}

async function getPdfFiles(dirPath: string) {
  await ensureDir(dirPath);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => path.join(dirPath, entry.name));
}

async function extractDocument(pdfPath: string) {
  const data = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const fileName = path.basename(pdfPath);
    const title = path.basename(pdfPath, path.extname(pdfPath)).replace(/[_-]+/g, ' ').trim();
    const id = slugify(title || fileName);
    const units = buildUnits(result.pages);
    const chunks = buildChunks(id, title || fileName, fileName, units);
    const document: RagDocument = {
      id,
      title: title || fileName,
      sourceFile: fileName,
      pageCount: result.total,
      chunkCount: chunks.length,
      updatedAt: new Date().toISOString(),
    };

    return {
      document,
      chunks,
    };
  } finally {
    await parser.destroy();
  }
}

async function writeGeneratedIndex(index: RagIndex) {
  await ensureDir(outputDir);
  await fs.writeFile(outputFile, JSON.stringify(index, null, 2), 'utf8');
}

async function main() {
  const pdfFiles = await getPdfFiles(papersDir);
  const documents: RagDocument[] = [];
  let chunks: RagChunk[] = [];

  for (const pdfFile of pdfFiles) {
    const extracted = await extractDocument(pdfFile);
    documents.push(extracted.document);
    chunks.push(...extracted.chunks);
  }

  const index: RagIndex = {
    generatedAt: new Date().toISOString(),
    documents,
    chunks: await attachEmbeddings(chunks),
  };

  await writeGeneratedIndex(index);

  console.log(`RAG index aggiornato: ${documents.length} documenti, ${chunks.length} chunk.`);
  console.log(`Output: ${path.relative(projectRoot, outputFile)}`);
  console.log(EMBEDDING_MODEL
    ? `Embeddings attivi con modello ${EMBEDDING_MODEL}.`
    : 'Embeddings non configurati: retrieval solo lessicale.');
}

main().catch((error) => {
  console.error('Errore ingestione paper:', error);
  process.exitCode = 1;
});
