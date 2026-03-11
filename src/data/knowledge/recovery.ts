import { KnowledgeEntry } from '../../types/knowledge';

export const RECOVERY_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'recovery-sleep-priority',
    scope: 'recovery',
    topic: 'Sonno e recupero',
    summary: 'Il sonno insufficiente peggiora percezione dello sforzo, recupero, regolazione dell appetito e qualita della performance. La prima leva e aumentare costanza e durata del sonno.',
    tags: ['sonno', 'recupero', 'performance', 'fatica'],
    sourceLabel: 'Consensus statement su sleep e athletic performance',
  },
  {
    id: 'recovery-active-vs-complete-rest',
    scope: 'recovery',
    topic: 'Recupero attivo',
    summary: 'Dopo carichi elevati, mobilita, camminata leggera o cyclette facile possono essere piu utili del riposo assoluto quando l obiettivo e recuperare senza irrigidirsi.',
    tags: ['recupero attivo', 'mobilita', 'defaticamento'],
    sourceLabel: 'Prassi recovery negli sport di prestazione',
  },
  {
    id: 'recovery-hrv-interpretation',
    scope: 'recovery',
    topic: 'Interpretazione HRV',
    summary: 'L HRV va letto come trend e non come numero isolato. Una discesa insieme a sonno scarso e battito a riposo alto suggerisce di ridurre il carico del giorno.',
    tags: ['hrv', 'trend', 'readiness', 'battito'],
    sourceLabel: 'Review su HRV monitoring',
  },
  {
    id: 'recovery-deload-principle',
    scope: 'recovery',
    topic: 'Deload',
    summary: 'Il deload ha piu senso come riduzione temporanea di volume e fatica mantenendo alcuni stimoli, non come stop totale prolungato senza criterio.',
    tags: ['deload', 'volume', 'fatica', 'settimana scarico'],
    sourceLabel: 'Principi di fatigue management',
  },
  {
    id: 'recovery-doms-management',
    scope: 'recovery',
    topic: 'DOMS',
    summary: 'In presenza di DOMS forti, meglio caricare in modo tecnico e controllato o spostare il focus su altri distretti invece di forzare una seduta identica ad alto volume.',
    tags: ['doms', 'indolenzimento', 'gambe', 'carico'],
    sourceLabel: 'Strategie pratiche di gestione DOMS',
  },
];
