export interface HealthData {
  bpm: number;
  sleep: {
    deep: number;
    core: number;
    rem: number;
    total: number;
    awake?: number;
    start?: string;
    stop?: string;
    efficiency?: number;
  };
  steps: number;
  hrv: number;
  calories: number;
  trends: {
    sleep: { date: string; value: number }[];
    steps: { date: string; value: number }[];
    bpm?: { date: string; value: number }[];
    calories?: { date: string; value: number }[];
  };
  details?: {
    latestDate?: string;
    sleepStages?: {
      stage: 'deep' | 'core' | 'rem' | 'awake';
      label: string;
      minutes: number;
      hours: number;
    }[];
    sleepTimeline?: {
      time: string;
      stage: string;
      stageValue: number;
      heartRate: number | null;
      respiratoryRate: number | null;
    }[];
    heartRateSeries?: { time: string; value: number }[];
    stepsByHour?: { hour: string; value: number }[];
  };
  meta?: {
    source: 'json' | 'csv-folder';
    importedAt: string;
    coveredDays?: number;
    hrvAvailable?: boolean;
    notes?: string[];
  };
}

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  rest: number;
  weight: number;
}

export type WorkoutType = 'workout' | 'running' | 'football' | 'cycling' | 'other';
export type WorkoutSourceKind = 'manual' | 'imported';

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD
  title?: string;
  type?: WorkoutType;
  sourceKind?: WorkoutSourceKind;
  isCompleted?: boolean;
  completedAt?: string;
  sourceSportCode?: number;
  sourceSportLabel?: string;
  exercises: Exercise[];
  durationMinutes?: number;
  caloriesBurned?: number;
  averageHeartRate?: number;
  gpxData?: string; // Raw GPX XML string
  tcxData?: string; // Raw TCX XML string
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HeartRateZoneConfig {
  zone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  label: string;
  min: number;
  max: number;
  color: string;
}

export interface UserProfile {
  name: string;
  weight: number;
  heartRateMax: number;
  heartRateZones: HeartRateZoneConfig[];
  targetSteps: number;
  targetSleep: number;
  trainingDays: number;
  preferredSplit: string;
  activeDays: string[];
  weeklySchedule: {
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  };
}

export interface RecordEntry {
  id: string;
  date: string;
  value: number;
  unit: string;
  secondaryValue?: number;
  secondaryUnit?: string;
  notes?: string;
  weight?: number;
  reps?: number;
}

export type PersonalRecordType = 'strength' | 'distance' | 'duration' | 'count' | 'calories';

export interface PersonalRecord {
  id: string;
  exerciseName: string;
  recordType: PersonalRecordType;
  unit: string;
  entries: RecordEntry[];
}
