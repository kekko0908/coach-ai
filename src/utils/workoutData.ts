import { HeartRateZoneConfig, Workout, WorkoutType } from '../types';
import { DEFAULT_HEART_RATE_ZONES, normalizeHeartRateZones } from './heartRateZones';
import { getWorkoutDefaultTitle } from './workoutMeta';

export interface WorkoutMetrics {
  distanceKm: number;
  durationMs: number;
  avgSpeedKmh: number;
  avgPaceMinPerKm: number | null;
  bestPaceMinPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGain: number;
  avgCadence: number | null;
  avgStrideLength: number | null;
  caloriesBurned: number | null;
}

export interface Segment {
  positions: [[number, number], [number, number]];
  speed: number;
  color: string;
}

export interface WorkoutChartPoint {
  elapsedSec: number;
  label: string;
  paceMinPerKm: number | null;
  heartRate: number | null;
  cadence: number | null;
  strideLength: number | null;
  speedKmh: number | null;
  cumulativeDistanceKm: number;
}

export interface HeartZonePoint {
  zone: string;
  label: string;
  bpmMin: number;
  bpmMax: number;
  seconds: number;
  minutes: number;
  percentage: number;
  color: string;
}

export interface WorkoutInsights {
  positions: [number, number][];
  segments: Segment[];
  metrics: WorkoutMetrics | null;
  chartPoints: WorkoutChartPoint[];
  splits: WorkoutSplit[];
  heartZones: HeartZonePoint[];
  sampledPoints: Array<Record<string, number | string | null>>;
  source: 'none' | 'gpx' | 'tcx' | 'combined';
}

export interface WorkoutSplit {
  label: string;
  distanceKm: number;
  paceMinPerKm: number | null;
  avgHr: number | null;
  cumulativeTimeSec: number;
}

export interface WorkoutImportMetadata {
  date: string | null;
  type: WorkoutType;
  title: string;
}

function toWorkoutDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

type RawPoint = {
  lat: number | null;
  lon: number | null;
  elevation: number | null;
  time: string | null;
  hr: number | null;
  cadence: number | null;
  speedKmh: number | null;
  distanceKm: number | null;
  strideLength: number | null;
};

type TimelinePoint = {
  elapsedSec: number;
  cumulativeDistanceKm: number;
  hr: number | null;
  paceMinPerKm: number | null;
};

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function getNodeName(node: Element) {
  return (node.localName || node.nodeName.split(':').pop() || '').toLowerCase();
}

function getFirstDescendant(node: Element, candidates: string[]) {
  const normalized = candidates.map((candidate) => candidate.toLowerCase());
  const descendants = Array.from(node.getElementsByTagName('*'));
  return descendants.find((child) => normalized.includes(getNodeName(child))) || null;
}

function getText(node: Element | null) {
  return node?.textContent?.trim() || null;
}

function parseXmlDocument(raw: string) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(raw, 'text/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML file');
  }
  return xmlDoc;
}

