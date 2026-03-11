import React, { useEffect, useRef, useState } from 'react';
import { HeartRateZoneConfig, Workout, Message } from '../types';
import { ArrowLeft, Map as MapIcon, Activity, Bot, Loader2, Send, Dumbbell, Heart, Timer, Zap, TrendingUp, Mountain, Flame, PanelRightClose, PanelRightOpen, Brain, Mic, MicOff, FlaskConical, Footprints, Waves, Archive } from 'lucide-react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import ReactMarkdown from 'react-markdown';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import { buildWorkoutInsights, WorkoutInsights } from '../utils/workoutData';
import { getWorkoutTheme, getWorkoutTypeLabel, resolveWorkoutTitle } from '../utils/workoutMeta';
import { buildResponseStyleInstruction, buildUserContextSummary, getAiConnectionHint, sendCoachRequest } from '../utils/aiClient';
import { formatAssistantMarkdown } from '../utils/aiFormatting';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { buildWorkoutCoachContext } from '../utils/coachContext';
import { getStoredProfile, getStoredThinkerModeEnabled } from '../lib/appDataStore';

interface WorkoutDashboardProps {
  workout: Workout;
  onClose: () => void;
}

function MapBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions);
    }
  }, [map, positions]);

  return null;
}

function formatDuration(ms: number) {
  if (!ms) return '0m 00s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatPace(speedKmh: number) {
  if (!speedKmh || speedKmh <= 0) return "0'00\"/km";
  const paceMinutes = 60 / speedKmh;
  const minutes = Math.floor(paceMinutes);
  const seconds = Math.round((paceMinutes - minutes) * 60);
  return `${minutes}'${seconds.toString().padStart(2, '0')}"/km`;
}

