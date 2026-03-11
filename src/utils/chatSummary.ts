import { HealthData, Message } from '../types';
import { sendCoachRequest } from './aiClient';
import { buildGlobalCoachContext } from './coachContext';

export async function generateChatSummary({
  messages,
  healthData,
}: {
  messages: Message[];
  healthData?: HealthData | null;
}) {
  const content = await sendCoachRequest({
    messages,
    contextBlocks: [buildGlobalCoachContext(healthData)],
    extraSystemPrompt: `Il tuo compito e creare un riassunto di memoria per continuare una chat in una nuova sessione.

Regole:
- scrivi massimo 8 bullet brevi;
- includi solo fatti utili per continuare il coaching;
- includi: obiettivo, vincoli, decisioni prese, workout o recupero discussi, tono o preferenze dell'utente;
- non scrivere introduzioni;
- non scrivere testo superfluo;
- se mancano dati, non inventare nulla.`,
    temperature: 0.2,
  });

  return content.trim();
}
