import { HealthData, Workout } from '../types';
import { resolveExternalSportType } from './externalSportTypes';
import { createDeterministicUuid } from './uuid';

type CsvRow = Record<string, string>;

function parseCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [] as CsvRow[];
  }

  const headers = lines[0].split(',').map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index]?.trim() || '';
      return row;
    }, {});
  });
}

function toNumber(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatChartDate(date: string) {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) {
    return date;
  }

  return `${day}/${month}`;
}

function compareIsoDate(left: string, right: string) {
  return left.localeCompare(right);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeSleepStage(stage: string) {
  const normalized = stage.toUpperCase();
  if (normalized === 'DEEP') return { key: 'deep' as const, label: 'Profondo', value: 3 };
  if (normalized === 'REM') return { key: 'rem' as const, label: 'REM', value: 4 };
  if (normalized === 'AWAKE' || normalized === 'WAKE') return { key: 'awake' as const, label: 'Sveglio', value: 1 };
  return { key: 'core' as const, label: 'Leggero', value: 2 };
}

function getRelativePath(file: File) {
  const path = file.webkitRelativePath || file.name;
  return path.replace(/\\/g, '/');
}

function findFile(files: File[], pattern: RegExp) {
  const directMatch = files.find((file) => pattern.test(getRelativePath(file)));
  if (directMatch) {
    return directMatch;
  }

  return files.find((file) => pattern.test(file.name));
}

export async function importHealthDataFromCsvFolder(files: File[]): Promise<HealthData> {
  const sleepFile = findFile(files, /((^|\/)SLEEP\/.+\.csv$)|(^SLEEP_.+\.csv$)/i);
  const sleepMinuteFile = findFile(files, /((^|\/)SLEEP_MINUTE\/.+\.csv$)|(^SLEEP_MINUTE_.+\.csv$)/i);
  const heartRateFile = findFile(files, /((^|\/)HEARTRATE_AUTO\/.+\.csv$)|(^HEARTRATE_AUTO_.+\.csv$)/i);
  const activityFile = findFile(files, /((^|\/)ACTIVITY\/.+\.csv$)|(^ACTIVITY_.+\.csv$)/i);
  const activityMinuteFile = findFile(files, /((^|\/)ACTIVITY_MINUTE\/.+\.csv$)|(^ACTIVITY_MINUTE_.+\.csv$)/i);

  if (!sleepFile || !heartRateFile || !activityFile) {
    throw new Error('Cartella incompleta. Servono almeno SLEEP, HEARTRATE_AUTO e ACTIVITY.');
  }

  const [sleepText, sleepMinuteText, heartRateText, activityText, activityMinuteText] = await Promise.all([
    sleepFile.text(),
    sleepMinuteFile?.text() || Promise.resolve(''),
    heartRateFile.text(),
    activityFile.text(),
    activityMinuteFile?.text() || Promise.resolve(''),
  ]);

  const sleepRows = parseCsv(sleepText).sort((left, right) => compareIsoDate(left.date, right.date));
  const sleepMinuteRows = parseCsv(sleepMinuteText);
  const heartRateRows = parseCsv(heartRateText).sort((left, right) => {
    const byDate = compareIsoDate(left.date, right.date);
    if (byDate !== 0) return byDate;
    return left.time.localeCompare(right.time);
  });
  const activityRows = parseCsv(activityText).sort((left, right) => compareIsoDate(left.date, right.date));
  const activityMinuteRows = parseCsv(activityMinuteText).sort((left, right) => {
    const byDate = compareIsoDate(left.date, right.date);
    if (byDate !== 0) return byDate;
    return left.time.localeCompare(right.time);
  });

  const sleepTrend = sleepRows.map((row) => {
    const totalHours = roundToOneDecimal((toNumber(row.deepSleepTime) + toNumber(row.shallowSleepTime) + toNumber(row.REMTime)) / 60);
    return {
      date: formatChartDate(row.date),
      value: totalHours,
    };
  });

  const stepsTrend = activityRows.map((row) => ({
    date: formatChartDate(row.date),
    value: toNumber(row.steps),
  }));

  const caloriesTrend = activityRows.map((row) => ({
    date: formatChartDate(row.date),
    value: toNumber(row.calories),
  }));

  const dailyHeartRateMap = heartRateRows.reduce<Record<string, number[]>>((map, row) => {
    if (!row.date) return map;
    if (!map[row.date]) {
      map[row.date] = [];
    }
    map[row.date].push(toNumber(row.heartRate));
    return map;
  }, {});

  const bpmTrend = Object.entries(dailyHeartRateMap)
    .sort(([left], [right]) => compareIsoDate(left, right))
    .map(([date, values]) => ({
      date: formatChartDate(date),
      value: Math.round(average(values)),
    }));

  const latestSleepRow = sleepRows[sleepRows.length - 1];
  const latestActivityRow = activityRows[activityRows.length - 1];
  const latestHeartRateDate = heartRateRows[heartRateRows.length - 1]?.date || latestSleepRow?.date || latestActivityRow?.date || '';
  const latestSleepDate = latestSleepRow?.date || '';
  const latestActivityDate = latestActivityRow?.date || '';

  const latestSleepTimeline = sleepMinuteRows
    .filter((row) => row.date === latestSleepDate)
    .sort((left, right) => left.time.localeCompare(right.time))
    .map((row) => {
      const stage = normalizeSleepStage(row.stage);
      return {
        time: row.time,
        stage: stage.label,
        stageValue: stage.value,
        heartRate: row.hr ? toNumber(row.hr) : null,
        respiratoryRate: row.respiratory_rate ? toNumber(row.respiratory_rate) : null,
      };
    });

  const timelineStageMinutes = sleepMinuteRows
    .filter((row) => row.date === latestSleepDate)
    .reduce<Record<'deep' | 'core' | 'rem' | 'awake', number>>(
      (accumulator, row) => {
        const normalized = normalizeSleepStage(row.stage);
        accumulator[normalized.key] += 1;
        return accumulator;
      },
      {
        deep: 0,
        core: 0,
        rem: 0,
        awake: 0,
      },
    );

  const sleepStages = latestSleepRow
    ? [
        {
          stage: 'deep' as const,
          label: 'Profondo',
          minutes: Math.max(timelineStageMinutes.deep, toNumber(latestSleepRow.deepSleepTime)),
          hours: roundToOneDecimal(Math.max(timelineStageMinutes.deep, toNumber(latestSleepRow.deepSleepTime)) / 60),
        },
        {
          stage: 'core' as const,
          label: 'Leggero',
          minutes: Math.max(timelineStageMinutes.core, toNumber(latestSleepRow.shallowSleepTime)),
          hours: roundToOneDecimal(Math.max(timelineStageMinutes.core, toNumber(latestSleepRow.shallowSleepTime)) / 60),
        },
        {
          stage: 'rem' as const,
          label: 'REM',
          minutes: Math.max(timelineStageMinutes.rem, toNumber(latestSleepRow.REMTime)),
          hours: roundToOneDecimal(Math.max(timelineStageMinutes.rem, toNumber(latestSleepRow.REMTime)) / 60),
        },
        {
          stage: 'awake' as const,
          label: 'Sveglio',
          minutes: Math.max(timelineStageMinutes.awake, toNumber(latestSleepRow.wakeTime)),
          hours: roundToOneDecimal(Math.max(timelineStageMinutes.awake, toNumber(latestSleepRow.wakeTime)) / 60),
        },
      ]
    : [];

  const latestSleepHrValues = latestSleepTimeline
    .map((point) => point.heartRate)
    .filter((value): value is number => value !== null);

  const latestHeartRateSeries = heartRateRows
    .filter((row) => row.date === latestHeartRateDate)
    .map((row) => ({
      time: row.time,
      value: toNumber(row.heartRate),
    }));

  const hourlyStepsMap = activityMinuteRows
    .filter((row) => row.date === latestActivityDate)
    .reduce<Record<string, number>>((map, row) => {
      const hour = `${row.time.slice(0, 2)}:00`;
      map[hour] = (map[hour] || 0) + toNumber(row.steps);
      return map;
    }, {});

  const stepsByHour = Object.entries(hourlyStepsMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, value]) => ({
      hour,
      value,
    }));

  const latestSleepDeep = roundToOneDecimal(toNumber(latestSleepRow?.deepSleepTime) / 60);
  const latestSleepCore = roundToOneDecimal(toNumber(latestSleepRow?.shallowSleepTime) / 60);
  const latestSleepRem = roundToOneDecimal(toNumber(latestSleepRow?.REMTime) / 60);
  const latestSleepAwake = roundToOneDecimal(toNumber(latestSleepRow?.wakeTime) / 60);
  const latestSleepTotal = roundToOneDecimal(latestSleepDeep + latestSleepCore + latestSleepRem);
  const latestSleepEfficiency = latestSleepTotal + latestSleepAwake > 0
    ? Math.round((latestSleepTotal / (latestSleepTotal + latestSleepAwake)) * 100)
    : undefined;

  return {
    bpm: latestSleepHrValues.length > 0
      ? Math.round(average(latestSleepHrValues))
      : Math.round(average(latestHeartRateSeries.map((point) => point.value))),
    sleep: {
      deep: latestSleepDeep,
      core: latestSleepCore,
      rem: latestSleepRem,
      total: latestSleepTotal,
      awake: latestSleepAwake,
      start: latestSleepRow?.start || undefined,
      stop: latestSleepRow?.stop || undefined,
      efficiency: latestSleepEfficiency,
    },
    steps: toNumber(latestActivityRow?.steps),
    hrv: 0,
    calories: toNumber(latestActivityRow?.calories),
    trends: {
      sleep: sleepTrend,
      steps: stepsTrend,
      bpm: bpmTrend,
      calories: caloriesTrend,
    },
    details: {
      latestDate: latestActivityDate || latestSleepDate || latestHeartRateDate,
      sleepStages,
      sleepTimeline: latestSleepTimeline,
      heartRateSeries: latestHeartRateSeries,
      stepsByHour,
    },
    meta: {
      source: 'csv-folder',
      importedAt: new Date().toISOString(),
      coveredDays: Math.max(sleepRows.length, activityRows.length, Object.keys(dailyHeartRateMap).length),
      hrvAvailable: false,
      notes: ['HRV non presente nel pacchetto CSV: il sistema usa un readiness lite basato su sonno, efficienza, BPM e carico recente.'],
    },
  };
}