function sumTcxCalories(xmlDoc: XMLDocument) {
  const nodes = Array.from(xmlDoc.getElementsByTagName('*')).filter((node) => getNodeName(node) === 'calories');
  const values = nodes
    .map((node) => Number.parseInt(getText(node) || '', 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return null;
  }

  return values.reduce((acc, value) => acc + value, 0);
}

function formatClockElapsed(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function getBestPaceMinPerKm(paces: number[]) {
  const validPaces = paces.filter((pace) => pace >= 3 && pace <= 30).sort((a, b) => a - b);
  if (validPaces.length === 0) {
    return null;
  }

  const percentileIndex = Math.max(0, Math.floor(validPaces.length * 0.1) - 1);
  return Number(validPaces[percentileIndex].toFixed(2));
}

function buildWorkoutSplits(points: TimelinePoint[]) {
  if (points.length < 2) {
    return [] as WorkoutSplit[];
  }

  const splits: WorkoutSplit[] = [];
  let splitStartDistance = 0;
  let splitStartSec = 0;
  let nextBoundaryKm = 1;
  let splitHrSum = 0;
  let splitHrCount = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];

    if (currentPoint.hr !== null) {
      splitHrSum += currentPoint.hr;
      splitHrCount += 1;
    }

    while (currentPoint.cumulativeDistanceKm >= nextBoundaryKm && currentPoint.cumulativeDistanceKm > previousPoint.cumulativeDistanceKm) {
      const segmentDistance = currentPoint.cumulativeDistanceKm - previousPoint.cumulativeDistanceKm;
      const ratio = (nextBoundaryKm - previousPoint.cumulativeDistanceKm) / segmentDistance;
      const boundaryElapsedSec = previousPoint.elapsedSec + ratio * (currentPoint.elapsedSec - previousPoint.elapsedSec);
      const splitDistanceKm = nextBoundaryKm - splitStartDistance;
      const splitDurationSec = boundaryElapsedSec - splitStartSec;

      splits.push({
        label: `${nextBoundaryKm}`,
        distanceKm: Number(splitDistanceKm.toFixed(2)),
        paceMinPerKm: splitDistanceKm > 0 ? Number(((splitDurationSec / 60) / splitDistanceKm).toFixed(2)) : null,
        avgHr: splitHrCount > 0 ? Math.round(splitHrSum / splitHrCount) : null,
        cumulativeTimeSec: Math.round(boundaryElapsedSec),
      });

      splitStartDistance = nextBoundaryKm;
      splitStartSec = boundaryElapsedSec;
      nextBoundaryKm += 1;
      splitHrSum = currentPoint.hr ?? 0;
      splitHrCount = currentPoint.hr !== null ? 1 : 0;
    }
  }

  const lastPoint = points[points.length - 1];
  const remainingDistanceKm = lastPoint.cumulativeDistanceKm - splitStartDistance;
  if (remainingDistanceKm > 0.05) {
    const splitDurationSec = lastPoint.elapsedSec - splitStartSec;
    splits.push({
      label: `<${nextBoundaryKm}`,
      distanceKm: Number(remainingDistanceKm.toFixed(2)),
      paceMinPerKm: remainingDistanceKm > 0 ? Number(((splitDurationSec / 60) / remainingDistanceKm).toFixed(2)) : null,
      avgHr: splitHrCount > 0 ? Math.round(splitHrSum / splitHrCount) : null,
      cumulativeTimeSec: Math.round(lastPoint.elapsedSec),
    });
  }

  return splits;
}

function extractFirstTcxDate(tcxData: string) {
  const xmlDoc = parseXmlDocument(tcxData);
  const nodes = Array.from(xmlDoc.getElementsByTagName('*'));
  const activityIdNode = nodes.find((node) => getNodeName(node) === 'id');
  const lapNode = nodes.find((node) => getNodeName(node) === 'lap');
  const timeNode = nodes.find((node) => getNodeName(node) === 'time');

  const activityId = getText(activityIdNode || null);
  const lapStartTime = lapNode?.getAttribute('StartTime') || null;
  const firstTrackTime = getText(timeNode || null);

  return toWorkoutDate(activityId || lapStartTime || firstTrackTime || '');
}

function extractFirstGpxDate(gpxData: string) {
  const xmlDoc = parseXmlDocument(gpxData);
  const trackpoint = xmlDoc.getElementsByTagName('trkpt')[0];
  const metadataTime = getText(Array.from(xmlDoc.getElementsByTagName('*')).find((node) => getNodeName(node) === 'time') || null);
  const trackpointTime = trackpoint ? getText(getFirstDescendant(trackpoint, ['time'])) : null;

  return toWorkoutDate(trackpointTime || metadataTime || '');
}

export function extractWorkoutActivityDate(workout: Pick<Workout, 'tcxData' | 'gpxData'>) {
  try {
    if (workout.tcxData) {
      const tcxDate = extractFirstTcxDate(workout.tcxData);
      if (tcxDate) {
        return tcxDate;
      }
    }

    if (workout.gpxData) {
      const gpxDate = extractFirstGpxDate(workout.gpxData);
      if (gpxDate) {
        return gpxDate;
      }
    }

    return null;
  } catch (error) {
    console.error('Workout activity date extraction error', error);
    return null;
  }
}

