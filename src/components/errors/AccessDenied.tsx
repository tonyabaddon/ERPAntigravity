// src/components/errors/AccessDenied.tsx
import React from 'react';
import { Lock } from 'lucide-react';

interface Props { onLogout: () => void; }

export const AccessDenied: React.FC<Props> = ({ onLogout }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-sm shadow p-6 text-center">
      <Lock className="mx-auto text-rose-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Akses ditolak</h1>
      <p className="text-sm text-slate-600 mt-2">
        Akun Anda tidak terdaftar sebagai anggota tenant ini.
      </p>
      <button onClick={onLogout}
        className="mt-6 w-full px-4 py-2 bg-slate-900 text-white rounded hover:bg-slate-800">
        Logout
      </button>
    </div>
  </div>
);
