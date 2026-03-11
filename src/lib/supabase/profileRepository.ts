import { UserProfile } from '../../types';
import { CoachMemory } from '../../types/coach';
import { normalizeHeartRateZones } from '../../utils/heartRateZones';
import { setStoredCoachMemory, setStoredProfile } from '../appDataStore';
import { requireUserId } from './auth';
import { getSupabaseClient, isSupabaseConfigured } from '../supabase';

type ProfileRow = {
  id: string;
  name: string;
  weight_kg: number | null;
  heart_rate_max: number | null;
  target_steps: number;
  target_sleep_hours: number;
  training_days: number;
  preferred_split: string | null;
  active_days: string[];
};

type ProfileZoneRow = {
  zone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  label: string;
  min_bpm: number;
  max_bpm: number;
  color: string | null;
};

type WeeklyEntryRow = {
  day_of_week: keyof UserProfile['weeklySchedule'];
  muscle_group: string;
  sort_order: number;
};

const FALLBACK_PROFILE: UserProfile = {
  name: 'Utente',
  weight: 75,
  heartRateMax: 190,
  heartRateZones: normalizeHeartRateZones(undefined),
  targetSteps: 8000,
  targetSleep: 7.5,
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
  },
};

export async function ensureProfileExists() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return userId;
  }

  const { error: insertError } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      name: FALLBACK_PROFILE.name,
      weight_kg: FALLBACK_PROFILE.weight,
      heart_rate_max: FALLBACK_PROFILE.heartRateMax,
      target_steps: FALLBACK_PROFILE.targetSteps,
      target_sleep_hours: FALLBACK_PROFILE.targetSleep,
      training_days: FALLBACK_PROFILE.trainingDays,
      preferred_split: FALLBACK_PROFILE.preferredSplit,
      active_days: FALLBACK_PROFILE.activeDays,
    });

  if (insertError) {
    throw insertError;
  }

  setStoredProfile(FALLBACK_PROFILE);
  return userId;
}

function buildProfileRow(profile: UserProfile): ProfileRow {
  return {
    id: '',
    name: profile.name,
    weight_kg: profile.weight,
    heart_rate_max: profile.heartRateMax,
    target_steps: profile.targetSteps,
    target_sleep_hours: profile.targetSleep,
    training_days: profile.trainingDays,
    preferred_split: profile.preferredSplit,
    active_days: profile.activeDays,
  };
}

function buildWeeklyScheduleRows(profile: UserProfile) {
  return Object.entries(profile.weeklySchedule).flatMap(([day, muscles]) =>
    muscles.map((muscle, index) => ({
      user_id: '',
      day_of_week: day,
      muscle_group: muscle,
      sort_order: index,
    })),
  );
}

function buildZonesRows(profile: UserProfile) {
  return normalizeHeartRateZones(profile.heartRateZones).map((zone) => ({
    user_id: '',
    zone: zone.zone,
    label: zone.label,
    min_bpm: zone.min,
    max_bpm: zone.max,
    color: zone.color,
  }));
}

function mapProfileFromRows(
  profileRow: ProfileRow,
  zonesRows: ProfileZoneRow[],
  weeklyRows: WeeklyEntryRow[],
): UserProfile {
  const weeklySchedule = {
    monday: [] as string[],
    tuesday: [] as string[],
    wednesday: [] as string[],
    thursday: [] as string[],
    friday: [] as string[],
    saturday: [] as string[],
    sunday: [] as string[],
  };

  weeklyRows
    .sort((left, right) => left.sort_order - right.sort_order)
    .forEach((entry) => {
      weeklySchedule[entry.day_of_week].push(entry.muscle_group);
    });

  return {
    name: profileRow.name || FALLBACK_PROFILE.name,
    weight: profileRow.weight_kg ?? FALLBACK_PROFILE.weight,
    heartRateMax: profileRow.heart_rate_max ?? FALLBACK_PROFILE.heartRateMax,
    heartRateZones: normalizeHeartRateZones(
      zonesRows.map((zone) => ({
        zone: zone.zone,
        label: zone.label,
        min: zone.min_bpm,
        max: zone.max_bpm,
        color: zone.color || '#ffffff',
      })),
    ),
    targetSteps: profileRow.target_steps ?? FALLBACK_PROFILE.targetSteps,
    targetSleep: profileRow.target_sleep_hours ?? FALLBACK_PROFILE.targetSleep,
    trainingDays: profileRow.training_days ?? FALLBACK_PROFILE.trainingDays,
    preferredSplit: profileRow.preferred_split || FALLBACK_PROFILE.preferredSplit,
    activeDays: profileRow.active_days?.length ? profileRow.active_days : FALLBACK_PROFILE.activeDays,
    weeklySchedule,
  };
}

