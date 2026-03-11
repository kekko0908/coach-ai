import React, { useEffect, useState } from 'react';
import {
    BookOpen,
    Search,
    FlaskConical,
    FileText,
    Bookmark,
    ExternalLink,
    Library,
    Sparkles,
    Quote
} from 'lucide-react';
import { SCIENCE_INSIGHTS } from '../data/science/insights';
import { getAllRagDocuments, getRagLibraryStats } from '../utils/retrieval';
import { RagDocument } from '../types/rag';
import { ScienceInsight } from '../types/science';

function InsightCard({ insight }: { insight: ScienceInsight }) {
    return (
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-900/40 p-6 transition-all hover:border-amber-500/30 hover:bg-zinc-900/60">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-amber-500/5 blur-2xl transition-all group-hover:bg-amber-500/10" />

            <div>
                <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-200">
                        <FlaskConical className="h-3 w-3" />
                        Curated Science
                    </span>
                    <span className="text-xs font-medium text-zinc-500">{insight.year}</span>
                </div>

                <h3 className="mb-3 text-lg font-bold leading-snug text-white group-hover:text-amber-100">
                    {insight.title}
                </h3>

                <p className="mb-4 text-sm leading-relaxed text-zinc-400">
                    {insight.whyRelevant}
                </p>

                <div className="mb-4 space-y-2 rounded-xl bg-zinc-950/50 p-4 border border-zinc-800/50">
                    <div className="flex items-start gap-2">
                        <Quote className="h-3 w-3 mt-1 text-amber-500 shrink-0" />
                        <p className="text-xs text-zinc-300 italic">{insight.takeaways[0]}</p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 mt-auto">
                {insight.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-[10px] text-zinc-600 uppercase tracking-wider border border-zinc-800 px-2 py-1 rounded-lg">
                        {tag}
                    </span>
                ))}
            </div>
        </div>
    );
}

function DocumentCard({ doc }: { doc: RagDocument }) {
    return (
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-900/40 p-6 transition-all hover:border-sky-500/30 hover:bg-zinc-900/60">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-sky-500/5 blur-2xl transition-all group-hover:bg-sky-500/10" />

            <div>
                <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-sky-200">
                        <FileText className="h-3 w-3" />
                        Local Paper
                    </span>
                    <span className="text-xs font-medium text-zinc-500">PDF</span>
                </div>

                <h3 className="mb-2 text-base font-bold leading-snug text-white group-hover:text-sky-100 line-clamp-2">
                    {doc.title}
                </h3>

                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
                    <span>{doc.chunkCount} chunks</span>
                    <span>•</span>
                    <span>{doc.pageCount} pagine</span>
                </div>
            </div>

            <div className="flex items-center justify-between mt-auto pt-4 border-t border-zinc-800/50">
                <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[150px]">
                    {doc.sourceFile}
                </span>
                <Bookmark className="h-4 w-4 text-zinc-600 group-hover:text-sky-400 transition-colors" />
            </div>
        </div>
    );
}

export default function ScienceLibrary() {
    const [documents, setDocuments] = useState<RagDocument[]>([]);
    const [stats, setStats] = useState<{ documents: number; chunks: number } | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        getAllRagDocuments().then(setDocuments);
        getRagLibraryStats().then(s => setStats(s));
    }, []);

    const filteredInsights = SCIENCE_INSIGHTS.filter(i =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        i.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
    );

    const filteredDocs = documents.filter(d =>
        d.title.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-zinc-950 text-white p-6 lg:p-10">
            <div className="max-w-[1600px] mx-auto space-y-10">

                {/* Magazine Header */}
                <header className="flex flex-col gap-6 md:flex-row md:items-end justify-between border-b border-zinc-800 pb-8">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-400 uppercase tracking-widest">
                            <Library className="w-3 h-3" />
                            FitSync Research
                        </div>
                        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
                            Science <span className="text-zinc-500">Library</span>
                        </h1>
                        <p className="text-lg text-zinc-400 max-w-2xl">
                            Una raccolta curata di paper scientifici e analisi AI per supportare le tue decisioni di allenamento con evidenze reali.
                        </p>
                    </div>

                    {/* Stats Badges */}
                    <div className="flex gap-4">
                        <div className="flex flex-col items-end">
                            <span className="text-3xl font-bold text-white">{SCIENCE_INSIGHTS.length}</span>
                            <span className="text-xs text-zinc-500 uppercase tracking-wider">Curated Insights</span>
                        </div>
                        <div className="w-px bg-zinc-800 h-10"></div>
                        <div className="flex flex-col items-end">
                            <span className="text-3xl font-bold text-white">{stats?.documents || 0}</span>
                            <span className="text-xs text-zinc-500 uppercase tracking-wider">Local Papers</span>
                        </div>
                    </div>
                </header>

                {/* Controls */}
                <div className="flex items-center gap-4 sticky top-4 z-20 backdrop-blur-md py-4 -my-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                            type="text"
                            placeholder="Cerca per titolo, tag o argomento..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-zinc-900/80 border border-zinc-800 text-white rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder:text-zinc-600 shadow-xl"
                        />
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="space-y-12">

                    {/* Section: Featured Insights */}
                    <section>
                        <div className="flex items-center gap-3 mb-6">
                            <Sparkles className="w-5 h-5 text-amber-500" />
                            <h2 className="text-xl font-bold text-white">In Evidenza</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredInsights.map(insight => (
                                <InsightCard key={insight.id} insight={insight} />
                            ))}
                        </div>
                    </section>

                    {/* Section: Local Library (RAG) */}
                    {filteredDocs.length > 0 && (
                        <section>
                            <div className="flex items-center gap-3 mb-6">
                                <BookOpen className="w-5 h-5 text-sky-500" />
                                <h2 className="text-xl font-bold text-white">Paper Analizzati (RAG)</h2>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-6">
                                {filteredDocs.map(doc => (
                                    <DocumentCard key={doc.id} doc={doc} />
                                ))}
                            </div>
                        </section>
                    )}

                    {filteredDocs.length === 0 && filteredInsights.length === 0 && (
                        <div className="py-20 text-center">
                            <p className="text-zinc-500">Nessun documento trovato per "{search}"</p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}