function buildWorkoutId(code: number, startTime: string) {
  return createDeterministicUuid(`sport:${code}:${startTime}`);
}

function extractWorkoutDate(startTime: string) {
  const isoDate = startTime.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : new Date(startTime).toISOString().slice(0, 10);
}

export async function importWorkoutsFromCsvFolder(files: File[]): Promise<Workout[]> {
  const sportFile = findFile(files, /((^|\/)SPORT\/.+\.csv$)|(^SPORT_.+\.csv$)/i);
  if (!sportFile) {
    return [];
  }

  const sportRows = parseCsv(await sportFile.text())
    .filter((row) => row.startTime)
    .sort((left, right) => right.startTime.localeCompare(left.startTime));

  return sportRows.map((row) => {
    const code = toNumber(row.type);
    const meta = resolveExternalSportType(code);
    const durationMinutes = Math.max(1, Math.round(toNumber(row['sportTime(s)']) / 60));
    const caloriesBurned = Math.round(toNumber(row['calories(kcal)']));
    const title = meta.label;

    return {
      id: buildWorkoutId(code, row.startTime),
      date: extractWorkoutDate(row.startTime),
      type: meta.workoutType,
      title,
      sourceSportCode: code,
      sourceSportLabel: meta.label,
      exercises: [],
      durationMinutes,
      caloriesBurned: caloriesBurned > 0 ? caloriesBurned : undefined,
    };
  });
}
