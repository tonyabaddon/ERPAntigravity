// src/components/errors/TenantBootstrapError.tsx
import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { code: string; onRetry: () => void; }

export const TenantBootstrapError: React.FC<Props> = ({ code, onRetry }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
      <AlertTriangle className="mx-auto text-amber-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Gagal memuat tenant</h1>
      <p className="text-sm text-slate-600 mt-2">Kode: <code className="bg-slate-100 px-1 rounded">{code}</code></p>
      <button onClick={onRetry}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800">
        Coba lagi
      </button>
    </div>
  </div>
);
