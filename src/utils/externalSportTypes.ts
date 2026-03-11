import { WorkoutType } from '../types';

export interface ExternalSportTypeMeta {
  code: number;
  label: string;
  workoutType: WorkoutType;
  needsRouteData: boolean;
}

export const EXTERNAL_SPORT_TYPE_MAP: Record<number, ExternalSportTypeMeta> = {
  1: { code: 1, label: 'Calcio', workoutType: 'football', needsRouteData: false },
  6: { code: 6, label: 'Camminata', workoutType: 'other', needsRouteData: false },
  15: { code: 15, label: 'Nuoto libero', workoutType: 'other', needsRouteData: true },
  16: { code: 16, label: 'Workout', workoutType: 'workout', needsRouteData: false },
  18: { code: 18, label: 'Calcio', workoutType: 'football', needsRouteData: false },
  19: { code: 19, label: 'Workout', workoutType: 'workout', needsRouteData: false },
  50: { code: 50, label: 'Workout', workoutType: 'workout', needsRouteData: false },
  52: { code: 52, label: 'Workout', workoutType: 'workout', needsRouteData: false },
  54: { code: 54, label: 'Stretching', workoutType: 'other', needsRouteData: false },
  189: { code: 189, label: 'Esport', workoutType: 'other', needsRouteData: false },
};

export function resolveExternalSportType(code: number) {
  return EXTERNAL_SPORT_TYPE_MAP[code] || {
    code,
    label: `Tipo ${code}`,
    workoutType: 'other' as WorkoutType,
    needsRouteData: false,
  };
}