function inferWorkoutTypeFromText(value: string | null | undefined) {
  const normalizedValue = value?.toLowerCase() || '';
  if (normalizedValue.includes('calcio') || normalizedValue.includes('football') || normalizedValue.includes('soccer')) {
    return 'football';
  }
  if (normalizedValue.includes('cicl') || normalizedValue.includes('bike') || normalizedValue.includes('cycling')) {
    return 'cycling';
  }
  if (normalizedValue.includes('workout') || normalizedValue.includes('palestra') || normalizedValue.includes('gym')) {
    return 'workout';
  }
  if (normalizedValue.includes('corsa') || normalizedValue.includes('running') || normalizedValue.includes('run')) {
    return 'running';
  }
  return null;
}

export function extractWorkoutImportMetadata(workout: Pick<Workout, 'tcxData' | 'gpxData'>): WorkoutImportMetadata {
  if (workout.tcxData) {
    try {
      const xmlDoc = parseXmlDocument(workout.tcxData);
      const nodes = Array.from(xmlDoc.getElementsByTagName('*'));
      const activityNode = nodes.find((node) => getNodeName(node) === 'activity');
      const notesNode = nodes.find((node) => getNodeName(node) === 'notes');
      const sport = activityNode?.getAttribute('Sport') || '';
      const notes = getText(notesNode || null);
      const date = extractFirstTcxDate(workout.tcxData);
      const inferredFromNotes = inferWorkoutTypeFromText(notes);

      let type: WorkoutType = 'running';
      if (inferredFromNotes) {
        type = inferredFromNotes;
      } else if (sport.toLowerCase() === 'other') {
        type = 'workout';
      } else if (sport.toLowerCase() === 'biking' || sport.toLowerCase() === 'cycling') {
        type = 'cycling';
      } else if (sport.toLowerCase() === 'running') {
        type = 'running';
      }

      return {
        date,
        type,
        title: getWorkoutDefaultTitle(type),
      };
    } catch (error) {
      console.error('Workout import metadata error (TCX)', error);
    }
  }

  if (workout.gpxData) {
    const date = extractFirstGpxDate(workout.gpxData);
    return {
      date,
      type: 'running',
      title: getWorkoutDefaultTitle('running'),
    };
  }

  return {
    date: null,
    type: 'workout',
    title: getWorkoutDefaultTitle('workout'),
  };
}

function getHeartRateZoneLabel(percentage: number) {
  if (percentage < 0.6) return 'Z1';
  if (percentage < 0.7) return 'Z2';
  if (percentage < 0.8) return 'Z3';
  if (percentage < 0.9) return 'Z4';
  return 'Z5';
}

function getZoneForHeartRate(heartRate: number, zones: HeartRateZoneConfig[]) {
  const matchingZone = zones.find((zone) => heartRate >= zone.min && heartRate <= zone.max);
  if (matchingZone) {
    return matchingZone;
  }

  if (heartRate < zones[zones.length - 1].min) {
    return zones[zones.length - 1];
  }

  return zones[0];
}

function getSegmentColor(speed: number, maxSpeed: number) {
  if (!speed || speed <= 0) return '#10b981';
  if (speed < maxSpeed * 0.4) return '#10b981';
  if (speed < maxSpeed * 0.75) return '#f59e0b';
  return '#ef4444';
}

