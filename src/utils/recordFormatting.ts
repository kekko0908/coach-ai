import { PersonalRecord, PersonalRecordType, RecordEntry } from '../types';

export function getDefaultUnitForRecordType(recordType: PersonalRecordType) {
  switch (recordType) {
    case 'strength':
      return 'kg';
    case 'distance':
      return 'km';
    case 'duration':
      return 'min';
    case 'calories':
      return 'kcal';
    case 'count':
    default:
      return 'reps';
  }
}

export function getSecondaryUnitForRecordType(recordType: PersonalRecordType) {
  switch (recordType) {
    case 'strength':
      return 'reps';
    default:
      return null;
  }
}

export function getRecordTypeLabel(recordType: PersonalRecordType) {
  switch (recordType) {
    case 'strength':
      return 'Forza';
    case 'distance':
      return 'Distanza';
    case 'duration':
      return 'Durata';
    case 'calories':
      return 'Calorie';
    case 'count':
    default:
      return 'Conteggio';
  }
}

export function formatRecordValue(entry: RecordEntry, record?: Pick<PersonalRecord, 'recordType' | 'unit'>) {
  const recordType = record?.recordType || 'strength';
  const unit = entry.unit || record?.unit || getDefaultUnitForRecordType(recordType);

  if (recordType === 'strength') {
    const weight = entry.value ?? entry.weight ?? 0;
    const reps = entry.secondaryValue ?? entry.reps ?? 0;
    if (weight > 0) {
      return `${trimTrailingZeros(weight)} ${unit} x ${trimTrailingZeros(reps)} ${entry.secondaryUnit || getSecondaryUnitForRecordType(recordType) || 'reps'}`;
    }
    return `${trimTrailingZeros(reps)} ${entry.secondaryUnit || 'reps'}`;
  }

  return `${trimTrailingZeros(entry.value)} ${unit}`;
}

export function getRecordChartScore(entry: RecordEntry, record: Pick<PersonalRecord, 'recordType'>) {
  if (record.recordType === 'strength') {
    const weight = entry.value ?? entry.weight ?? 0;
    const reps = entry.secondaryValue ?? entry.reps ?? 0;
    if (weight > 0) {
      return Math.round(weight * (1 + reps / 30));
    }

    return reps;
  }

  return entry.value;
}

export function trimTrailingZeros(value: number) {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(2).replace(/\.?0+$/, '');
}
