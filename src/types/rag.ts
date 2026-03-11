export interface RagDocument {
  id: string;
  title: string;
  sourceFile: string;
  pageCount: number;
  chunkCount: number;
  updatedAt: string;
}

export interface RagChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  sourceFile: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  keywords: string[];
  approxTokens: number;
  embedding?: number[];
}

export interface RagIndex {
  generatedAt: string;
  documents: RagDocument[];
  chunks: RagChunk[];
}

export interface RagCitation {
  citationId: string;
  documentTitle: string;
  sourceFile: string;
  pageStart: number;
  pageEnd: number;
}
