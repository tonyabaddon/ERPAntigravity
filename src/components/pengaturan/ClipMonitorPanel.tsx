import React, { useEffect, useState } from 'react';
import { fetchTodayInferenceRows, aggregateInferenceRows, type InferenceAggregate } from '../../lib/clipMonitorService';

export default function ClipMonitorPanel() {
  const [agg, setAgg] = useState<InferenceAggregate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchTodayInferenceRows();
        if (cancelled) return;
        setAgg(aggregateInferenceRows(rows));
      } catch {
        // silent fail — table may not have data yet
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm text-sm text-slate-500">Memuat data inference…</div>;
  }
  if (!agg) return null;

  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
      <h3 className="text-base font-extrabold text-[#012749] mb-3">Aktivitas CLIP Inference — Hari Ini</h3>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-4 text-[11px] text-[#012749]">
        ℹ️ CLIP berjalan di server kita. Angka di bawah adalah jumlah inference hari ini. Tidak ada quota eksternal — kapasitas dibatasi oleh CPU instance Cloud Run.
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">Search Kasir</p>
          <p className="text-2xl font-black text-emerald-900 mt-1">{agg.search.success + agg.search.error + agg.search.coldStart}</p>
          <div className="flex gap-3 mt-1.5 text-[10.5px]">
            <span className="text-emerald-700"><strong>{agg.search.success}</strong> success</span>
            <span className="text-rose-700"><strong>{agg.search.error}</strong> error</span>
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-blue-700">Indexing Upload</p>
          <p className="text-2xl font-black text-blue-900 mt-1">{agg.index.success + agg.index.error + agg.index.coldStart}</p>
          <div className="flex gap-3 mt-1.5 text-[10.5px]">
            <span className="text-blue-700"><strong>{agg.index.success}</strong> success</span>
            <span className="text-slate-500"><strong>{agg.index.error}</strong> error</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Latency p50</p>
          <p className="text-lg font-black text-[#012749] mt-1">{agg.latencyP50 != null ? `${agg.latencyP50} ms` : '—'}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Latency p95</p>
          <p className="text-lg font-black text-[#012749] mt-1">{agg.latencyP95 != null ? `${agg.latencyP95} ms` : '—'}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700">Cold start hit</p>
          <p className="text-lg font-black text-amber-900 mt-1">{agg.search.coldStart + agg.index.coldStart} ×</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-amber-700 mb-1">Sinyal kapan tindak lanjut</p>
        <ul className="text-[11px] text-amber-900 list-disc ml-5 space-y-0.5">
          <li>Latency p95 &gt; 3 detik konsisten → mungkin perlu bump CPU 1→2 vCPU di Cloud Run.</li>
          <li>Cold start &gt; 5/hari → instance terlalu sering scale-to-zero. Evaluasi keep-warm.</li>
          <li>Akurasi &lt; 80% top-1 (smoke test) → eval Hybrid path, spec terpisah.</li>
        </ul>
      </div>

      {agg.lastErrorAt && (
        <p className="text-[10.5px] text-slate-500 italic mt-3">Last error: {new Date(agg.lastErrorAt).toLocaleString('id-ID')}</p>
      )}
    </div>
  );
}
