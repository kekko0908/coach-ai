import React, { useEffect, useMemo, useState } from 'react';
import { PersonalRecord, PersonalRecordType, RecordEntry } from '../types';
import { Trophy, Plus, Trash2, TrendingUp, TrendingDown, Dumbbell, ArrowLeft, Calendar, Ruler, Clock3, Flame, Hash, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getErrorMessage } from '../utils/errorMessage';
import { loadRecordsFromSupabase, saveRecordsToSupabase } from '../lib/supabase/recordsRepository';
import { getStoredWorkouts } from '../lib/appDataStore';
import {
  formatRecordValue,
  getDefaultUnitForRecordType,
  getRecordChartScore,
  getRecordTypeLabel,
  getSecondaryUnitForRecordType,
  trimTrailingZeros,
} from '../utils/recordFormatting';
import { createAppUuid } from '../utils/uuid';
import { deriveWorkoutRecordCandidates, hasDerivedRecordBeenSaved } from '../utils/workoutRecords';

type RecordDraft = {
  exerciseName: string;
  recordType: PersonalRecordType;
};

type EntryDraft = {
  date: string;
  value: string;
  secondaryValue: string;
  notes: string;
};

const EMPTY_ENTRY_DRAFT: EntryDraft = {
  date: format(new Date(), 'yyyy-MM-dd'),
  value: '',
  secondaryValue: '',
  notes: '',
};

const RECORD_TYPE_OPTIONS: Array<{
  value: PersonalRecordType;
  label: string;
  helper: string;
  icon: typeof Dumbbell;
}> = [
  { value: 'strength', label: 'Forza', helper: 'kg x reps', icon: Dumbbell },
  { value: 'distance', label: 'Distanza', helper: 'km', icon: Ruler },
  { value: 'duration', label: 'Durata', helper: 'minuti', icon: Clock3 },
  { value: 'count', label: 'Conteggio', helper: 'reps / volte', icon: Hash },
  { value: 'calories', label: 'Calorie', helper: 'kcal', icon: Flame },
];

function getRecordIcon(recordType: PersonalRecordType) {
  return RECORD_TYPE_OPTIONS.find((option) => option.value === recordType)?.icon || Trophy;
}

function getPrimaryFieldLabel(recordType: PersonalRecordType) {
  switch (recordType) {
    case 'strength':
      return 'Carico';
    case 'distance':
      return 'Distanza';
    case 'duration':
      return 'Durata';
    case 'calories':
      return 'Calorie';
    case 'count':
    default:
      return 'Valore';
  }
}

function getPrimaryFieldPlaceholder(recordType: PersonalRecordType) {
  switch (recordType) {
    case 'strength':
      return 'Kg usati';
    case 'distance':
      return 'Km totali';
    case 'duration':
      return 'Minuti';
    case 'calories':
      return 'Kcal';
    case 'count':
    default:
      return 'Numero';
  }
}

function createEmptyRecordDraft(): RecordDraft {
  return {
    exerciseName: '',
    recordType: 'strength',
  };
}

function normalizeEntry(record: PersonalRecord, draft: EntryDraft): RecordEntry {
  const parsedValue = Number(draft.value);
  const parsedSecondaryValue = Number(draft.secondaryValue);
  const safePrimaryValue = Number.isFinite(parsedValue) ? parsedValue : 0;
  const safeSecondaryValue = Number.isFinite(parsedSecondaryValue) ? parsedSecondaryValue : 0;

  return {
    id: createAppUuid(),
    date: draft.date,
    value: safePrimaryValue,
    unit: record.unit || getDefaultUnitForRecordType(record.recordType),
    secondaryValue: record.recordType === 'strength' ? safeSecondaryValue : undefined,
    secondaryUnit: getSecondaryUnitForRecordType(record.recordType) || undefined,
    notes: draft.notes.trim() || undefined,
    weight: record.recordType === 'strength' ? safePrimaryValue : undefined,
    reps: record.recordType === 'strength' ? safeSecondaryValue : undefined,
  };
}

