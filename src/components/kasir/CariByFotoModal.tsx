import React, { useRef, useState } from 'react';
import { compressImage } from '../../lib/productPhotoService';
import { searchByPhoto, type SearchResult } from '../../lib/cariByFotoService';
import CariByFotoDropzone from './CariByFotoDropzone';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResults: (results: SearchResult[], queryBlob: Blob, filename?: string) => void;
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
}

export default function CariByFotoModal({ isOpen, onClose, onResults, showToast }: Props) {
  const [isSearching, setIsSearching] = useState(false);
  const [coldStart, setColdStart] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const runSearch = async (file: File) => {
    setIsSearching(true);
    const coldTimer = setTimeout(() => setColdStart(true), 1000);
    try {
      const { blob } = await compressImage(file);
      const { results } = await searchByPhoto(blob);
      clearTimeout(coldTimer);
      setColdStart(false);
      onResults(results, blob, file.name);
      onClose();
    } catch (e) {
      clearTimeout(coldTimer);
      const msg = (e as Error).message;
      if (msg.includes('503') || msg.includes('cold')) {
        showToast('AI tidak siap, coba lagi atau cari via teks.', 'warning');
      } else {
        showToast(`Search gagal: ${msg}`, 'warning');
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded max-w-2xl w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-caleo-10 font-extrabold text-emerald-700 uppercase tracking-widest">Cari Produk via Foto</p>
            <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)] mt-0.5">Pilih sumber foto produk</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center">
            <span className="material-symbols-outlined text-base text-slate-600">close</span>
          </button>
        </div>
        {coldStart && (
          <div className="bg-amber-50 border border-amber-300 rounded p-4 mb-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-800 animate-spin">progress_activity</span>
              <div>
                <h4 className="text-sm font-extrabold text-amber-900">⏱️ Menyiapkan AI… 5 detik</h4>
                <p className="text-caleo-11 text-amber-800 mt-1">CLIP model lagi di-load. Search berikutnya akan langsung cepat.</p>
              </div>
            </div>
          </div>
        )}
        {isSearching && !coldStart && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-center text-xs text-[var(--color-caleo-primary)] font-bold">Mencari…</div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            onClick={() => camRef.current?.click()}
            disabled={isSearching}
            className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded p-5 text-left disabled:opacity-50">
            <div className="w-12 h-12 bg-emerald-200 rounded flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-2xl text-emerald-800">photo_camera</span>
            </div>
            <p className="text-caleo-10 font-extrabold uppercase text-emerald-700">Opsi 1</p>
            <h4 className="text-sm font-extrabold text-emerald-900 mt-0.5">Pakai Kamera</h4>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void runSearch(f); }} />
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isSearching}
            className="bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded p-5 text-left disabled:opacity-50">
            <div className="w-12 h-12 bg-blue-200 rounded flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-2xl text-blue-800">folder_open</span>
            </div>
            <p className="text-caleo-10 font-extrabold uppercase text-blue-700">Opsi 2</p>
            <h4 className="text-sm font-extrabold text-blue-900 mt-0.5">Upload File</h4>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void runSearch(f); }} />
          </button>
        </div>
        <CariByFotoDropzone
          onFileSelected={runSearch}
          onError={msg => showToast(msg, 'warning')}
        />
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded p-3 text-caleo-11 text-amber-900">
          💡 Foto produk dari angle depan / label paling jelas memberi hasil paling akurat.
        </div>
      </div>
    </div>
  );
}
