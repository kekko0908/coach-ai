import React, { useState, useEffect } from 'react';
import {
    User,
    Settings,
    Target,
    Heart,
    Save,
    Weight,
    Moon,
    Footprints,
    ChevronDown,
    Activity
} from 'lucide-react';
import { UserProfile } from '../types';
import { hydrateProfileFromSupabase } from '../lib/supabase/profileRepository';

// Helper per le zone cardio
const calculateZones = (maxHr: number) => [
    { name: 'Z1', range: '50-60%', min: Math.round(maxHr * 0.5), color: 'bg-zinc-500' },
    { name: 'Z2', range: '60-70%', min: Math.round(maxHr * 0.6), color: 'bg-emerald-500' },
    { name: 'Z3', range: '70-80%', min: Math.round(maxHr * 0.7), color: 'bg-amber-500' },
    { name: 'Z4', range: '80-90%', min: Math.round(maxHr * 0.8), color: 'bg-orange-500' },
    { name: 'Z5', range: '90-100%', min: Math.round(maxHr * 0.9), color: 'bg-rose-500' },
];

export default function ProfileScreen() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    // Local state for form handling
    const [formData, setFormData] = useState<UserProfile | null>(null);

    useEffect(() => {
        // Load profile on mount
        hydrateProfileFromSupabase().then(p => {
            if (p) {
                setProfile(p);
                setFormData(p);
            }
        });
    }, []);

    if (!profile || !formData) return null;

    const zones = calculateZones(formData.heartRateMax);

    const handleChange = (field: keyof UserProfile, value: any) => {
        setFormData(prev => prev ? ({ ...prev, [field]: value }) : null);
    };

    const handleSave = () => {
        // Qui andrebbe la chiamata a saveProfileToSupabase(formData)
        setProfile(formData);
        setIsEditing(false);
        // Mock alert
        alert("Profilo aggiornato (simulazione locale)");
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-white p-6 lg:p-10">
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Header */}
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-white">Profilo Atleta</h1>
                        <p className="text-zinc-400 mt-1">Gestisci i tuoi parametri fisiologici e obiettivi.</p>
                    </div>
                    <button
                        onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition-all ${isEditing
                                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
                                : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800'
                            }`}
                    >
                        {isEditing ? <Save className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
                        <span>{isEditing ? 'Salva Modifiche' : 'Modifica'}</span>
                    </button>
                </header>

                {/* Bento Grid Form */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* Identity Card */}
                    <div className="md:col-span-2 bg-zinc-900/40 border border-zinc-800 p-8 rounded-[2rem] flex items-center gap-6">
                        <div className="h-24 w-24 rounded-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center border border-zinc-700 shadow-xl">
                            <User className="w-10 h-10 text-zinc-400" />
                        </div>
                        <div className="flex-1 space-y-4">
                            <div>
                                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1 block">Nome Atleta</label>
                                {isEditing ? (
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={e => handleChange('name', e.target.value)}
                                        className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white w-full max-w-xs focus:ring-2 focus:ring-emerald-500/50 outline-none"
                                    />
                                ) : (
                                    <div className="text-2xl font-bold text-white">{profile.name}</div>
                                )}
                            </div>
                            <div className="flex gap-4">
                                <div className="px-4 py-2 bg-zinc-950/50 rounded-xl border border-zinc-800/50">
                                    <span className="text-xs text-zinc-500 block">Split Attuale</span>
                                    <span className="font-medium text-emerald-400">{profile.preferredSplit}</span>
                                </div>
                                <div className="px-4 py-2 bg-zinc-950/50 rounded-xl border border-zinc-800/50">
                                    <span className="text-xs text-zinc-500 block">Giorni/Settimana</span>
                                    <span className="font-medium text-white">{profile.trainingDays} su 7</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Weight Card */}
                    <div className="bg-zinc-900/40 border border-zinc-800 p-6 rounded-[2rem] flex flex-col justify-between relative overflow-hidden">
                        <Weight className="absolute right-6 top-6 w-6 h-6 text-zinc-700" />
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Peso Corporeo</label>
                        <div className="flex items-baseline gap-2 mt-2">
                            {isEditing ? (
                                <input
                                    type="number"
                                    value={formData.weight}
                                    onChange={e => handleChange('weight', parseFloat(e.target.value))}
                                    className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-3xl font-bold text-white w-32 outline-none"
                                />
                            ) : (
                                <span className="text-5xl font-bold text-white tracking-tighter">{profile.weight}</span>
                            )}
                            <span className="text-xl text-zinc-500 font-medium">kg</span>
                        </div>
                    </div>

                    {/* Targets Section */}
                    <div className="bg-zinc-900/40 border border-zinc-800 p-6 rounded-[2rem] flex flex-col justify-center gap-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400"><Moon className="w-5 h-5" /></div>
                                <span className="font-medium">Target Sonno</span>
                            </div>
                            <div className="font-bold text-xl">{formData.targetSleep}h</div>
                        </div>
                        <div className="w-full h-px bg-zinc-800" />
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400"><Footprints className="w-5 h-5" /></div>
                                <span className="font-medium">Target Passi</span>
                            </div>
                            <div className="font-bold text-xl">{formData.targetSteps.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Heart Rate Zones Visualizer */}
                    <div className="md:col-span-2 bg-zinc-900/40 border border-zinc-800 p-8 rounded-[2rem]">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-rose-500" />
                                    Zone Cardiache
                                </h3>
                                <p className="text-sm text-zinc-500 mt-1">Calcolate su FC Max di <span className="text-white font-bold">{formData.heartRateMax} BPM</span></p>
                            </div>
                            {isEditing && (
                                <input type="number" value={formData.heartRateMax} onChange={e => handleChange('heartRateMax', parseInt(e.target.value))} className="bg-zinc-950 border border-zinc-800 px-3 py-1 rounded-lg w-20 text-center" />
                            )}
                        </div>

                        <div className="grid grid-cols-5 gap-2 h-32 items-end">
                            {zones.map((zone) => (
                                <div key={zone.name} className="flex flex-col gap-2 group">
                                    <div className={`w-full rounded-t-xl transition-all hover:opacity-100 opacity-80 ${zone.color}`} style={{ height: zone.name === 'Z2' ? '60%' : zone.name === 'Z5' ? '100%' : '40%' }}></div>
                                    <div className="text-center">
                                        <div className="text-xs font-bold text-white mb-0.5">{zone.name}</div>
                                        <div className="text-[10px] text-zinc-500 font-mono">{zone.min}+</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}