import React from 'react';
import { DbAdminUser } from '../types';

interface KasirScreenProps {
  currentUser: DbAdminUser | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function KasirScreen({ currentUser, showToast }: KasirScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <p className="text-gray-500 text-sm">Kasir — coming soon</p>
    </div>
  );
}
