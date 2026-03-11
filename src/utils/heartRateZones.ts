import { HeartRateZoneConfig } from '../types';

export const DEFAULT_HEART_RATE_ZONES: HeartRateZoneConfig[] = [
  { zone: 'Z5', label: 'VO2 Max', min: 177, max: 197, color: '#ef4444' },
  { zone: 'Z4', label: 'Anaerobica', min: 157, max: 176, color: '#f59e0b' },
  { zone: 'Z3', label: 'Aerobica', min: 137, max: 156, color: '#14b8a6' },
  { zone: 'Z2', label: 'Intensiva', min: 118, max: 136, color: '#0ea5e9' },
  { zone: 'Z1', label: 'Leggera', min: 98, max: 117, color: '#8b5cf6' },
];

export function normalizeHeartRateZones(zones?: HeartRateZoneConfig[] | null) {
  if (!zones || zones.length !== 5) {
    return DEFAULT_HEART_RATE_ZONES;
  }

  const zoneMap = new Map(zones.map((zone) => [zone.zone, zone]));
  return DEFAULT_HEART_RATE_ZONES.map((fallbackZone) => {
    const zone = zoneMap.get(fallbackZone.zone);
    if (!zone) {
      return fallbackZone;
    }

    return {
      zone: fallbackZone.zone,
      label: zone.label || fallbackZone.label,
      min: Number.isFinite(zone.min) ? zone.min : fallbackZone.min,
      max: Number.isFinite(zone.max) ? zone.max : fallbackZone.max,
      color: zone.color || fallbackZone.color,
    };
  });
}
