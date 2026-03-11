<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FitSync AI

## Run locally

Prerequisiti: Node.js

1. Installa le dipendenze con `npm install`
2. Configura LM Studio nel file `.env`
3. Avvia il frontend con `npm run dev`

## RAG locale su PDF

Il progetto supporta una pipeline RAG locale per paper e documenti PDF:

1. Copia i PDF in `data/papers`
2. Genera l'indice chunkizzato con `npm run rag:ingest`
3. Avvia o riavvia l'app con `npm run dev`

L'ingestione crea un indice TypeScript in `src/data/rag/papers.generated.ts` che viene usato dal retrieval locale durante le richieste AI.

Note:
- il retrieval attuale e una v1 locale e leggera: chunking + ranking lessicale
- i PDF non vengono inviati interi al modello
- il modello riceve solo i chunk piu rilevanti per la query corrente

## Embeddings opzionali

Per attivare il retrieval v2 ibrido con embeddings su LM Studio, aggiungi in `.env`:

```env
VITE_RAG_EMBEDDING_BASE_URL="http://127.0.0.1:1234/v1"
VITE_RAG_EMBEDDING_MODEL="your-embedding-model-id"
```

Poi:

1. carica in LM Studio anche un modello embeddings
2. esegui di nuovo `npm run rag:ingest`
3. riavvia `npm run dev`
