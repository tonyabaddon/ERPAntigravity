// src/components/ReadonlyBanner.tsx
import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';

export const ReadonlyBanner: React.FC = () => {
  const t = useTenant();
  const isReadOnly = t?.expiry_mode === 'READONLY';

  useEffect(() => {
    document.body.classList.toggle('tenant-readonly', !!isReadOnly);
    return () => document.body.classList.remove('tenant-readonly');
  }, [isReadOnly]);

  if (!isReadOnly || !t) return null;

  const daysExpired = Math.max(0, Math.floor((Date.now() - new Date(t.expires_at).getTime()) / 86400000));

  return (
    <div className="bg-rose-100 border-b border-rose-300 text-rose-900 px-4 py-3 flex items-center gap-2 text-sm">
      <AlertCircle size={18} />
      <span>
        <strong>Subscription VOSI kamu expired {daysExpired} hari lalu.</strong> Mode read-only aktif.
      </span>
      <a href="https://wa.me/62..." className="ml-auto underline font-medium">Hubungi untuk renew</a>
    </div>
  );
};
