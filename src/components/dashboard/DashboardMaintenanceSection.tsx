import React, { useEffect, useState } from 'react';
import { CheckCircle2, DollarSign, TrendingDown, Package, MessageSquare } from 'lucide-react';
import MaintenanceCard from './MaintenanceCard';
import { getDashboardMaintenanceCounts } from '../../lib/dashboardReports/api';
import type { MaintenanceCounts } from '../../lib/dashboardReports/types';
import { formatIDR } from '../../lib/formatIDR';
import { categoryCounts } from '../../lib/salesInboxCategorize';
import { conversationService } from '../../lib/supabaseClient';
import { captureError } from '../../lib/captureError';

interface Props {
  onNavigate: (screen: string) => void;
}

export default function DashboardMaintenanceSection({ onNavigate }: Props) {
  const [counts, setCounts] = useState<MaintenanceCounts | null>(null);
  const [inboxCount, setInboxCount] = useState<number>(0);

  useEffect(() => {
    getDashboardMaintenanceCounts()
      .then(setCounts)
      .catch((err) => {
        captureError(err, { feature: 'dashboard', action: 'fetch_maintenance_counts' });
        setCounts({
          approval_pending: 0,
          piutang_overdue_count: 0, piutang_overdue_sum: 0,
          hutang_overdue_count: 0, hutang_overdue_sum: 0,
          fulfillment_queue_count: 0,
        });
      });
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchInbox() {
      try {
        const convs = await conversationService.fetchConversations();
        if (!mounted) return;
        const cc = categoryCounts(convs);
        setInboxCount(cc.butuhAksi);
      } catch (err) {
        captureError(err, { feature: 'dashboard', action: 'fetch_inbox_count' });
      }
    }
    void fetchInbox();
    return () => { mounted = false; };
  }, []);

  if (!counts) return null;

  const anyVisible =
    counts.approval_pending > 0 ||
    counts.piutang_overdue_count > 0 ||
    counts.hutang_overdue_count > 0 ||
    counts.fulfillment_queue_count > 0 ||
    inboxCount > 0;

  if (!anyVisible) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <MaintenanceCard
        icon={<CheckCircle2 className="w-5 h-5" />}
        title="Persetujuan pending"
        count={counts.approval_pending}
        detail={`${counts.approval_pending} permintaan menunggu approval`}
        ctaLabel="Buka Inbox"
        onCta={() => onNavigate('persetujuan')}
        badgeVariant="amber"
      />
      <MaintenanceCard
        icon={<DollarSign className="w-5 h-5" />}
        title="Piutang overdue"
        count={counts.piutang_overdue_count}
        detail={`${counts.piutang_overdue_count} faktur · ${formatIDR(counts.piutang_overdue_sum)}`}
        ctaLabel="Buka Piutang"
        onCta={() => onNavigate('piutang')}
        badgeVariant="rose"
      />
      <MaintenanceCard
        icon={<TrendingDown className="w-5 h-5" />}
        title="Hutang supplier overdue"
        count={counts.hutang_overdue_count}
        detail={`${counts.hutang_overdue_count} tagihan · ${formatIDR(counts.hutang_overdue_sum)}`}
        ctaLabel="Buka Tagihan"
        onCta={() => onNavigate('pembelian')}
        badgeVariant="rose"
      />
      <MaintenanceCard
        icon={<Package className="w-5 h-5" />}
        title="Fulfillment antrean"
        count={counts.fulfillment_queue_count}
        detail={`${counts.fulfillment_queue_count} pesanan siap kirim / lunas / WIP`}
        ctaLabel="Buka Daftar Pesanan"
        onCta={() => onNavigate('daftarPesanan')}
        badgeVariant="emerald"
      />
      <MaintenanceCard
        icon={<MessageSquare className="w-5 h-5" />}
        title="Sales Inbox"
        count={inboxCount}
        detail={`${inboxCount} chat butuh aksi`}
        ctaLabel="Buka Sales Inbox"
        onCta={() => onNavigate('sales-inbox')}
        badgeVariant="amber"
      />
    </div>
  );
}
