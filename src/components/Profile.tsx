import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { User, Target, Save, Activity, Calendar, Bot, Loader2 } from 'lucide-react';
import { DEFAULT_HEART_RATE_ZONES, normalizeHeartRateZones } from '../utils/heartRateZones';
import { extractJsonBlock, getAiConnectionHint, sendCoachRequest } from '../utils/aiClient';
import { readCoachMemory, saveCoachMemory, syncCoachMemoryFromProfile } from '../utils/coachMemory';
import { CoachMainSport, CoachMemory, CoachPrimaryGoal } from '../types/coach';
import { hydrateProfileFromSupabase, saveProfileToSupabase } from '../lib/supabase/profileRepository';
import { getErrorMessage } from '../utils/errorMessage';

const PRIMARY_GOAL_OPTIONS: Array<{ value: CoachPrimaryGoal; label: string }> = [
  { value: 'performance', label: 'Performance' },
  { value: 'hypertrophy', label: 'Ipertrofia' },
  { value: 'strength', label: 'Forza' },
  { value: 'fat_loss', label: 'Dimagrimento' },
  { value: 'health', label: 'Salute generale' },
];

const MAIN_SPORT_OPTIONS: Array<{ value: CoachMainSport; label: string }> = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'gym', label: 'Palestra' },
  { value: 'football', label: 'Calcio' },
  { value: 'running', label: 'Corsa' },
  { value: 'cycling', label: 'Ciclismo' },
];

function formatListForTextarea(values: string[]) {
  return values.join('\n');
}

