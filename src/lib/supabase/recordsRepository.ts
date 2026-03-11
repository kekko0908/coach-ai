import { PersonalRecord, PersonalRecordType, RecordEntry } from '../../types';
import { setStoredRecords } from '../appDataStore';
import { getDefaultUnitForRecordType, getSecondaryUnitForRecordType } from '../../utils/recordFormatting';
import { deriveWorkoutRecordCandidates } from '../../utils/workoutRecords';
import { createDeterministicUuid } from '../../utils/uuid';
import { requireUserId } from './auth';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase';
import { ensureProfileExists } from './profileRepository';

type RecordRow = {
  id: string;
  exercise_name: string;
  record_type: PersonalRecordType | null;
  unit: string | null;
};

type RecordEntryRow = {
  id: string;
  personal_record_id: string;
  entry_date: string;
  value_numeric: number | null;
  unit: string | null;
  secondary_value_numeric: number | null;
  secondary_unit: string | null;
  notes: string | null;
  weight_kg: number | null;
  reps: number | null;
};

function mapRecordEntry(row: RecordEntryRow, record: RecordRow): RecordEntry {
  const recordType = record.record_type || 'strength';
  const unit = row.unit || record.unit || getDefaultUnitForRecordType(recordType);
  const secondaryUnit = row.secondary_unit || getSecondaryUnitForRecordType(recordType) || undefined;
  const value = row.value_numeric ?? row.weight_kg ?? 0;
  const secondaryValue = row.secondary_value_numeric ?? row.reps ?? undefined;

  return {
    id: row.id,
    date: row.entry_date,
    value,
    unit,
    secondaryValue: secondaryValue ?? undefined,
    secondaryUnit,
    notes: row.notes || undefined,
    weight: recordType === 'strength' ? value : undefined,
    reps: recordType === 'strength' ? secondaryValue ?? 0 : undefined,
  };
}

function mapPersonalRecord(row: RecordRow, entries: RecordEntry[]): PersonalRecord {
  const recordType = row.record_type || 'strength';
  return {
    id: row.id,
    exerciseName: row.exercise_name,
    recordType,
    unit: row.unit || getDefaultUnitForRecordType(recordType),
    entries: entries.sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function buildRecordRows(records: PersonalRecord[], userId: string) {
  return records.map((record) => ({
    id: record.id,
    user_id: userId,
    exercise_name: record.exerciseName,
    record_type: record.recordType,
    unit: record.unit || getDefaultUnitForRecordType(record.recordType),
  }));
}

function buildRecordEntryRows(records: PersonalRecord[], userId: string) {
  return records.flatMap((record) =>
    record.entries.map((entry) => ({
      id: entry.id,
      user_id: userId,
      personal_record_id: record.id,
      entry_date: entry.date,
      value_numeric: entry.value,
      unit: entry.unit || record.unit || getDefaultUnitForRecordType(record.recordType),
      secondary_value_numeric: entry.secondaryValue ?? null,
      secondary_unit: entry.secondaryUnit || getSecondaryUnitForRecordType(record.recordType),
      notes: entry.notes || null,
      weight_kg: record.recordType === 'strength' ? entry.value : 0,
      reps: record.recordType === 'strength' ? entry.secondaryValue ?? 0 : 0,
    })),
  );
}

export async function loadRecordsFromSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const [{ data: recordRows, error: recordsError }, { data: entryRows, error: entriesError }] = await Promise.all([
    supabase.from('personal_records').select('id,exercise_name,record_type,unit').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('personal_record_entries').select('id,personal_record_id,entry_date,value_numeric,unit,secondary_value_numeric,secondary_unit,notes,weight_kg,reps').eq('user_id', userId).order('entry_date', { ascending: true }),
  ]);

  if (recordsError || entriesError) {
    throw recordsError || entriesError;
  }

  const entriesByRecordId = new Map<string, RecordEntry[]>();
  (entryRows || []).forEach((row) => {
    const recordRow = (recordRows || []).find((candidate) => candidate.id === row.personal_record_id) as RecordRow | undefined;
    if (!recordRow) {
      return;
    }

    const items = entriesByRecordId.get(row.personal_record_id) || [];
    items.push(mapRecordEntry(row as RecordEntryRow, recordRow));
    entriesByRecordId.set(row.personal_record_id, items);
  });

  const records = ((recordRows || []) as RecordRow[]).map((row) =>
    mapPersonalRecord(row, entriesByRecordId.get(row.id) || []),
  );

  setStoredRecords(records);
  return records;
}

export async function hydrateRecordsFromSupabase() {
  return loadRecordsFromSupabase();
}

export async function saveRecordsToSupabase(records: PersonalRecord[]) {
  setStoredRecords(records);

  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const recordRows = buildRecordRows(records, userId);
  const entryRows = buildRecordEntryRows(records, userId);
  const recordIds = records.map((record) => record.id);

  if (recordIds.length === 0) {
    const { error } = await supabase.from('personal_records').delete().eq('user_id', userId);
    if (error) {
      throw error;
    }
    return;
  }

  const { error: upsertRecordsError } = await supabase
    .from('personal_records')
    .upsert(recordRows, { onConflict: 'id' });

  if (upsertRecordsError) {
    throw upsertRecordsError;
  }

  const { error: deleteRemovedError } = await supabase
    .from('personal_records')
    .delete()
    .eq('user_id', userId)
    .not('id', 'in', `(${recordIds.map((id) => `"${id}"`).join(',')})`);

  if (deleteRemovedError) {
    throw deleteRemovedError;
  }

  const { error: deleteEntriesError } = await supabase
    .from('personal_record_entries')
    .delete()
    .eq('user_id', userId)
    .in('personal_record_id', recordIds);

  if (deleteEntriesError) {
    throw deleteEntriesError;
  }

  if (entryRows.length > 0) {
    const { error: insertEntriesError } = await supabase
      .from('personal_record_entries')
      .insert(entryRows);

    if (insertEntriesError) {
      throw insertEntriesError;
    }
  }
}

export function mergeDerivedWorkoutRecords(records: PersonalRecord[], workouts: import('../../types').Workout[]) {
  const derivedRecords = deriveWorkoutRecordCandidates(workouts);
  const derivedKeys = new Set(derivedRecords.map((record) => `${record.label}:${record.recordType}`));

  const preservedRecords = records.filter((record) => !derivedKeys.has(`${record.exerciseName}:${record.recordType}`));
  const nextDerivedRecords: PersonalRecord[] = derivedRecords.map((derivedRecord) => ({
    id: createDeterministicUuid(`derived-record:${derivedRecord.key}`),
    exerciseName: derivedRecord.label,
    recordType: derivedRecord.recordType,
    unit: derivedRecord.unit,
    entries: [
      {
        id: createDeterministicUuid(`derived-record-entry:${derivedRecord.key}:${derivedRecord.workout.id}`),
        date: derivedRecord.workout.date,
        value: derivedRecord.value,
        unit: derivedRecord.unit,
        notes: derivedRecord.workout.title || derivedRecord.workout.sourceSportLabel || derivedRecord.notes || undefined,
      },
    ],
  }));

  return [...preservedRecords, ...nextDerivedRecords];
}

export async function syncDerivedWorkoutRecordsToSupabase(workouts: import('../../types').Workout[]) {
  const records = await loadRecordsFromSupabase();
  const mergedRecords = mergeDerivedWorkoutRecords(records, workouts);
  await saveRecordsToSupabase(mergedRecords);
  return mergedRecords;
}
