// src/components/GraceBanner.tsx
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';

export const GraceBanner: React.FC = () => {
  const t = useTenant();
  if (t?.expiry_mode !== 'GRACE') return null;

  const daysExpired = Math.max(0, Math.floor((Date.now() - new Date(t.expires_at).getTime()) / 86400000));
  const daysUntilReadonly = Math.max(0, 7 - daysExpired);

  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center gap-2 text-sm">
      <AlertTriangle size={16} />
      <span>
        Subscription expired {daysExpired} hari lalu. Read-only akan aktif dalam {daysUntilReadonly} hari.
      </span>
      <a href="https://wa.me/62..." className="ml-auto underline font-medium">Renew sekarang</a>
    </div>
  );
};