function formatPaceValue(value: number | null | undefined) {
  if (value === null || value === undefined || value <= 0) return '--';
  const minutes = Math.floor(value);
  const seconds = Math.round((value - minutes) * 60);
  if (seconds === 60) {
    return `${minutes + 1}'00"`;
  }
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`;
}

function formatSplitDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatZoneTime(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function WorkoutTypeIcon({
  type,
  sourceSportLabel,
  className = 'w-6 h-6',
}: {
  type?: Workout['type'];
  sourceSportLabel?: string;
  className?: string;
}) {
  const normalizedLabel = sourceSportLabel?.toLowerCase();
  if (normalizedLabel === 'camminata') {
    return <Footprints className={className} />;
  }
  if (normalizedLabel === 'nuoto libero') {
    return <Waves className={className} />;
  }
  if (normalizedLabel === 'stretching') {
    return <Activity className={className} />;
  }
  if (normalizedLabel === 'esport') {
    return <Archive className={className} />;
  }
  if (type === 'running' || type === 'cycling') {
    return <Activity className={className} />;
  }
  return <Dumbbell className={className} />;
}

function isScienceBacked(content: string) {
  return /\[(S|P)\d+\]/.test(content);
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <div className="mb-5">
        <h3 className="text-white font-bold">{title}</h3>
        <p className="text-sm text-zinc-500">{subtitle}</p>
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

export default function WorkoutDashboard({ workout, onClose }: WorkoutDashboardProps) {
  const [userMaxHeartRate, setUserMaxHeartRate] = useState<number | null>(null);
  const [customHeartRateZones, setCustomHeartRateZones] = useState<HeartRateZoneConfig[] | null>(null);
  const [insights, setInsights] = useState<WorkoutInsights>(() => buildWorkoutInsights(workout));
  const [isCoachOpen, setIsCoachOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Ciao. Posso analizzare i dati del tuo allenamento usando GPX e TCX: distanza, passo, bpm, cadenza, zone cardiache e anomalie del tracciato.' },
  ]);
  const [input, setInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isThinkerModeEnabled, setIsThinkerModeEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    isSupported: isSpeechSupported,
    isListening,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    onTranscript: setInput,
  });

  useEffect(() => {
    const storedProfile = getStoredProfile();
    if (!storedProfile) {
      return;
    }

    const parsedProfile = storedProfile as { heartRateMax?: number; heartRateZones?: HeartRateZoneConfig[] };
    if (parsedProfile.heartRateMax && parsedProfile.heartRateMax > 0) {
      setUserMaxHeartRate(parsedProfile.heartRateMax);
    }
    if (parsedProfile.heartRateZones && parsedProfile.heartRateZones.length > 0) {
      setCustomHeartRateZones(parsedProfile.heartRateZones);
    }
  }, []);

  useEffect(() => {
    setInsights(buildWorkoutInsights(workout, {
      userMaxHeartRate,
      customHeartRateZones,
    }));
  }, [workout, userMaxHeartRate, customHeartRateZones]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    const syncThinkerMode = () => {
      setIsThinkerModeEnabled(getStoredThinkerModeEnabled());
    };
    const handleThinkerModeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      setIsThinkerModeEnabled(Boolean(customEvent.detail));
    };

    syncThinkerMode();
    window.addEventListener('storage', syncThinkerMode);
    window.addEventListener('fitsync:thinker-mode-changed', handleThinkerModeChanged as EventListener);

    return () => {
      window.removeEventListener('storage', syncThinkerMode);
      window.removeEventListener('fitsync:thinker-mode-changed', handleThinkerModeChanged as EventListener);
    };
  }, []);

  const { metrics, positions, segments, chartPoints, heartZones, sampledPoints, source } = insights;
  const hasMap = positions.length > 0;
  const hasCharts = chartPoints.length > 0;
  const hasSplits = insights.splits.length > 0;
  const isGymWorkout = workout.type === 'workout';
  const workoutTheme = getWorkoutTheme(workout.type, workout.sourceSportLabel);
  const workoutTitle = resolveWorkoutTitle(workout);
  const workoutTypeLabel = getWorkoutTypeLabel(workout.type, workout.sourceSportLabel);
  const durationMinutes = workout.durationMinutes ?? (metrics?.durationMs ? Math.round(metrics.durationMs / 60000) : null);
  const caloriesBurned = workout.caloriesBurned ?? metrics?.caloriesBurned ?? null;
  const averageHeartRate = workout.averageHeartRate ?? metrics?.avgHr ?? null;
  const hasSummaryMetrics = Boolean(durationMinutes || caloriesBurned || averageHeartRate || metrics);
  const bestSplitPace = hasSplits
    ? Math.min(...insights.splits.map((split) => split.paceMinPerKm).filter((pace): pace is number => pace !== null))
    : null;
  const paceValues = chartPoints.map((point) => point.paceMinPerKm).filter((pace): pace is number => pace !== null);
  const heartRateValues = chartPoints.map((point) => point.heartRate).filter((value): value is number => value !== null);
  const paceDomain = paceValues.length > 0
    ? [
        Math.max(3, Math.floor(Math.min(...paceValues))),
        Math.min(30, Math.ceil(Math.max(...paceValues))),
      ]
    : [4, 16];
  const heartRateDomain = heartRateValues.length > 0
    ? [
        Math.max(40, Math.floor(Math.min(...heartRateValues) - 8)),
        Math.min(220, Math.ceil(Math.max(...heartRateValues) + 8)),
      ]
    : [60, 190];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isAnalyzing) return;

    const userMessage = input.trim();
    setInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsAnalyzing(true);

    try {
      let context = `Sei un AI Coach sportivo. L'utente sta chiedendo un'analisi dell'allenamento del ${workout.date}.
Tipo di allenamento: ${workoutTypeLabel}.
Titolo: ${workoutTitle}.
Sorgente dati: ${source}.
`;

      if (metrics) {
        context += `
Metriche principali:
${durationMinutes ? `- Durata: ${formatDuration(durationMinutes * 60000)}` : ''}
${caloriesBurned ? `- Calorie bruciate: ${caloriesBurned} kcal` : ''}
${averageHeartRate ? `- BPM medio: ${averageHeartRate} bpm${metrics.maxHr ? ` (max ${metrics.maxHr} bpm)` : ''}` : ''}
${!isGymWorkout ? `- Distanza: ${metrics.distanceKm.toFixed(2)} km` : ''}
${!isGymWorkout ? `- Passo medio: ${formatPace(metrics.avgSpeedKmh)}` : ''}
${!isGymWorkout ? `- Dislivello positivo: ${metrics.elevationGain} m` : ''}
${!isGymWorkout && metrics.avgCadence ? `- Cadenza media: ${metrics.avgCadence} spm` : ''}
${!isGymWorkout && metrics.avgStrideLength ? `- Falcata media: ${metrics.avgStrideLength} m` : ''}
`;
      }

      if (heartZones.length > 0) {
        context += `
Distribuzione zone cardiache:
${JSON.stringify(heartZones)}
`;
      }

      if (sampledPoints.length > 0) {
        context += `
Campione dei punti allenamento:
${JSON.stringify(sampledPoints)}
`;
      }

      if (workout.exercises.length > 0) {
        context += `
Esercizi svolti:
${JSON.stringify(workout.exercises)}
`;
      }

      context += `
Risposta richiesta:
- ${buildResponseStyleInstruction(userMessage, 'workout').split('\n').join('\n- ').replace(/^- /, '')}
- modalita thinker: ${isThinkerModeEnabled ? 'attiva' : 'disattiva'}.`;

      const aiContent = await sendCoachRequest({
        messages: [
          ...chatMessages,
          { role: 'user', content: userMessage },
        ],
        contextBlocks: [buildUserContextSummary(null)],
        knowledgeQuery: `${workout.type || 'workout'} ${userMessage}`,
        knowledgeScopes: ['training', 'recovery'],
        ragQuery: `${workout.type || 'workout'} ${userMessage}`,
        extraSystemPrompt: buildWorkoutCoachContext(workout, context),
      });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: aiContent }]);
    } catch (error) {
      console.error(error);
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Analisi non disponibile. Verifica ${getAiConnectionHint()}.` },
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleToggleListening = () => {
    if (!isSpeechSupported || isAnalyzing) {
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    startListening();
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 h-full overflow-hidden">
      <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-zinc-300 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className={`p-2 rounded-2xl ${workoutTheme.iconClass}`}>
                <WorkoutTypeIcon type={workout.type} sourceSportLabel={workout.sourceSportLabel} />
              </span>
              {workoutTitle}
            </h2>
            <p className="text-zinc-400 text-sm">
              {workout.date} • {workoutTypeLabel}
            </p>
          </div>
        </div>
        <div className={`${workoutTheme.badgeClass} px-3 py-1 rounded-full text-xs font-medium`}>
          {source === 'combined' ? 'GPX + TCX' : source.toUpperCase()}
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 bg-zinc-950 overflow-y-auto border-r border-zinc-800">
          <div className="p-6 space-y-6">
            {hasSummaryMetrics ? (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Timer className="w-3 h-3" /> Tempo</div>
                  <div className="text-white font-bold text-2xl">{durationMinutes ? formatDuration(durationMinutes * 60000) : '--'}</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Flame className="w-3 h-3" /> Calorie</div>
                  <div className="text-white font-bold text-2xl">{caloriesBurned ? `${caloriesBurned} kcal` : '--'}</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Heart className="w-3 h-3" /> BPM Medio</div>
                  <div className="text-white font-bold text-2xl">{averageHeartRate ? `${averageHeartRate} bpm` : '--'}</div>
                </div>
                {!isGymWorkout && metrics && (
                  <>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><MapIcon className="w-3 h-3" /> Distanza</div>
                      <div className="text-white font-bold text-2xl">{metrics.distanceKm.toFixed(2)} <span className="text-sm text-zinc-400 font-normal">km</span></div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Zap className="w-3 h-3" /> Passo Medio</div>
                      <div className="text-white font-bold text-2xl">{formatPace(metrics.avgSpeedKmh)}</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Mountain className="w-3 h-3" /> Dislivello</div>
                      <div className="text-white font-bold text-2xl">{metrics.elevationGain} <span className="text-sm text-zinc-400 font-normal">m</span></div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Cadenza</div>
                      <div className="text-white font-bold text-2xl">{metrics.avgCadence ? `${metrics.avgCadence} spm` : '--'}</div>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2 flex items-center gap-1"><Activity className="w-3 h-3" /> Falcata</div>
                      <div className="text-white font-bold text-2xl">{metrics.avgStrideLength ? `${metrics.avgStrideLength} m` : '--'}</div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">Nessun dato analizzabile</h3>
                <p className="text-zinc-400">
                  Carica un file TCX per i grafici avanzati. Per corsa all&apos;aperto e calcio puoi aggiungere anche un GPX per la mappa del percorso.
                </p>
              </div>
            )}

            {hasMap && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-bold flex items-center gap-2">
                      <MapIcon className="w-4 h-4 text-sky-300" />
                      Tracciato percorso
                    </h3>
                    <p className="text-sm text-zinc-500">La colorazione evidenzia l&apos;intensita in base alla velocita stimata.</p>
                  </div>
                  <div className="text-xs text-zinc-500">Punti: {positions.length}</div>
                </div>
                <div className="relative h-[380px]">
                  <MapContainer
                    center={positions[0] || [45.4642, 9.19]}
                    zoom={15}
                    maxZoom={22}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                      maxZoom={22}
                      maxNativeZoom={19}
                    />
                    {segments.length > 0 ? (
                      <>
                        {segments.map((segment, index) => (
                          <Polyline key={`${segment.speed}-${index}`} positions={segment.positions} color={segment.color} weight={5} opacity={0.92} />
                        ))}
                        <MapBounds positions={positions} />
                      </>
                    ) : (
                      <>
                        <Polyline positions={positions} color="#10b981" weight={5} opacity={0.9} />
                        <MapBounds positions={positions} />
                      </>
                    )}
                  </MapContainer>

                  <div className="absolute bottom-5 left-5 z-[1000] bg-zinc-950/90 backdrop-blur border border-zinc-800 p-4 rounded-xl shadow-lg">
                    <div className="text-white font-semibold mb-3">Legenda velocita</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-1 rounded-full bg-rose-500"></div>
                        <span className="text-zinc-400">Alta intensita</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-1 rounded-full bg-amber-500"></div>
                        <span className="text-zinc-400">Ritmo medio</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-1 rounded-full bg-emerald-500"></div>
                        <span className="text-zinc-400">Recupero / lento</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {hasCharts && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                  <div className="mb-5">
                    <h3 className="text-white font-bold text-2xl tracking-tight">Passo</h3>
                    <p className="text-zinc-400 text-3xl leading-none mt-2">(min/km)</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="pr-4 border-r border-zinc-800">
                      <div className="text-white text-5xl font-semibold tracking-tight">
                        {formatPaceValue(metrics?.avgPaceMinPerKm)}
                      </div>
                      <div className="text-zinc-400 text-3xl mt-2">Media</div>
                    </div>
                    <div className="pl-4">
                      <div className="text-white text-5xl font-semibold tracking-tight">
                        {formatPaceValue(metrics?.bestPaceMinPerKm)}
                      </div>
                      <div className="text-zinc-400 text-3xl mt-2">Ottimale</div>
                    </div>
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartPoints}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="label" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis
                          stroke="#71717a"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          domain={paceDomain}
                          tickFormatter={(value) => formatPaceValue(Number(value))}
                          reversed
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '1rem', color: '#fff' }}
                          labelStyle={{ color: '#a1a1aa' }}
                          formatter={(value) => [`${formatPaceValue(value as number)} /km`, 'Passo']}
                        />
                        <Line type="monotone" dataKey="paceMinPerKm" stroke="#0ea5e9" strokeWidth={3} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <ChartCard title="Frequenza Cardiaca" subtitle="BPM lungo l'allenamento">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="label" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis
                        stroke="#71717a"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        domain={heartRateDomain}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '1rem', color: '#fff' }}
                        labelStyle={{ color: '#a1a1aa' }}
                        formatter={(value) => [`${value ?? '--'} bpm`, 'Frequenza cardiaca']}
                      />
                      <Area type="monotone" dataKey="heartRate" stroke="#fb7185" fill="#fb7185" fillOpacity={0.18} strokeWidth={3} connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Cadenza e Falcata" subtitle="Cadenza in spm e falcata media in metri">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="label" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis yAxisId="left" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="right" orientation="right" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '1rem', color: '#fff' }}
                        labelStyle={{ color: '#a1a1aa' }}
                        formatter={(value, name) => {
                          if (name === 'Cadenza') return [`${value ?? '--'} spm`, 'Cadenza'];
                          return [value ? `${value} m` : '--', 'Falcata'];
                        }}
                      />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="cadence" stroke="#38bdf8" strokeWidth={3} dot={false} connectNulls name="Cadenza" />
                      <Line yAxisId="right" type="monotone" dataKey="strideLength" stroke="#f59e0b" strokeWidth={3} dot={false} connectNulls name="Falcata" />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                {heartZones.length > 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                    <div className="mb-5">
                      <h3 className="text-white font-bold">Zona di frequenza cardiaca</h3>
                      <p className="text-sm text-zinc-500">Distribuzione del tempo per fascia bpm calcolata dal riferimento cardiaco disponibile nel file.</p>
                    </div>
                    <div className="h-64 overflow-y-auto pr-2 space-y-5">
                      {heartZones.map((zone) => (
                        <div key={zone.zone}>
                          <div className="flex items-end justify-between gap-4 mb-2">
                            <div>
                              <div className="text-white text-lg font-semibold tracking-tight">{zone.label}</div>
                              <div className="text-zinc-400 text-base">
                                {zone.bpmMin}-{zone.bpmMax} bpm
                              </div>
                            </div>
                            <div className="flex items-end gap-4 shrink-0">
                              <div className="text-white text-lg font-semibold min-w-[52px] text-right">
                                {Math.round(zone.percentage)}%
                              </div>
                              <div className="text-white text-lg font-semibold min-w-[68px] text-right">
                                {formatZoneTime(zone.seconds)}
                              </div>
                            </div>
                          </div>
                          <div className="h-4 rounded-full bg-zinc-800/90 overflow-hidden shadow-inner">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.max(zone.percentage, zone.seconds > 0 ? 3 : 0)}%`,
                                backgroundColor: zone.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasSplits && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <div className="mb-6">
                  <h3 className="text-2xl font-bold text-white tracking-tight">Dettagli per km</h3>
                  <p className="text-zinc-500 mt-1">{insights.splits.length} registri</p>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-[56px_minmax(0,1.4fr)_88px_108px] gap-3 px-3 text-zinc-500 text-xs uppercase tracking-wide">
                    <div>km</div>
                    <div>Passo(km)</div>
                    <div>BPM</div>
                    <div>Tempo</div>
                  </div>
                  {insights.splits.map((split) => {
                    const isBestSplit = bestSplitPace !== null && split.paceMinPerKm === bestSplitPace;
                    const paceBarWidth = bestSplitPace !== null && split.paceMinPerKm
                      ? Math.max(35, Math.min(100, (bestSplitPace / split.paceMinPerKm) * 100))
                      : 100;

                    return (
                      <div
                        key={`${split.label}-${split.cumulativeTimeSec}`}
                        className={`grid grid-cols-[56px_minmax(0,1.4fr)_88px_108px] gap-3 items-center rounded-xl px-3 py-3 border ${
                          isBestSplit
                            ? 'bg-zinc-800 border-zinc-700'
                            : 'bg-zinc-950 border-zinc-800'
                        }`}
                      >
                        <div className={`text-2xl font-semibold ${isBestSplit ? 'text-emerald-400' : 'text-white'}`}>
                          {split.label}
                        </div>
                        <div>
                          <div className="flex items-center gap-3">
                            <div className="text-xl font-semibold text-white min-w-[78px]">
                              {formatPaceValue(split.paceMinPerKm)}
                            </div>
                            <div className="flex-1 h-4 rounded-full bg-zinc-700/80 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${paceBarWidth}%`,
                                  backgroundColor: isBestSplit ? '#14b8a6' : '#38bdf8',
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="text-2xl font-semibold text-white">
                          {split.avgHr ? split.avgHr : '--'}
                        </div>
                        <div className="text-2xl font-semibold text-white">
                          {formatSplitDuration(split.cumulativeTimeSec)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {workout.exercises.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <Dumbbell className="w-5 h-5 text-emerald-400" />
                  Esercizi svolti
                </h3>
                <div className="space-y-4">
                  {workout.exercises.map((exercise, index) => (
                    <div key={exercise.id || index} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                      <div className="font-bold text-white text-lg mb-2">{exercise.name || 'Esercizio'}</div>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <div className="bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800/50">
                          <span className="text-zinc-500 mr-2">Set:</span>
                          <span className="text-emerald-400 font-bold">{exercise.sets}</span>
                        </div>
                        <div className="bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800/50">
                          <span className="text-zinc-500 mr-2">Reps:</span>
                          <span className="text-emerald-400 font-bold">{exercise.reps}</span>
                        </div>
                        <div className="bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800/50">
                          <span className="text-zinc-500 mr-2">Peso:</span>
                          <span className="text-emerald-400 font-bold">{exercise.weight}kg</span>
                        </div>
                        <div className="bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800/50">
                          <span className="text-zinc-500 mr-2">Recupero:</span>
                          <span className="text-emerald-400 font-bold">{exercise.rest}s</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={`shrink-0 border-l border-zinc-800 bg-zinc-900 transition-all duration-300 ${isCoachOpen ? 'w-full lg:w-[400px]' : 'w-[72px]'}`}>
          {isCoachOpen ? (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b border-zinc-800 bg-zinc-950/50 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <Bot className="w-5 h-5 text-emerald-400" />
                    AI Coach Analysis
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Chiedi confronti su passo, bpm, zone, cadenza o anomalie del workout.
                  </p>
                </div>
                {isThinkerModeEnabled && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sky-300">
                    <Brain className="h-3 w-3" />
                    Thinker
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setIsCoachOpen(false)}
                  className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors"
                  aria-label="Chiudi AI Coach"
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      message.role === 'user' ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-emerald-400'
                    }`}>
                      {message.role === 'user' ? <Activity className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl p-3 ${
                      message.role === 'user'
                        ? 'bg-emerald-500 text-zinc-950 rounded-tr-none'
                        : 'bg-zinc-800 text-zinc-200 rounded-tl-none'
                    }`}>
                      {message.role === 'user' ? (
                        <p className="text-sm font-medium">{message.content}</p>
                      ) : (
                        <div className="text-sm prose prose-invert max-w-none prose-p:leading-relaxed prose-p:my-2 prose-headings:text-white prose-headings:tracking-tight prose-ul:my-2 prose-li:my-0 prose-strong:text-white prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-700">
                          {isScienceBacked(message.content) && (
                            <div className="not-prose mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-200">
                              <FlaskConical className="h-3 w-3" />
                              Science-backed
                            </div>
                          )}
                          <ReactMarkdown>{formatAssistantMarkdown(message.content)}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isAnalyzing && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 text-emerald-400 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="bg-zinc-800 rounded-2xl rounded-tl-none p-4">
                      {isThinkerModeEnabled && (
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sky-300">
                          <Brain className="h-3 w-3" />
                          Thinker attivo
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                        <span className="text-sm text-zinc-400">Analisi in corso...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 border-t border-zinc-800 bg-zinc-950">
                <form onSubmit={handleSendMessage} className="relative">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Es. dimmi se sono partito troppo forte"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-4 pr-22 py-3 text-white text-sm focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none transition-all"
                    disabled={isAnalyzing}
                  />
                  <button
                    type="button"
                    onClick={handleToggleListening}
                    disabled={!isSpeechSupported || isAnalyzing}
                    className={`absolute right-12 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors ${
                      isListening
                        ? 'bg-rose-500 text-white hover:bg-rose-400'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                    } disabled:bg-zinc-800 disabled:text-zinc-600`}
                    aria-label={isListening ? 'Ferma microfono' : 'Attiva microfono'}
                    title={isSpeechSupported ? (isListening ? 'Ferma dettatura' : 'Parla con il microfono') : 'Riconoscimento vocale non supportato'}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <button
                    type="submit"
                    disabled={!input.trim() || isAnalyzing}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 rounded-lg transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
                {isListening && (
                  <div className="mt-3 text-center text-xs text-sky-300">
                    Microfono attivo. Sto trascrivendo quello che dici.
                  </div>
                )}
                {speechError && (
                  <div className="mt-3 text-center text-xs text-rose-300">
                    Riconoscimento vocale non riuscito: {speechError}.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-between py-4 bg-zinc-950/60">
              <button
                type="button"
                onClick={() => setIsCoachOpen(true)}
                className="p-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-emerald-400 hover:text-white hover:border-zinc-700 transition-colors"
                aria-label="Apri AI Coach"
              >
                <PanelRightOpen className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setIsCoachOpen(true)}
                className="flex flex-col items-center gap-3 text-zinc-400 hover:text-white transition-colors"
                aria-label="Apri AI Coach"
              >
                <span className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400">
                  <Bot className="w-5 h-5" />
                </span>
                <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] uppercase tracking-[0.32em]">
                  AI Coach
                </span>
              </button>
              <div className="w-10 h-10 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-500">
                <Send className="w-4 h-4" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
