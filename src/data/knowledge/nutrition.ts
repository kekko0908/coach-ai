import { KnowledgeEntry } from '../../types/knowledge';

export const NUTRITION_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'nutrition-protein-basics',
    scope: 'nutrition',
    topic: 'Proteine',
    summary: 'Per sostenere recupero e composizione corporea, la quota proteica giornaliera va distribuita nei pasti e non concentrata tutta in un unico momento.',
    tags: ['proteine', 'recupero', 'massa', 'dimagrimento'],
    sourceLabel: 'ISSN position stand su proteine',
  },
  {
    id: 'nutrition-carb-training-days',
    scope: 'nutrition',
    topic: 'Carboidrati nei giorni intensi',
    summary: 'Nei giorni con partita, corsa intensa o seduta gambe pesante, tenere carboidrati troppo bassi puo ridurre performance e recupero percepito.',
    tags: ['carboidrati', 'partita', 'corsa', 'gambe', 'energia'],
    sourceLabel: 'Guidelines nutrizione sportiva',
  },
  {
    id: 'nutrition-hydration',
    scope: 'nutrition',
    topic: 'Idratazione',
    summary: 'Idratazione e sali diventano piu rilevanti quando la durata sale, la sudorazione e alta o ci sono partite e allenamenti lunghi in sequenza.',
    tags: ['idratazione', 'sali', 'calcio', 'estate', 'durata'],
    sourceLabel: 'ACSM hydration guidance',
  },
  {
    id: 'nutrition-fat-loss-adherence',
    scope: 'nutrition',
    topic: 'Dimagrimento sostenibile',
    summary: 'Per dimagrire conta piu un deficit moderato e sostenibile con buona aderenza che tagli estremi che peggiorano allenamento, fame e recupero.',
    tags: ['dimagrimento', 'deficit', 'aderenza', 'energia'],
    sourceLabel: 'Consensus su body composition',
  },
];