function buildInsights(
  points: RawPoint[],
  source: WorkoutInsights['source'],
  options?: { zoneReferenceMaxHr?: number | null; customZones?: HeartRateZoneConfig[] | null; caloriesBurned?: number | null }
): WorkoutInsights {
  if (points.length === 0) {
    return {
      positions: [],
      segments: [],
      metrics: null,
      chartPoints: [],
      splits: [],
      heartZones: [],
      sampledPoints: [],
      source: 'none',
    };
  }

  const positions: [number, number][] = [];
  const segments: Segment[] = [];
  const speeds: number[] = [];
  const chartPoints: WorkoutChartPoint[] = [];
  const timelinePoints: TimelinePoint[] = [{ elapsedSec: 0, cumulativeDistanceKm: 0, hr: points[0]?.hr ?? null, paceMinPerKm: null }];
  const sampledPoints: Array<Record<string, number | string | null>> = [];
  const heartRateIntervals: Array<{ heartRate: number; seconds: number }> = [];
  const zoneBuckets = {
    Z1: 0,
    Z2: 0,
    Z3: 0,
    Z4: 0,
    Z5: 0,
  };

  let totalDistanceKm = 0;
  let totalElevationGain = 0;
  let heartRateSum = 0;
  let heartRateCount = 0;
  let maxHeartRate = 0;
  let cadenceSum = 0;
  let cadenceCount = 0;
  let strideSum = 0;
  let strideCount = 0;
  let startTime: Date | null = null;
  let endTime: Date | null = null;

  points.forEach((point, index) => {
    const pointTime = point.time ? new Date(point.time) : null;
    if (!startTime && pointTime && !Number.isNaN(pointTime.getTime())) {
      startTime = pointTime;
    }
    if (pointTime && !Number.isNaN(pointTime.getTime())) {
      endTime = pointTime;
    }

    if (point.hr !== null) {
      heartRateSum += point.hr;
      heartRateCount += 1;
      maxHeartRate = Math.max(maxHeartRate, point.hr);
    }

    if (point.cadence !== null && point.cadence > 0) {
      cadenceSum += point.cadence;
      cadenceCount += 1;
    }

    const lat = point.lat;
    const lon = point.lon;
    if (lat !== null && lon !== null) {
      positions.push([lat, lon]);
    }

    if (index === 0) {
      return;
    }

    const previous = points[index - 1];
    const previousTime = previous.time ? new Date(previous.time) : null;
    const elapsedMs = pointTime && previousTime ? pointTime.getTime() - previousTime.getTime() : 0;
    const elapsedHours = elapsedMs > 0 ? elapsedMs / (1000 * 60 * 60) : 0;
    const elapsedSeconds = elapsedMs > 0 ? elapsedMs / 1000 : 0;

    let segmentDistanceKm = 0;
    if (point.distanceKm !== null && previous.distanceKm !== null && point.distanceKm >= previous.distanceKm) {
      segmentDistanceKm = point.distanceKm - previous.distanceKm;
    } else if (
      point.lat !== null &&
      point.lon !== null &&
      previous.lat !== null &&
      previous.lon !== null
    ) {
      segmentDistanceKm = getDistanceFromLatLonInKm(previous.lat, previous.lon, point.lat, point.lon);
    }
    totalDistanceKm += segmentDistanceKm;

    if (point.elevation !== null && previous.elevation !== null) {
      totalElevationGain += Math.max(0, point.elevation - previous.elevation);
    }

    const speedKmh = point.speedKmh ?? (elapsedHours > 0 ? segmentDistanceKm / elapsedHours : null);
    const strideLength = point.strideLength ?? (
      speedKmh && point.cadence
        ? Number((((speedKmh * 1000) / 3600) * 60 / point.cadence).toFixed(2))
        : null
    );

    if (strideLength !== null && strideLength > 0) {
      strideSum += strideLength;
      strideCount += 1;
    }

    if (
      point.lat !== null &&
      point.lon !== null &&
      previous.lat !== null &&
      previous.lon !== null
    ) {
      const speedForSegment = speedKmh || 0;
      speeds.push(speedForSegment);
      segments.push({
        positions: [[previous.lat, previous.lon], [point.lat, point.lon]],
        speed: speedForSegment,
        color: '#10b981',
      });
    }

    if (point.hr !== null) {
      heartRateIntervals.push({
        heartRate: point.hr,
        seconds: elapsedSeconds || 1,
      });
    }

    const elapsedFromStartSec = startTime && pointTime
      ? Math.max(0, Math.round((pointTime.getTime() - startTime.getTime()) / 1000))
      : index;

    chartPoints.push({
      elapsedSec: elapsedFromStartSec,
      label: formatClockElapsed(elapsedFromStartSec),
      paceMinPerKm: speedKmh && speedKmh > 0 ? Number((60 / speedKmh).toFixed(2)) : null,
      heartRate: point.hr,
      cadence: point.cadence,
      strideLength,
      speedKmh: speedKmh ? Number(speedKmh.toFixed(2)) : null,
      cumulativeDistanceKm: Number(totalDistanceKm.toFixed(3)),
    });

    timelinePoints.push({
      elapsedSec: elapsedFromStartSec,
      cumulativeDistanceKm: Number(totalDistanceKm.toFixed(6)),
      hr: point.hr,
      paceMinPerKm: speedKmh && speedKmh > 0 ? Number((60 / speedKmh).toFixed(2)) : null,
    });

    sampledPoints.push({
      lat: point.lat,
      lon: point.lon,
      ele: point.elevation,
      time: point.time,
      hr: point.hr,
      cad: point.cadence,
      pace: speedKmh && speedKmh > 0 ? Number((60 / speedKmh).toFixed(2)) : null,
      stride: strideLength,
    });
  });

  const validSpeeds = speeds.filter((speed) => speed > 0 && speed < 80);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 15;
  segments.forEach((segment) => {
    segment.color = getSegmentColor(segment.speed, maxSpeed);
  });

  const durationMs = startTime && endTime ? Math.max(0, endTime.getTime() - startTime.getTime()) : 0;
  const avgSpeedKmh = durationMs > 0 ? totalDistanceKm / (durationMs / (1000 * 60 * 60)) : 0;
  const samplingStep = Math.max(1, Math.ceil(chartPoints.length / 42));
  const sampledChartPoints = chartPoints.filter((_, index) => index % samplingStep === 0 || index === chartPoints.length - 1);
  const sampledPreviewPoints = sampledPoints.filter((_, index) => index % Math.max(1, Math.ceil(sampledPoints.length / 60)) === 0 || index === sampledPoints.length - 1);
  const splits = buildWorkoutSplits(timelinePoints);
  const validPaceValues = timelinePoints.map((point) => point.paceMinPerKm).filter((pace): pace is number => pace !== null);
  const resolvedZones = normalizeHeartRateZones(options?.customZones || DEFAULT_HEART_RATE_ZONES);
  if (resolvedZones.length > 0) {
    heartRateIntervals.forEach(({ heartRate, seconds }) => {
      const zone = getZoneForHeartRate(heartRate, resolvedZones);
      zoneBuckets[zone.zone] += seconds;
    });
  }

  const totalZoneSeconds = Object.values(zoneBuckets).reduce((acc, value) => acc + value, 0);

  return {
    positions,
    segments,
    metrics: {
      distanceKm: Number(totalDistanceKm.toFixed(2)),
      durationMs,
      avgSpeedKmh: Number(avgSpeedKmh.toFixed(2)),
      avgPaceMinPerKm: avgSpeedKmh > 0 ? Number((60 / avgSpeedKmh).toFixed(2)) : null,
      bestPaceMinPerKm: getBestPaceMinPerKm(validPaceValues),
      avgHr: heartRateCount > 0 ? Math.round(heartRateSum / heartRateCount) : null,
      maxHr: maxHeartRate > 0 ? maxHeartRate : null,
      elevationGain: Math.round(totalElevationGain),
      avgCadence: cadenceCount > 0 ? Math.round(cadenceSum / cadenceCount) : null,
      avgStrideLength: strideCount > 0 ? Number((strideSum / strideCount).toFixed(2)) : null,
      caloriesBurned: options?.caloriesBurned ?? null,
    },
    chartPoints: sampledChartPoints,
    splits,
    heartZones: totalZoneSeconds > 0
      ? ['Z5', 'Z4', 'Z3', 'Z2', 'Z1'].map((zone) => {
          const seconds = zoneBuckets[zone as keyof typeof zoneBuckets];
          const zoneMeta = resolvedZones.find((item) => item.zone === zone) || DEFAULT_HEART_RATE_ZONES.find((item) => item.zone === zone)!;

          return {
            zone,
            label: zoneMeta.label,
            bpmMin: zoneMeta.min,
            bpmMax: zoneMeta.max,
            seconds,
            minutes: Number((seconds / 60).toFixed(1)),
            percentage: Number(((seconds / totalZoneSeconds) * 100).toFixed(1)),
            color: zoneMeta.color,
          };
        })
      : [],
    sampledPoints: sampledPreviewPoints,
    source,
  };
}

