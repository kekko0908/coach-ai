import React, { useEffect, useState } from 'react';
import { Atom, BookOpen, Brain, FlaskConical, Sparkles } from 'lucide-react';
import { getRagLibraryStats } from '../utils/retrieval';
import {
  getScienceAreaLabel,
  getScienceInsights,
  getScienceLibraryStats,
  getScienceShortlistLabel,
  getScienceShortlists,
} from '../utils/scienceInsights';

function shortlistTone(shortlist: 'read_now' | 'useful_after' | 'optional') {
  if (shortlist === 'read_now') {
    return {
      card: 'border-rose-400/25 bg-rose-500/[0.08]',
      badge: 'border-rose-300/20 bg-rose-400/10 text-rose-200',
      accent: 'text-rose-300',
    };
  }

  if (shortlist === 'useful_after') {
    return {
      card: 'border-amber-300/20 bg-amber-400/[0.08]',
      badge: 'border-amber-300/20 bg-amber-400/10 text-amber-100',
      accent: 'text-amber-200',
    };
  }

  return {
    card: 'border-sky-300/20 bg-sky-400/[0.08]',
    badge: 'border-sky-300/20 bg-sky-400/10 text-sky-100',
    accent: 'text-sky-200',
  };
}

export default function Science() {
  const scienceStats = getScienceLibraryStats();
  const shortlists = getScienceShortlists();
  const insights = getScienceInsights();
  const [ragStats, setRagStats] = useState({
    documents: 0,
    chunks: 0,
    chunksWithEmbeddings: 0,
    hasEmbeddings: false,
    generatedAt: '',
  });

  useEffect(() => {
    let isMounted = true;

    void getRagLibraryStats().then((stats) => {
      if (isMounted) {
        setRagStats(stats);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const sections: Array<{
    id: 'read_now' | 'useful_after' | 'optional';
    title: string;
    subtitle: string;
    items: ReturnType<typeof getScienceShortlists>['readNow'];
  }> = [
    {
      id: 'read_now',
      title: 'Da leggere subito',
      subtitle: 'I pilastri operativi da cui far partire programmazione, nutrizione e recupero.',
      items: shortlists.readNow,
    },
    {
      id: 'useful_after',
      title: 'Utile dopo',
      subtitle: 'Rifiniture importanti quando il sistema base e gia stabile.',
      items: shortlists.usefulAfter,
    },
    {
      id: 'optional',
      title: 'Piu teorici',
      subtitle: 'Materiale utile per approfondire il razionale dietro le decisioni.',
      items: shortlists.optional,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-10">
        <section className="relative overflow-hidden rounded-[32px] border border-zinc-800 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.14),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_28%),linear-gradient(180deg,_rgba(24,24,27,0.92),_rgba(9,9,11,1))] p-8 shadow-[0_30px_120px_rgba(0,0,0,0.35)]">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(255,255,255,0.03)_35%,transparent_70%)]" />
          <div className="relative grid gap-8 xl:grid-cols-[1.35fr_0.95fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-amber-200">
                <FlaskConical className="h-3.5 w-3.5" />
                Science Layer
              </div>
              <h1 className="mt-5 max-w-3xl font-serif text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Libreria scientifica leggibile, filtrata e pronta per il coach.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-300 sm:text-base">
                Questa vista raccoglie gli studi gia distillati in takeaway pratici, le shortlist strategiche e lo stato del RAG locale.
                Serve per capire da dove arrivano le decisioni del coach, non solo cosa dice.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[24px] border border-zinc-800 bg-black/20 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Insight curati</span>
                  <BookOpen className="h-4 w-4 text-amber-300" />
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{scienceStats.total}</div>
                <p className="mt-2 text-sm text-zinc-400">{scienceStats.highPriority} ad alta priorita su {scienceStats.areas} aree.</p>
              </div>
              <div className="rounded-[24px] border border-zinc-800 bg-black/20 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">RAG papers</span>
                  <Atom className="h-4 w-4 text-sky-300" />
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{ragStats.documents}</div>
                <p className="mt-2 text-sm text-zinc-400">{ragStats.chunks} chunk indicizzati, {ragStats.chunksWithEmbeddings} con embeddings.</p>
              </div>
              <div className="rounded-[24px] border border-zinc-800 bg-black/20 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Modalita retrieval</span>
                  <Brain className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="mt-3 text-lg font-semibold text-white">
                  {ragStats.hasEmbeddings ? 'Embedding + lexical' : 'Lexical fallback'}
                </div>
                <p className="mt-2 text-sm text-zinc-400">
                  {ragStats.hasEmbeddings ? 'Il ranking usa vettori e segnali lessicali.' : 'Carica un embedding model per passare alla v2.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-3">
          {sections.map((section) => {
            const tone = shortlistTone(section.id);
            return (
              <div key={section.id} className={`rounded-[28px] border p-6 ${tone.card}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${tone.badge}`}>
                      {section.title}
                    </div>
                    <h2 className="mt-4 text-2xl font-semibold text-white">{section.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{section.subtitle}</p>
                  </div>
                  <Sparkles className={`mt-1 h-5 w-5 shrink-0 ${tone.accent}`} />
                </div>

                <div className="mt-6 space-y-4">
                  {section.items.map((insight) => (
                    <article key={insight.id} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          {getScienceAreaLabel(insight.area)}
                        </span>
                        <span className="text-xs text-zinc-400">{insight.year}</span>
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-white">{insight.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">{insight.whyRelevant}</p>
                      <div className="mt-4 space-y-2">
                        {insight.takeaways.slice(0, 2).map((takeaway) => (
                          <div key={takeaway} className="flex gap-2 text-sm text-zinc-200">
                            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${section.id === 'read_now' ? 'bg-rose-300' : section.id === 'useful_after' ? 'bg-amber-200' : 'bg-sky-200'}`} />
                            <span>{takeaway}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400">
                        {insight.sourceLabel}: {insight.sourceReference}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-8 rounded-[30px] border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Catalogo fonti</div>
              <h2 className="mt-2 text-2xl font-semibold text-white">Tutte le fonti curate</h2>
            </div>
            <p className="max-w-2xl text-sm text-zinc-400">
              Questa tabella e il riferimento da cui il coach pesca gli insight scientifici. Le shortlist sopra servono a filtrare l ordine di lettura; qui hai tutto.
            </p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {insights.map((insight) => (
              <article key={insight.id} className="rounded-[24px] border border-zinc-800 bg-zinc-950/90 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                    {getScienceAreaLabel(insight.area)}
                  </span>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-300">
                    {getScienceShortlistLabel(insight.shortlist)}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">{insight.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">
                  {insight.year} · {insight.studyType}
                </p>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{insight.whyRelevant}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {insight.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
                  {insight.sourceLabel}: {insight.sourceReference}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
