import { HealthData, PersonalRecord, UserProfile, Workout } from '../types';
import { CoachMemory } from '../types/coach';

type AppDataSnapshot = {
  profile: UserProfile | null;
  coachMemory: CoachMemory | null;
  workouts: Workout[];
  healthData: HealthData | null;
  records: PersonalRecord[];
  thinkerModeEnabled: boolean;
};

const snapshot: AppDataSnapshot = {
  profile: null,
  coachMemory: null,
  workouts: [],
  healthData: null,
  records: [],
  thinkerModeEnabled: false,
};

export function setStoredProfile(profile: UserProfile | null) {
  snapshot.profile = profile;
}

export function getStoredProfile() {
  return snapshot.profile;
}

export function setStoredCoachMemory(memory: CoachMemory | null) {
  snapshot.coachMemory = memory;
}

export function getStoredCoachMemory() {
  return snapshot.coachMemory;
}

export function setStoredWorkouts(workouts: Workout[]) {
  snapshot.workouts = workouts;
}

export function getStoredWorkouts() {
  return snapshot.workouts;
}

export function setStoredHealthData(healthData: HealthData | null) {
  snapshot.healthData = healthData;
}

export function getStoredHealthData() {
  return snapshot.healthData;
}

export function setStoredRecords(records: PersonalRecord[]) {
  snapshot.records = records;
}

export function getStoredRecords() {
  return snapshot.records;
}

export function setStoredThinkerModeEnabled(value: boolean) {
  snapshot.thinkerModeEnabled = value;
}

export function getStoredThinkerModeEnabled() {
  return snapshot.thinkerModeEnabled;
}
