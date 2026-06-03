import React from 'react';
import { Users } from 'lucide-react';
import { ActivePage } from '../types';

interface PelangganScreenProps {
  openCustomerId?: string | null;
  onNavigate: (page: ActivePage) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PelangganScreen({ openCustomerId, onNavigate, showToast }: PelangganScreenProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
      </div>
      <p className="text-gray-400 text-sm">Coming soon... openCustomerId={openCustomerId ?? 'none'}</p>
    </div>
  );
}