export default function Records() {
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [isAddingRecord, setIsAddingRecord] = useState(false);
  const [recordDraft, setRecordDraft] = useState<RecordDraft>(createEmptyRecordDraft());
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(EMPTY_ENTRY_DRAFT);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDerivedExpanded, setIsDerivedExpanded] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        setIsLoading(true);
        const remoteRecords = await loadRecordsFromSupabase();
        if (!isMounted) {
          return;
        }

        setRecords(remoteRecords);
        setSyncError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setSyncError(getErrorMessage(error, 'Sync record personali non riuscita.'));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    hydrate();

    return () => {
      isMounted = false;
    };
  }, []);

  const persistRecords = async (nextRecords: PersonalRecord[]) => {
    const previousRecords = records;
    setRecords(nextRecords);
    setIsSaving(true);
    try {
      await saveRecordsToSupabase(nextRecords);
      setSyncError(null);
    } catch (error) {
      setRecords(previousRecords);
      setSyncError(getErrorMessage(error, 'Salvataggio record personali non riuscito.'));
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRecord = async () => {
    if (!recordDraft.exerciseName.trim()) {
      return;
    }

    const nextRecord: PersonalRecord = {
      id: createAppUuid(),
      exerciseName: recordDraft.exerciseName.trim(),
      recordType: recordDraft.recordType,
      unit: getDefaultUnitForRecordType(recordDraft.recordType),
      entries: [],
    };

    try {
      await persistRecords([...records, nextRecord]);
      setRecordDraft(createEmptyRecordDraft());
      setIsAddingRecord(false);
    } catch (error) {
      console.error('Record creation error:', error);
    }
  };

  const handleDeleteRecord = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm('Sei sicuro di voler eliminare questo record e tutto il suo storico?')) {
      return;
    }

    try {
      const nextRecords = records.filter((record) => record.id !== id);
      await persistRecords(nextRecords);
      if (selectedRecordId === id) {
        setSelectedRecordId(null);
      }
    } catch (error) {
      console.error('Record delete error:', error);
    }
  };

  const selectedRecord = records.find((record) => record.id === selectedRecordId) || null;

  const handleAddEntry = async () => {
    if (!selectedRecord) {
      return;
    }

    const hasPrimaryValue = Number(entryDraft.value) > 0;
    const hasSecondaryValue = selectedRecord.recordType === 'strength' ? Number(entryDraft.secondaryValue) > 0 : true;
    if (!hasPrimaryValue || !hasSecondaryValue) {
      if (selectedRecord.recordType === 'strength' && !hasPrimaryValue && !hasSecondaryValue) {
        return;
      }

      if (selectedRecord.recordType !== 'strength' && !hasPrimaryValue) {
        return;
      }

      if (selectedRecord.recordType === 'strength' && !hasPrimaryValue && hasSecondaryValue) {
        const repsOnlyEntry = normalizeEntry(selectedRecord, {
          ...entryDraft,
          value: '0',
        });
        const nextRecords = records.map((record) => {
          if (record.id !== selectedRecord.id) {
            return record;
          }

          return {
            ...record,
            entries: [...record.entries, repsOnlyEntry].sort((left, right) => left.date.localeCompare(right.date)),
          };
        });

        try {
          await persistRecords(nextRecords);
          setEntryDraft({
            ...EMPTY_ENTRY_DRAFT,
            date: format(new Date(), 'yyyy-MM-dd'),
          });
        } catch (error) {
          console.error('Entry creation error:', error);
        }
      }

      return;
    }

    const nextEntry = normalizeEntry(selectedRecord, entryDraft);
    const nextRecords = records.map((record) => {
      if (record.id !== selectedRecord.id) {
        return record;
      }

      return {
        ...record,
        entries: [...record.entries, nextEntry].sort((left, right) => left.date.localeCompare(right.date)),
      };
    });

    try {
      await persistRecords(nextRecords);
      setEntryDraft({
        ...EMPTY_ENTRY_DRAFT,
        date: format(new Date(), 'yyyy-MM-dd'),
      });
    } catch (error) {
      console.error('Entry creation error:', error);
    }
  };

  const handleDeleteEntry = async (recordId: string, entryId: string) => {
    if (!confirm('Vuoi eliminare questa prestazione dal record personale?')) {
      return;
    }

    const nextRecords = records.map((record) => {
      if (record.id !== recordId) {
        return record;
      }

      return {
        ...record,
        entries: record.entries.filter((entry) => entry.id !== entryId),
      };
    });

    try {
      await persistRecords(nextRecords);
    } catch (error) {
      console.error('Entry delete error:', error);
    }
  };

  const chartData = useMemo(() => {
    if (!selectedRecord) {
      return [];
    }

    return selectedRecord.entries.map((entry) => ({
      date: format(new Date(entry.date), 'dd/MM'),
      fullDate: entry.date,
      score: getRecordChartScore(entry, selectedRecord),
      label: formatRecordValue(entry, selectedRecord),
      entry,
    }));
  }, [selectedRecord]);

  const derivedWorkoutRecords = useMemo(() => deriveWorkoutRecordCandidates(getStoredWorkouts()), [records]);

  const saveDerivedWorkoutRecord = async (recordKey: string) => {
    const derivedRecord = derivedWorkoutRecords.find((item) => item.key === recordKey);
    if (!derivedRecord) {
      return;
    }

    const nextRecords = [...records];
    let targetRecord = nextRecords.find((record) => record.exerciseName === derivedRecord.label && record.recordType === derivedRecord.recordType);

    if (!targetRecord) {
      targetRecord = {
        id: createAppUuid(),
        exerciseName: derivedRecord.label,
        recordType: derivedRecord.recordType,
        unit: derivedRecord.unit,
        entries: [],
      };
      nextRecords.push(targetRecord);
    }

    if (!targetRecord.entries.some((entry) => entry.date === derivedRecord.workout.date && entry.value === derivedRecord.value)) {
      targetRecord.entries.push({
        id: createAppUuid(),
        date: derivedRecord.workout.date,
        value: derivedRecord.value,
        unit: derivedRecord.unit,
        notes: derivedRecord.workout.title || derivedRecord.workout.sourceSportLabel || undefined,
      });
      targetRecord.entries.sort((left, right) => left.date.localeCompare(right.date));
    }

    try {
      await persistRecords(nextRecords);
    } catch (error) {
      console.error('Derived record save error:', error);
    }
  };

  let trendPercentage = 0;
  if (chartData.length >= 2) {
    const currentScore = chartData[chartData.length - 1].score;
    const previousScore = chartData[chartData.length - 2].score;
    if (previousScore > 0) {
      trendPercentage = ((currentScore - previousScore) / previousScore) * 100;
    }
  }

  if (selectedRecord) {
    const RecordIcon = getRecordIcon(selectedRecord.recordType);

    return (
      <div className="flex-1 overflow-y-auto bg-zinc-950 p-8">
        <div className="mx-auto max-w-4xl">
          <button
            onClick={() => setSelectedRecordId(null)}
            className="mb-6 flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Torna ai Record
          </button>

          {syncError && (
            <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {syncError}
            </div>
          )}

          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h1 className="mb-2 flex items-center gap-3 text-3xl font-bold text-white">
                <RecordIcon className="h-8 w-8 text-amber-400" />
                {selectedRecord.exerciseName}
              </h1>
              <p className="text-zinc-400">
                {getRecordTypeLabel(selectedRecord.recordType)} · unita {selectedRecord.unit}
                {selectedRecord.entries.length > 0
                  ? ` · ultimo aggiornamento ${format(new Date(selectedRecord.entries[selectedRecord.entries.length - 1].date), 'd MMMM yyyy', { locale: it })}`
                  : ' · nessun dato registrato'}
              </p>
            </div>
            <button
              onClick={(event) => handleDeleteRecord(selectedRecord.id, event)}
              className="shrink-0 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
            >
              Elimina record
            </button>
          </div>

          {chartData.length > 0 && (
            <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="mb-6 flex items-center justify-between gap-4">
                <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                  <TrendingUp className="h-5 w-5 text-amber-400" />
                  Progressione
                </h3>
                {chartData.length >= 2 && (
                  <div className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${trendPercentage >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {trendPercentage >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {trendPercentage > 0 ? '+' : ''}{trendPercentage.toFixed(1)}% vs prec.
                  </div>
                )}
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="date" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem', color: '#fff' }}
                      labelStyle={{ color: '#a1a1aa', marginBottom: '4px' }}
                      formatter={(_value: number, _name: string, props: { payload?: { label?: string } }) => [props.payload?.label || '', 'Prestazione']}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#fbbf24"
                      strokeWidth={3}
                      dot={{ fill: '#fbbf24', strokeWidth: 2, r: 4, stroke: '#18181b' }}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="mb-8 rounded-2xl border border-amber-500/30 bg-zinc-900 p-6 shadow-xl shadow-amber-500/5">
            <h3 className="mb-4 text-lg font-bold text-white">Aggiungi prestazione</h3>
            <div className={`mb-4 grid grid-cols-1 gap-4 ${selectedRecord.recordType === 'strength' ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Data</label>
                <input
                  type="date"
                  value={entryDraft.date}
                  onChange={(event) => setEntryDraft((current) => ({ ...current, date: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">
                  {getPrimaryFieldLabel(selectedRecord.recordType)} ({selectedRecord.unit})
                </label>
                <input
                  type="number"
                  step="1"
                  value={entryDraft.value}
                  onChange={(event) => setEntryDraft((current) => ({ ...current, value: event.target.value }))}
                  placeholder={getPrimaryFieldPlaceholder(selectedRecord.recordType)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
                {selectedRecord.recordType === 'strength' && (
                  <p className="mt-1 text-xs text-zinc-500">Facoltativo per esercizi a corpo libero.</p>
                )}
              </div>
              {selectedRecord.recordType === 'strength' && (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Ripetizioni</label>
                  <input
                    type="number"
                    step="1"
                    value={entryDraft.secondaryValue}
                    onChange={(event) => setEntryDraft((current) => ({ ...current, secondaryValue: event.target.value }))}
                    placeholder="Numero reps"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Note</label>
                <input
                  type="text"
                  value={entryDraft.notes}
                  onChange={(event) => setEntryDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Facoltative"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleAddEntry}
                disabled={isSaving}
                className="rounded-lg bg-amber-500 px-6 py-2 font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Salvataggio...' : 'Salva prestazione'}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="font-bold text-white">Storico prestazioni</h3>
            </div>
            <div className="divide-y divide-zinc-800">
              {selectedRecord.entries.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">Nessuna prestazione registrata.</div>
              ) : (
                [...selectedRecord.entries].reverse().map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-zinc-800/30">
                    <div className="min-w-0 flex items-center gap-4">
                      <div className="rounded-lg bg-zinc-950 p-2 text-zinc-400">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-bold text-white">
                          {formatRecordValue(entry, selectedRecord)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {format(new Date(entry.date), 'd MMMM yyyy', { locale: it })}
                          {entry.notes ? ` · ${entry.notes}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteEntry(selectedRecord.id, entry.id)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-zinc-400 transition-colors hover:border-rose-500/40 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="text-sm">Elimina</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="mb-2 flex items-center gap-3 text-3xl font-bold text-white">
              <Trophy className="h-8 w-8 text-amber-400" />
              Record personali
            </h1>
            <p className="text-zinc-400">Traccia PR di forza, distanza, durata, calorie o altri record utili per il coach.</p>
          </div>
          <button
            onClick={() => setIsAddingRecord(true)}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 font-bold text-zinc-950 shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-400"
          >
            <Plus className="h-5 w-5" />
            Nuovo record
          </button>
        </div>

        {syncError && (
          <div className="mb-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {syncError}
          </div>
        )}

        {isAddingRecord && (
          <div className="mb-8 rounded-2xl border border-amber-500/30 bg-zinc-900 p-6 shadow-xl shadow-amber-500/5">
            <h3 className="mb-4 text-lg font-bold text-white">Aggiungi un nuovo record da tracciare</h3>
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Nome record</label>
                <input
                  type="text"
                  value={recordDraft.exerciseName}
                  onChange={(event) => setRecordDraft((current) => ({ ...current, exerciseName: event.target.value }))}
                  placeholder="Es. Panca Piana, Distanza massima sessione..."
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-zinc-500">Tipo record</label>
                <select
                  value={recordDraft.recordType}
                  onChange={(event) => setRecordDraft((current) => ({ ...current, recordType: event.target.value as PersonalRecordType }))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {RECORD_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.helper}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">
              Unita predefinita: <span className="font-semibold text-white">{getDefaultUnitForRecordType(recordDraft.recordType)}</span>
              {recordDraft.recordType === 'strength' ? ' con campo secondario reps.' : '.'}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsAddingRecord(false);
                  setRecordDraft(createEmptyRecordDraft());
                }}
                className="px-4 py-2 text-zinc-400 transition-colors hover:text-white"
              >
                Annulla
              </button>
              <button
                onClick={handleAddRecord}
                disabled={isSaving}
                className="rounded-lg bg-amber-500 px-6 py-2 font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Salvataggio...' : 'Aggiungi'}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-8 text-center text-zinc-400">
            Caricamento record da Supabase...
          </div>
        ) : (
          <>
            <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Record dagli allenamenti</h2>
                  <p className="text-sm text-zinc-400">Migliori risultati ricavati direttamente dai workout salvati.</p>
                </div>
                <button
                  onClick={() => setIsDerivedExpanded((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  {isDerivedExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {isDerivedExpanded ? 'Riduci' : 'Apri'}
                </button>
              </div>

              {!isDerivedExpanded ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-500">
                  Sezione minimizzata. Apri per vedere i record calcolati dai workout.
                </div>
              ) : derivedWorkoutRecords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-8 text-center text-sm text-zinc-500">
                  Nessun record ricavabile dagli allenamenti attuali. Servono workout con durata, calorie, BPM o tracciato.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {derivedWorkoutRecords.map((derivedRecord) => (
                    <div key={derivedRecord.key} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm uppercase tracking-wider text-zinc-500">{getRecordTypeLabel(derivedRecord.recordType)}</div>
                          <h3 className="font-semibold text-white">{derivedRecord.label}</h3>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-amber-400">{trimTrailingZeros(derivedRecord.value)}</div>
                          <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">{derivedRecord.unit}</div>
                        </div>
                      </div>
                      <div className="text-sm text-zinc-400">
                        {derivedRecord.workout.date} · {derivedRecord.workout.title || derivedRecord.workout.sourceSportLabel || derivedRecord.workout.type || 'Allenamento'}
                      </div>
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={() => saveDerivedWorkoutRecord(derivedRecord.key)}
                          disabled={isSaving || hasDerivedRecordBeenSaved(records, derivedRecord)}
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
                        >
                          {hasDerivedRecordBeenSaved(records, derivedRecord) ? 'Gia salvato' : 'Salva nei record'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {records.length === 0 && !isAddingRecord ? (
                <div className="col-span-full rounded-2xl border-2 border-dashed border-zinc-800 py-12 text-center">
                  <Trophy className="mx-auto mb-3 h-12 w-12 text-zinc-700" />
                  <p className="text-zinc-500">Nessun record tracciato per questo account.</p>
                </div>
              ) : (
                records.map((record) => {
                  const lastEntry = record.entries.length > 0 ? record.entries[record.entries.length - 1] : null;
                  const RecordIcon = getRecordIcon(record.recordType);

                  return (
                    <div
                      key={record.id}
                      onClick={() => setSelectedRecordId(record.id)}
                      className="group relative cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-amber-500/50"
                    >
                      <button
                        onClick={(event) => handleDeleteRecord(record.id, event)}
                        className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-zinc-400 transition-opacity hover:border-rose-500/40 hover:text-rose-400 md:opacity-0 md:group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="text-xs font-medium">Elimina</span>
                      </button>
                      <div className="mb-4 flex items-center gap-3">
                        <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400">
                          <RecordIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate pr-24 text-lg font-bold text-white">{record.exerciseName}</h3>
                          <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                            {getRecordTypeLabel(record.recordType)}
                          </div>
                        </div>
                      </div>

                      {lastEntry ? (
                        <div>
                          <div className="mb-1 flex items-end gap-2">
                            <span className="text-3xl font-black tracking-tight text-white">
                              {record.recordType === 'strength'
                                ? trimTrailingZeros(lastEntry.value > 0 ? lastEntry.value : lastEntry.secondaryValue || 0)
                                : trimTrailingZeros(lastEntry.value)}
                            </span>
                            <span className="mb-1 font-bold text-amber-500">
                              {record.recordType === 'strength'
                                ? lastEntry.value > 0
                                  ? `${record.unit} x ${trimTrailingZeros(lastEntry.secondaryValue || 0)} ${lastEntry.secondaryUnit || 'reps'}`
                                  : (lastEntry.secondaryUnit || 'reps')
                                : record.unit}
                            </span>
                          </div>
                          <div className="text-xs font-medium text-zinc-500">
                            Ultimo: {format(new Date(lastEntry.date), 'd MMM yyyy', { locale: it })}
                          </div>
                        </div>
                      ) : (
                        <div className="py-2 text-sm italic text-zinc-500">
                          Nessun dato registrato
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
