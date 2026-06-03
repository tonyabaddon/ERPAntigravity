import React from 'react';

interface OrderHistoryScreenProps {
  currentUser: { name: string; role: string; avatarUrl: string; storeName: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function OrderHistoryScreen({ currentUser, showToast }: OrderHistoryScreenProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-gray-800">Riwayat Pesanan</h1>
      <p className="text-gray-500">Coming soon...</p>
    </div>
  );
}
