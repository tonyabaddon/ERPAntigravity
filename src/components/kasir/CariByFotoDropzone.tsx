import React, { useState } from 'react';

interface Props {
  onFileSelected: (file: File) => void;
  onError: (msg: string) => void;
}

export default function CariByFotoDropzone({ onFileSelected, onError }: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files: File[] = Array.from(e.dataTransfer.files as ArrayLike<File>);
    if (files.length === 0) return;
    if (files.length > 1) {
      onError('Cuma 1 foto per search. Ambil yang pertama.');
    }
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      onError('Hanya foto yang didukung.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onError('File terlalu besar. Max 5MB.');
      return;
    }
    onFileSelected(file);
  };

  return (
    <button
      type="button"
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`w-full rounded-sm p-5 text-left transition-colors border-2 border-dashed ${
        isDragging ? 'bg-violet-100 border-violet-500' : 'bg-violet-50/50 border-violet-300 hover:bg-violet-100'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-violet-200 rounded-sm flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-3xl text-violet-800">cloud_upload</span>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-violet-700">Opsi 3 · BARU</p>
          <h4 className="text-sm font-extrabold text-violet-900 mt-0.5">
            {isDragging ? 'Lepas foto di sini' : 'Tarik &amp; lepas foto ke sini'}
          </h4>
          <p className="text-[11px] text-violet-800 mt-1 leading-snug">Drag foto langsung dari File Explorer / Finder.</p>
        </div>
      </div>
    </button>
  );
}
