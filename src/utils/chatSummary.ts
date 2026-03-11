import { HealthData, Message } from '../types';
import { buildChatContextSummary, sendCoachRequest } from './aiClient';

const SUMMARY_MESSAGE_WINDOW = 10;

function getRecentMessages(messages: Message[]) {
  if (messages.length <= SUMMARY_MESSAGE_WINDOW) {
    return messages;
  }

  return messages.slice(-SUMMARY_MESSAGE_WINDOW);
}

export async function generateChatSummary({
  messages,
  healthData,
  previousSummary,
  signal,
}: {
  messages: Message[];
  healthData?: HealthData | null;
  previousSummary?: string;
  signal?: AbortSignal;
}) {
  const content = await sendCoachRequest({
    messages: getRecentMessages(messages),
    contextBlocks: [
      buildChatContextSummary(healthData),
      previousSummary ? `Riassunto accumulato da aggiornare:\n${previousSummary}` : '',
    ],
    extraSystemPrompt: `Il tuo compito e creare un riassunto di memoria per continuare una chat in una nuova sessione.

Regole:
- scrivi massimo 8 bullet brevi;
- integra il riassunto precedente con i messaggi recenti senza perdere decisioni ancora valide;
- includi solo fatti utili per continuare il coaching;
- includi: obiettivo, vincoli, decisioni prese, workout o recupero discussi, tono o preferenze dell'utente;
- non scrivere introduzioni;
- non scrivere testo superfluo;
- se mancano dati, non inventare nulla.`,
    temperature: 0.2,
    includeKnowledgeContext: false,
    includeScienceInsights: false,
    includeRagContext: false,
    maxRecentMessages: SUMMARY_MESSAGE_WINDOW,
    signal,
  });

  return content.trim();
}
