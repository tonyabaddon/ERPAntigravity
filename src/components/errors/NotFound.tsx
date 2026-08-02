// src/components/errors/NotFound.tsx
//
// 404 screen for unknown routes. App.tsx's render switch previously
// returned null on unrecognized `activePage`, giving users a blank page.
// This screen tells them the URL is wrong and offers a way back.
import React from 'react';
import { Compass } from 'lucide-react';

interface Props {
  /** The unrecognized route/screen the user landed on, for context. */
  attempted?: string | null;
  /** Called when the user clicks the "return home" button. */
  onGoHome: () => void;
}

export const NotFound: React.FC<Props> = ({ attempted, onGoHome }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded shadow p-6 text-center" data-testid="not-found">
      <Compass className="mx-auto text-slate-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Halaman tidak ditemukan</h1>
      <p className="text-sm text-slate-600 mt-2">
        {attempted ? (
          <>
            Alamat <code className="bg-slate-100 px-1 rounded break-all">{attempted}</code>{' '}
            tidak dikenali.
          </>
        ) : (
          'URL yang Anda kunjungi tidak dikenali.'
        )}
      </p>
      <button
        onClick={onGoHome}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold"
        data-testid="not-found-home"
      >
        Kembali ke Dashboard
      </button>
    </div>
  </div>
);