export async function loadProfileFromSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();

  const [{ data: profileRow, error: profileError }, { data: zonesRows, error: zonesError }, { data: weeklyRows, error: weeklyError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('profile_heart_rate_zones').select('zone,label,min_bpm,max_bpm,color').eq('user_id', userId),
    supabase.from('profile_weekly_schedule_entries').select('day_of_week,muscle_group,sort_order').eq('user_id', userId),
  ]);

  if (profileError || zonesError || weeklyError) {
    throw profileError || zonesError || weeklyError;
  }

  if (!profileRow) {
    return null;
  }

  const profile = mapProfileFromRows(profileRow as ProfileRow, (zonesRows || []) as ProfileZoneRow[], (weeklyRows || []) as WeeklyEntryRow[]);
  setStoredProfile(profile);
  return profile;
}

export async function loadCoachMemoryFromSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const { data, error } = await supabase
    .from('coach_memory')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const memory: CoachMemory = {
    primaryGoal: data.primary_goal,
    mainSport: data.main_sport,
    availableEquipment: data.available_equipment || [],
    limitations: data.limitations || [],
    injuries: data.injuries || [],
    preferences: data.preferences || [],
    coachNotes: data.coach_notes || [],
    currentPhase: data.current_phase || undefined,
    updatedAt: data.updated_at || new Date().toISOString(),
  };

  setStoredCoachMemory(memory);
  return memory;
}

export async function hydrateProfileFromSupabase() {
  const [profile, coachMemory] = await Promise.all([
    loadProfileFromSupabase(),
    loadCoachMemoryFromSupabase(),
  ]);

  return { profile, coachMemory };
}

export async function saveProfileToSupabase(profile: UserProfile, coachMemory?: CoachMemory | null) {
  setStoredProfile(profile);
  if (coachMemory) {
    setStoredCoachMemory(coachMemory);
  }

  if (!isSupabaseConfigured) {
    throw new Error('Supabase non configurato.');
  }

  const supabase = getSupabaseClient();
  const userId = await ensureProfileExists();
  const profileRow = { ...buildProfileRow(profile), id: userId };
  const zoneRows = buildZonesRows(profile).map((row) => ({ ...row, user_id: userId }));
  const weeklyRows = buildWeeklyScheduleRows(profile).map((row) => ({ ...row, user_id: userId }));

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(profileRow, { onConflict: 'id' });

  if (profileError) {
    throw profileError;
  }

  const { error: deleteZonesError } = await supabase
    .from('profile_heart_rate_zones')
    .delete()
    .eq('user_id', userId);

  if (deleteZonesError) {
    throw deleteZonesError;
  }

  if (zoneRows.length > 0) {
    const { error: zonesError } = await supabase
      .from('profile_heart_rate_zones')
      .insert(zoneRows);

    if (zonesError) {
      throw zonesError;
    }
  }

  const { error: deleteWeeklyError } = await supabase
    .from('profile_weekly_schedule_entries')
    .delete()
    .eq('user_id', userId);

  if (deleteWeeklyError) {
    throw deleteWeeklyError;
  }

  if (weeklyRows.length > 0) {
    const { error: weeklyError } = await supabase
      .from('profile_weekly_schedule_entries')
      .insert(weeklyRows);

    if (weeklyError) {
      throw weeklyError;
    }
  }

  if (coachMemory) {
    const { error: coachMemoryError } = await supabase
      .from('coach_memory')
      .upsert({
        user_id: userId,
        primary_goal: coachMemory.primaryGoal,
        main_sport: coachMemory.mainSport,
        available_equipment: coachMemory.availableEquipment,
        limitations: coachMemory.limitations,
        injuries: coachMemory.injuries,
        preferences: coachMemory.preferences,
        coach_notes: coachMemory.coachNotes,
        current_phase: coachMemory.currentPhase || null,
      }, { onConflict: 'user_id' });

    if (coachMemoryError) {
      throw coachMemoryError;
    }
  }
}