function parseTextareaList(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

const DAYS_OF_WEEK = [
  { id: 'monday', label: 'Lunedì' },
  { id: 'tuesday', label: 'Martedì' },
  { id: 'wednesday', label: 'Mercoledì' },
  { id: 'thursday', label: 'Giovedì' },
  { id: 'friday', label: 'Venerdì' },
  { id: 'saturday', label: 'Sabato' },
  { id: 'sunday', label: 'Domenica' },
] as const;

const MUSCLE_GROUPS = ['Petto', 'Dorso', 'Gambe', 'Spalle', 'Braccia', 'Core', 'Cardio', 'Riposo', 'Sport'];

export default function Profile() {
  const [profile, setProfile] = useState<UserProfile>({
    name: 'Utente',
    weight: 75,
    heartRateMax: 190,
    heartRateZones: DEFAULT_HEART_RATE_ZONES,
    targetSteps: 10000,
    targetSleep: 8,
    trainingDays: 4,
    preferredSplit: 'Push / Pull / Legs',
    activeDays: ['monday', 'tuesday', 'thursday', 'friday'],
    weeklySchedule: {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    }
  });
  const [isSaved, setIsSaved] = useState(false);
  const [isGeneratingSplit, setIsGeneratingSplit] = useState(false);
  const [coachMemory, setCoachMemory] = useState<CoachMemory>(() => readCoachMemory());
  const [coachTextDrafts, setCoachTextDrafts] = useState({
    availableEquipment: formatListForTextarea(readCoachMemory().availableEquipment),
    limitations: formatListForTextarea(readCoachMemory().limitations),
    injuries: formatListForTextarea(readCoachMemory().injuries),
    preferences: formatListForTextarea(readCoachMemory().preferences),
    coachNotes: formatListForTextarea(readCoachMemory().coachNotes),
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isRemoteEmpty, setIsRemoteEmpty] = useState(false);

  useEffect(() => {
    setCoachTextDrafts({
      availableEquipment: formatListForTextarea(coachMemory.availableEquipment),
      limitations: formatListForTextarea(coachMemory.limitations),
      injuries: formatListForTextarea(coachMemory.injuries),
      preferences: formatListForTextarea(coachMemory.preferences),
      coachNotes: formatListForTextarea(coachMemory.coachNotes),
    });
  }, [coachMemory.availableEquipment, coachMemory.limitations, coachMemory.injuries, coachMemory.preferences, coachMemory.coachNotes]);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        const { profile: remoteProfile, coachMemory: remoteCoachMemory } = await hydrateProfileFromSupabase();
        if (!isMounted) {
          return;
        }

        if (!remoteProfile) {
          setIsRemoteEmpty(true);
          return;
        }

        const parsed = {
          ...remoteProfile,
          weeklySchedule: remoteProfile.weeklySchedule || {
            monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
          },
          activeDays: remoteProfile.activeDays?.length ? remoteProfile.activeDays : ['monday', 'tuesday', 'thursday', 'friday'],
          heartRateMax: remoteProfile.heartRateMax || 190,
          heartRateZones: normalizeHeartRateZones(remoteProfile.heartRateZones),
        };

        setProfile(parsed);
        setCoachMemory(remoteCoachMemory || syncCoachMemoryFromProfile(parsed));
        setIsRemoteEmpty(false);
        setSyncError(null);
      } catch (error) {
        console.error('Profile sync error:', error);
        setSyncError(getErrorMessage(error, 'Sync profilo non riuscita.'));
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async () => {
    const nextCoachMemory: CoachMemory = {
      ...coachMemory,
      availableEquipment: parseTextareaList(coachTextDrafts.availableEquipment),
      limitations: parseTextareaList(coachTextDrafts.limitations),
      injuries: parseTextareaList(coachTextDrafts.injuries),
      preferences: parseTextareaList(coachTextDrafts.preferences),
      coachNotes: parseTextareaList(coachTextDrafts.coachNotes),
      updatedAt: new Date().toISOString(),
    };

    setCoachMemory(nextCoachMemory);

    try {
      await saveProfileToSupabase(profile, nextCoachMemory);
      setSyncError(null);
      setIsRemoteEmpty(false);
    } catch (error) {
      console.error('Profile save error:', error);
      setSyncError(getErrorMessage(error, 'Salvataggio profilo non riuscito su Supabase.'));
      return;
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleChange = (field: keyof UserProfile, value: string | number) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const toggleActiveDay = (dayId: string) => {
    setProfile(prev => {
      const newActiveDays = prev.activeDays.includes(dayId)
        ? prev.activeDays.filter(d => d !== dayId)
        : [...prev.activeDays, dayId];
      
      return {
        ...prev,
        activeDays: newActiveDays,
        trainingDays: newActiveDays.length
      };
    });
  };

  const toggleMuscle = (day: keyof UserProfile['weeklySchedule'], muscle: string) => {
    setProfile(prev => {
      const daySchedule = prev.weeklySchedule[day] || [];
      const newSchedule = daySchedule.includes(muscle)
        ? daySchedule.filter(m => m !== muscle)
        : [...daySchedule, muscle];
      return {
        ...prev,
        weeklySchedule: {
          ...prev.weeklySchedule,
          [day]: newSchedule
        }
      };
    });
  };

  const updateHeartRateZone = (zoneId: UserProfile['heartRateZones'][number]['zone'], field: 'min' | 'max', value: number) => {
    setProfile((prev) => ({
      ...prev,
      heartRateZones: prev.heartRateZones.map((zone) => (
        zone.zone === zoneId ? { ...zone, [field]: value } : zone
      )),
    }));
  };

  const handleCoachMemoryChange = <K extends keyof CoachMemory>(field: K, value: CoachMemory[K]) => {
    setCoachMemory((prev) => ({
      ...prev,
      [field]: value,
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleCoachTextDraftChange = (field: keyof typeof coachTextDrafts, value: string) => {
    setCoachTextDrafts((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const commitCoachTextDraft = (field: keyof typeof coachTextDrafts, targetField: keyof Pick<CoachMemory, 'availableEquipment' | 'limitations' | 'injuries' | 'preferences' | 'coachNotes'>) => {
    handleCoachMemoryChange(targetField, parseTextareaList(coachTextDrafts[field]));
  };

  const generateAiSplit = async () => {
    if (profile.activeDays.length === 0) {
      alert("Seleziona almeno un giorno di allenamento.");
      return;
    }
    
    setIsGeneratingSplit(true);
    try {
      const prompt = `
Sei un personal trainer esperto. Devo creare una scheda di allenamento settimanale.
Giorni di allenamento selezionati: ${profile.activeDays.join(', ')}.
Split preferito: ${profile.preferredSplit}.
Gruppi muscolari disponibili: ${MUSCLE_GROUPS.join(', ')}.

Assegna i gruppi muscolari in modo scientifico ed equilibrato SOLO ai giorni di allenamento selezionati.
Rispondi ESATTAMENTE con un JSON valido con questa struttura:
{
  "monday": ["Petto", "Spalle"],
  "tuesday": ["Dorso", "Braccia"],
  ...
}
Non includere testo fuori dal JSON, solo il JSON puro. Se un giorno non è tra quelli selezionati, lascialo vuoto [].
      `;

      const content = await sendCoachRequest({
        messages: [{ role: 'user', content: prompt }],
        extraSystemPrompt: `Rispondi solo con JSON valido.
- Nessun testo introduttivo.
- Nessun blocco markdown se non necessario.
- Ogni giorno deve esistere come array.`,
        temperature: 0.2,
        knowledgeQuery: `${profile.preferredSplit} ${profile.activeDays.join(' ')} split settimanale gruppi muscolari recupero volume`,
        knowledgeScopes: ['training', 'recovery'],
        ragQuery: `${profile.preferredSplit} ${profile.activeDays.join(' ')} split settimanale gruppi muscolari recupero volume`,
        annotateRagSources: false,
      });
      const generatedSchedule = JSON.parse(extractJsonBlock(content));
      
      // Merge with existing empty days to ensure all days are present
      const newSchedule = {
        monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
        ...generatedSchedule
      };

      setProfile(prev => ({
        ...prev,
        weeklySchedule: newSchedule
      }));

    } catch (error) {
      console.error(error);
      alert(`Errore durante la generazione dello split. Verifica ${getAiConnectionHint()} e che il modello restituisca JSON valido.`);
    } finally {
      setIsGeneratingSplit(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <User className="w-8 h-8 text-emerald-400" />
            Profilo e Obiettivi
          </h1>
          <p className="text-zinc-400">Imposta i tuoi dati personali per personalizzare l'esperienza e i consigli dell'AI.</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-8">
          {syncError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {syncError}
            </div>
          ) : null}
          {isRemoteEmpty ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Supabase non contiene ancora un profilo per questo account. Compila i campi e premi Salva.
            </div>
          ) : null}
          
          {/* Dati Personali */}
          <div>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Dati Personali
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Nome</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Peso Attuale (kg)</label>
                <input
                  type="number"
                  value={profile.weight}
                  onChange={(e) => handleChange('weight', Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Frequenza Cardiaca Max (bpm)</label>
                <input
                  type="number"
                  value={profile.heartRateMax}
                  onChange={(e) => handleChange('heartRateMax', Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <hr className="border-zinc-800" />

          {/* Obiettivi */}
          <div>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-400" />
              Obiettivi e Allenamento
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Obiettivo Passi Giornalieri</label>
                <input
                  type="number"
                  step="500"
                  value={profile.targetSteps}
                  onChange={(e) => handleChange('targetSteps', Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Obiettivo Sonno (ore)</label>
                <input
                  type="number"
                  step="0.5"
                  value={profile.targetSleep}
                  onChange={(e) => handleChange('targetSleep', Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-400 mb-2">Split Preferito (es. PPL, Upper/Lower)</label>
                <input
                  type="text"
                  value={profile.preferredSplit}
                  onChange={(e) => handleChange('preferredSplit', e.target.value)}
                  placeholder="es. Full Body, Bro Split..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
                <p className="text-xs text-zinc-500 mt-2">L'AI userà questo split per generare la tua programmazione settimanale in modo scientifico.</p>
              </div>
            </div>
          </div>

          <hr className="border-zinc-800" />

          <div>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-emerald-400" />
              Memoria Coach
            </h2>
            <p className="text-sm text-zinc-400 mb-6">
              Queste informazioni aiutano l'AI a ricordare obiettivi, sport principale, vincoli e preferenze senza doverli ripetere ogni volta.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Obiettivo Primario</label>
                <select
                  value={coachMemory.primaryGoal}
                  onChange={(e) => handleCoachMemoryChange('primaryGoal', e.target.value as CoachPrimaryGoal)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                >
                  {PRIMARY_GOAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Sport Principale</label>
                <select
                  value={coachMemory.mainSport}
                  onChange={(e) => handleCoachMemoryChange('mainSport', e.target.value as CoachMainSport)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                >
                  {MAIN_SPORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-400 mb-2">Fase Corrente</label>
                <input
                  type="text"
                  value={coachMemory.currentPhase || ''}
                  onChange={(e) => handleCoachMemoryChange('currentPhase', e.target.value || undefined)}
                  placeholder="es. build forza, ritorno graduale, pre-season calcio"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-400 mb-2">Attrezzatura Disponibile</label>
                <textarea
                  value={coachTextDrafts.availableEquipment}
                  onChange={(e) => handleCoachTextDraftChange('availableEquipment', e.target.value)}
                  onBlur={() => commitCoachTextDraft('availableEquipment', 'availableEquipment')}
                  rows={4}
                  placeholder={'Una riga per attrezzo\nes. bilanciere\nkettlebell\nbarra trazioni'}
                  className="w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Il planner AI usera questa lista per evitare esercizi che richiedono attrezzatura non disponibile.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Limitazioni</label>
                <textarea
                  value={coachTextDrafts.limitations}
                  onChange={(e) => handleCoachTextDraftChange('limitations', e.target.value)}
                  onBlur={() => commitCoachTextDraft('limitations', 'limitations')}
                  rows={4}
                  placeholder={'Una riga per voce\nes. no bilanciere sopra la testa'}
                  className="w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Infortuni o Fastidi</label>
                <textarea
                  value={coachTextDrafts.injuries}
                  onChange={(e) => handleCoachTextDraftChange('injuries', e.target.value)}
                  onBlur={() => commitCoachTextDraft('injuries', 'injuries')}
                  rows={4}
                  placeholder={'Una riga per voce\nes. fastidio ginocchio destro'}
                  className="w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Preferenze Coach</label>
                <textarea
                  value={coachTextDrafts.preferences}
                  onChange={(e) => handleCoachTextDraftChange('preferences', e.target.value)}
                  onBlur={() => commitCoachTextDraft('preferences', 'preferences')}
                  rows={4}
                  placeholder={'Una riga per voce\nes. sessioni sotto 75 minuti'}
                  className="w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Note Coach</label>
                <textarea
                  value={coachTextDrafts.coachNotes}
                  onChange={(e) => handleCoachTextDraftChange('coachNotes', e.target.value)}
                  onBlur={() => commitCoachTextDraft('coachNotes', 'coachNotes')}
                  rows={4}
                  placeholder={'Una riga per voce\nes. utente tende a fare troppo volume sulle gambe'}
                  className="w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <hr className="border-zinc-800" />

          <div>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Zone Frequenza Cardiaca
            </h2>
            <div className="space-y-4">
              {profile.heartRateZones.map((zone) => (
                <div key={zone.zone} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-bold text-white">{zone.label}</div>
                    <div className="text-xs uppercase tracking-wider text-zinc-500">{zone.zone}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Min bpm</label>
                      <input
                        type="number"
                        value={zone.min}
                        onChange={(e) => updateHeartRateZone(zone.zone, 'min', Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Max bpm</label>
                      <input
                        type="number"
                        value={zone.max}
                        onChange={(e) => updateHeartRateZone(zone.zone, 'max', Number(e.target.value))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <hr className="border-zinc-800" />

          {/* Programmazione Settimanale */}
          <div>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-emerald-400" />
                  Programmazione Settimanale
                </h2>
                <p className="text-sm text-zinc-400 mt-1">Seleziona i giorni in cui vuoi allenarti ({profile.trainingDays} giorni selezionati).</p>
              </div>
              <button
                onClick={generateAiSplit}
                disabled={isGeneratingSplit || profile.activeDays.length === 0}
                className="flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg font-medium transition-colors border border-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
              >
                {isGeneratingSplit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                {isGeneratingSplit ? 'Generazione...' : 'Genera Split con AI'}
              </button>
            </div>
            
            <div className="flex flex-wrap gap-2 mb-6">
              {DAYS_OF_WEEK.map((day) => {
                const isActive = profile.activeDays.includes(day.id);
                return (
                  <button
                    key={`toggle-${day.id}`}
                    onClick={() => toggleActiveDay(day.id)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      isActive 
                        ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/20' 
                        : 'bg-zinc-950 text-zinc-500 border border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              {DAYS_OF_WEEK.map((day) => {
                const isActive = profile.activeDays.includes(day.id);
                if (!isActive) return null; // Nascondi i giorni non attivi
                
                return (
                  <div key={day.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="w-24 font-bold text-emerald-400">{day.label}</div>
                    <div className="flex-1 flex flex-wrap gap-2">
                      {MUSCLE_GROUPS.map((muscle) => {
                        const isSelected = profile.weeklySchedule[day.id as keyof UserProfile['weeklySchedule']]?.includes(muscle);
                        return (
                          <button
                            key={muscle}
                            onClick={() => toggleMuscle(day.id as keyof UserProfile['weeklySchedule'], muscle)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              isSelected 
                                ? 'bg-zinc-200 text-zinc-900' 
                                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800'
                            }`}
                          >
                            {muscle}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              
              {profile.activeDays.length === 0 && (
                <div className="text-center py-8 text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                  Seleziona almeno un giorno di allenamento per impostare i gruppi muscolari.
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between">
            <p className="text-sm text-zinc-500">Questi dati verranno utilizzati dall'AI per generare piani di allenamento su misura.</p>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
            >
              <Save className="w-5 h-5" />
              {isSaved ? 'Salvato!' : 'Salva Profilo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