function parseGpx(gpxData: string, options?: { zoneReferenceMaxHr?: number | null; customZones?: HeartRateZoneConfig[] | null }) {
  const xmlDoc = parseXmlDocument(gpxData);
  const trackpoints = Array.from(xmlDoc.getElementsByTagName('trkpt'));
  const points: RawPoint[] = trackpoints.map((trackpoint) => {
    const lat = Number.parseFloat(trackpoint.getAttribute('lat') || '');
    const lon = Number.parseFloat(trackpoint.getAttribute('lon') || '');
    const elevation = Number.parseFloat(getText(getFirstDescendant(trackpoint, ['ele'])) || '');
    const time = getText(getFirstDescendant(trackpoint, ['time']));
    const hr = Number.parseInt(getText(getFirstDescendant(trackpoint, ['hr'])) || '', 10);
    const cadence = Number.parseInt(getText(getFirstDescendant(trackpoint, ['cad'])) || '', 10);

    return {
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      elevation: Number.isFinite(elevation) ? elevation : null,
      time,
      hr: Number.isFinite(hr) ? hr : null,
      cadence: Number.isFinite(cadence) ? cadence : null,
      speedKmh: null,
      distanceKm: null,
      strideLength: null,
    };
  });

  return buildInsights(points, 'gpx', {
    zoneReferenceMaxHr: options?.zoneReferenceMaxHr || null,
    customZones: options?.customZones || null,
    caloriesBurned: null,
  });
}

