// src/components/errors/TenantSuspended.tsx
import React from 'react';
import { ShieldAlert } from 'lucide-react';

interface Props { onLogout: () => void; }

export const TenantSuspended: React.FC<Props> = ({ onLogout }) => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
      <ShieldAlert className="mx-auto text-amber-500" size={48} />
      <h1 className="text-lg font-semibold mt-4">Akun tenant dihentikan</h1>
      <p className="text-sm text-slate-600 mt-2">
        Akun tenant ini sedang di-suspend. Silakan hubungi Caleo support.
      </p>
      <a href="https://wa.me/62..." className="mt-6 block px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-500">
        Chat WhatsApp support
      </a>
      <button onClick={onLogout} className="mt-3 w-full px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
        Logout
      </button>
    </div>
  </div>
);
