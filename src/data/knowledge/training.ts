import { KnowledgeEntry } from '../../types/knowledge';

export const TRAINING_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'training-progressive-overload',
    scope: 'training',
    topic: 'Sovraccarico progressivo',
    summary: 'La progressione funziona meglio quando aumenti gradualmente carico, ripetizioni, densita o volume mantenendo tecnica e recupero sufficienti.',
    tags: ['progressione', 'sovraccarico', 'volume', 'forza', 'ipertrofia'],
    sourceLabel: 'NSCA / principi di programmazione della forza',
  },
  {
    id: 'training-hypertrophy-volume',
    scope: 'training',
    topic: 'Volume per ipertrofia',
    summary: 'Per la crescita muscolare il volume efficace va distribuito nella settimana; troppo volume concentrato in una sola seduta riduce qualita e recupero.',
    tags: ['ipertrofia', 'volume', 'set', 'massa', 'split'],
    sourceLabel: 'Review su ipertrofia e dose-response',
  },
  {
    id: 'training-strength-specificity',
    scope: 'training',
    topic: 'Specificita della forza',
    summary: 'Se l obiettivo principale e la forza, le alzate chiave devono comparire con regolarita e con intensita coerente, non solo come accessori occasionali.',
    tags: ['forza', 'specificita', 'squat', 'bench', 'deadlift'],
    sourceLabel: 'NSCA / principi di specificita',
  },
  {
    id: 'training-rpe-autoregulation',
    scope: 'training',
    topic: 'Autoregolazione',
    summary: 'RPE e buffer sono utili per adattare il carico al recupero del giorno; nei giorni no conviene lasciare piu margine invece di inseguire il numero.',
    tags: ['rpe', 'buffer', 'autoregolazione', 'fatica'],
    sourceLabel: 'Letteratura su autoregolazione e RPE',
  },
  {
    id: 'training-football-concurrent-load',
    scope: 'training',
    topic: 'Palestra e calcio',
    summary: 'Quando coesistono palestra e calcio, i giorni gambe pesanti vanno distanziati da partite e sprint ad alta intensita per limitare interferenza e fatica neuromuscolare.',
    tags: ['calcio', 'gambe', 'partita', 'sprint', 'interferenza'],
    sourceLabel: 'Principi di concurrent training negli sport di squadra',
  },
  {
    id: 'training-running-strength-support',
    scope: 'training',
    topic: 'Forza per runner',
    summary: 'Per chi corre, la forza supporta economia di corsa e robustezza; meglio poche sedute ben fatte che volume gambe eccessivo a ridosso delle uscite chiave.',
    tags: ['corsa', 'running', 'forza', 'economia di corsa', 'gambe'],
    sourceLabel: 'Review su strength training per endurance',
  },
];
