import { UserProfile } from '../types';
import { CoachMainSport, CoachMemory, CoachPrimaryGoal } from '../types/coach';
import { getStoredCoachMemory, setStoredCoachMemory } from '../lib/appDataStore';

const DEFAULT_COACH_MEMORY: CoachMemory = {
  primaryGoal: 'performance',
  mainSport: 'hybrid',
  availableEquipment: [],
  limitations: [],
  injuries: [],
  preferences: [],
  coachNotes: [],
  updatedAt: new Date(0).toISOString(),
};

function inferPrimaryGoal(profile: UserProfile): CoachPrimaryGoal {
  const split = profile.preferredSplit.toLowerCase();

  if (split.includes('strength') || split.includes('forza')) {
    return 'strength';
  }
  if (split.includes('hypertrophy') || split.includes('massa') || split.includes('ppl')) {
    return 'hypertrophy';
  }

  return 'performance';
}

function inferMainSport(profile: UserProfile): CoachMainSport {
  const split = profile.preferredSplit.toLowerCase();
  const weeklySchedule = Object.values(profile.weeklySchedule).flat().map((entry) => entry.toLowerCase());

  if (weeklySchedule.includes('sport') || split.includes('football') || split.includes('calcio')) {
    return 'football';
  }
  if (split.includes('running') || split.includes('corsa')) {
    return 'running';
  }
  if (split.includes('cycling') || split.includes('bike')) {
    return 'cycling';
  }
  if (split.includes('upper') || split.includes('push') || split.includes('pull') || split.includes('legs')) {
    return 'gym';
  }

  return 'hybrid';
}

export function getDefaultCoachMemory(): CoachMemory {
  return {
    ...DEFAULT_COACH_MEMORY,
    updatedAt: new Date().toISOString(),
  };
}

export function readCoachMemory() {
  const storedMemory = getStoredCoachMemory();
  return {
    ...getDefaultCoachMemory(),
    ...storedMemory,
    availableEquipment: storedMemory?.availableEquipment || [],
    limitations: storedMemory?.limitations || [],
    injuries: storedMemory?.injuries || [],
    preferences: storedMemory?.preferences || [],
    coachNotes: storedMemory?.coachNotes || [],
  };
}

export function saveCoachMemory(memory: CoachMemory) {
  setStoredCoachMemory({
    ...getDefaultCoachMemory(),
    ...memory,
    availableEquipment: memory.availableEquipment || [],
    limitations: memory.limitations || [],
    injuries: memory.injuries || [],
    preferences: memory.preferences || [],
    coachNotes: memory.coachNotes || [],
    updatedAt: new Date().toISOString(),
  });
}

export function syncCoachMemoryFromProfile(profile: UserProfile) {
  const hasStoredMemory = Boolean(getStoredCoachMemory());
  const existingMemory = readCoachMemory();

  const nextMemory: CoachMemory = {
    ...existingMemory,
    primaryGoal: hasStoredMemory ? existingMemory.primaryGoal : inferPrimaryGoal(profile),
    mainSport: hasStoredMemory ? existingMemory.mainSport : inferMainSport(profile),
    preferences: Array.from(new Set([
      ...existingMemory.preferences,
      profile.preferredSplit,
      `${profile.trainingDays} giorni/settimana`,
    ])).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };

  saveCoachMemory(nextMemory);
  return nextMemory;
}
