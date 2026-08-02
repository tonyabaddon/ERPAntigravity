// src/components/errors/TenantNotFound.tsx
import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props { slug?: string | null; onBackToLogin: () => void; }

export const TenantNotFound: React.FC<Props> = ({ slug, onBackToLogin }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded shadow p-6 text-center">
      <AlertCircle className="mx-auto text-rose-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Tenant tidak ditemukan</h1>
      <p className="text-sm text-slate-600 mt-2">
        {slug ? <>Alamat <code className="bg-slate-100 px-1 rounded">/t/{slug}</code> tidak terdaftar di Caleo.</> :
                'URL tidak mengarah ke tenant yang valid.'}
      </p>
      <button onClick={onBackToLogin}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800">
        Kembali ke login
      </button>
    </div>
  </div>
);