function parseTcx(tcxData: string, options?: { zoneReferenceMaxHr?: number | null; customZones?: HeartRateZoneConfig[] | null }) {
  const xmlDoc = parseXmlDocument(tcxData);
  const nodes = Array.from(xmlDoc.getElementsByTagName('*'));
  const trackpoints = nodes.filter((node) => getNodeName(node) === 'trackpoint');
  const maximumHeartRateNodes = nodes.filter((node) => getNodeName(node) === 'maximumheartratebpm');
  const maximumHeartRateValues = maximumHeartRateNodes
    .map((node) => Number.parseInt(getText(getFirstDescendant(node, ['value'])) || '', 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const zoneReferenceMaxHr = maximumHeartRateValues.length > 0 ? Math.max(...maximumHeartRateValues) : null;
  const caloriesBurned = sumTcxCalories(xmlDoc);
  const points: RawPoint[] = trackpoints.map((trackpoint) => {
    const position = getFirstDescendant(trackpoint, ['position']);
    const latitude = Number.parseFloat(getText(getFirstDescendant(position || trackpoint, ['latitudedegrees'])) || '');
    const longitude = Number.parseFloat(getText(getFirstDescendant(position || trackpoint, ['longitudedegrees'])) || '');
    const altitude = Number.parseFloat(getText(getFirstDescendant(trackpoint, ['altitudemeters'])) || '');
    const time = getText(getFirstDescendant(trackpoint, ['time']));
    const distanceMeters = Number.parseFloat(getText(getFirstDescendant(trackpoint, ['distancemeters'])) || '');
    const heartRateNode = getFirstDescendant(trackpoint, ['heartratebpm']);
    const heartRate = Number.parseInt(getText(getFirstDescendant(heartRateNode || trackpoint, ['value'])) || '', 10);
    const cadence = Number.parseInt(getText(getFirstDescendant(trackpoint, ['cadence', 'runcadence'])) || '', 10);
    const speedMps = Number.parseFloat(getText(getFirstDescendant(trackpoint, ['speed'])) || '');
    const strideLength = Number.parseFloat(getText(getFirstDescendant(trackpoint, ['stridelength'])) || '');

    return {
      lat: Number.isFinite(latitude) ? latitude : null,
      lon: Number.isFinite(longitude) ? longitude : null,
      elevation: Number.isFinite(altitude) ? altitude : null,
      time,
      hr: Number.isFinite(heartRate) ? heartRate : null,
      cadence: Number.isFinite(cadence) ? cadence : null,
      speedKmh: Number.isFinite(speedMps) ? speedMps * 3.6 : null,
      distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
      strideLength: Number.isFinite(strideLength) ? Number(strideLength.toFixed(2)) : null,
    };
  });

  return buildInsights(points, 'tcx', {
    zoneReferenceMaxHr: options?.zoneReferenceMaxHr || zoneReferenceMaxHr,
    customZones: options?.customZones || null,
    caloriesBurned,
  });
}

export function buildWorkoutInsights(
  workout: Pick<Workout, 'gpxData' | 'tcxData'>,
  options?: { userMaxHeartRate?: number | null; customHeartRateZones?: HeartRateZoneConfig[] | null }
): WorkoutInsights {
  try {
    const overrideZoneReference = options?.userMaxHeartRate && options.userMaxHeartRate > 0
      ? options.userMaxHeartRate
      : null;
    const normalizedTcxInsights = workout.tcxData
      ? parseTcx(workout.tcxData, {
          zoneReferenceMaxHr: overrideZoneReference,
          customZones: options?.customHeartRateZones || null,
        })
      : null;
    const normalizedGpxInsights = workout.gpxData
      ? parseGpx(workout.gpxData, {
          zoneReferenceMaxHr: overrideZoneReference,
          customZones: options?.customHeartRateZones || null,
        })
      : null;

    if (normalizedTcxInsights && normalizedGpxInsights) {
      return {
        positions: normalizedTcxInsights.positions.length > 0 ? normalizedTcxInsights.positions : normalizedGpxInsights.positions,
        segments: normalizedTcxInsights.segments.length > 0 ? normalizedTcxInsights.segments : normalizedGpxInsights.segments,
        metrics: normalizedTcxInsights.metrics || normalizedGpxInsights.metrics,
        chartPoints: normalizedTcxInsights.chartPoints.length > 0 ? normalizedTcxInsights.chartPoints : normalizedGpxInsights.chartPoints,
        splits: normalizedTcxInsights.splits.length > 0 ? normalizedTcxInsights.splits : normalizedGpxInsights.splits,
        heartZones: normalizedTcxInsights.heartZones.length > 0 ? normalizedTcxInsights.heartZones : normalizedGpxInsights.heartZones,
        sampledPoints: normalizedTcxInsights.sampledPoints.length > 0 ? normalizedTcxInsights.sampledPoints : normalizedGpxInsights.sampledPoints,
        source: 'combined',
      };
    }

    return normalizedTcxInsights || normalizedGpxInsights || {
      positions: [],
      segments: [],
      metrics: null,
      chartPoints: [],
      splits: [],
      heartZones: [],
      sampledPoints: [],
      source: 'none',
    };
  } catch (error) {
    console.error('Workout file parsing error', error);
    return {
      positions: [],
      segments: [],
      metrics: null,
      chartPoints: [],
      splits: [],
      heartZones: [],
      sampledPoints: [],
      source: 'none',
    };
  }
}

export function deriveWorkoutSummary(workout: Pick<Workout, 'durationMinutes' | 'caloriesBurned' | 'averageHeartRate' | 'gpxData' | 'tcxData'>) {
  const insights = buildWorkoutInsights(workout, {});
  const durationMinutes = workout.durationMinutes ?? (
    insights.metrics?.durationMs ? Math.round(insights.metrics.durationMs / 60000) : undefined
  );
  const caloriesBurned = workout.caloriesBurned ?? insights.metrics?.caloriesBurned ?? undefined;
  const averageHeartRate = workout.averageHeartRate ?? insights.metrics?.avgHr ?? undefined;

  return {
    durationMinutes,
    caloriesBurned,
    averageHeartRate,
  };
}
