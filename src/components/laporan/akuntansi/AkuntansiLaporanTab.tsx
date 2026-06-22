import React, { useState } from 'react';
import { List, TrendingUp, Layout, Droplet } from 'lucide-react';
import MutasiTab from './MutasiTab';
import LabaRugiTab from './LabaRugiTab';
import NeracaTab from './NeracaTab';
import CashFlowTab from './CashFlowTab';

export interface AkuntansiLaporanTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type AkuntansiSubTab = 'mutasi' | 'laba-rugi' | 'neraca' | 'cash-flow';

const subtabs: Array<{ key: AkuntansiSubTab; label: string; icon: React.ComponentType<{ className: string }> }> = [
  { key: 'mutasi', label: 'Mutasi', icon: List },
  { key: 'laba-rugi', label: 'Laba Rugi', icon: TrendingUp },
  { key: 'neraca', label: 'Neraca', icon: Layout },
  { key: 'cash-flow', label: 'Cash Flow', icon: Droplet },
];

export default function AkuntansiLaporanTab(props: AkuntansiLaporanTabProps): React.ReactElement {
  const [activeSubTab, setActiveSubTab] = useState<AkuntansiSubTab>('laba-rugi');

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Sub-tab navigation — pill-style buttons */}
      <div className="card p-4 flex items-center gap-2 overflow-x-auto bg-white rounded-3xl shadow-sm border border-[#c7d7f5]">
        {subtabs.map(t => {
          const IconComponent = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActiveSubTab(t.key)}
              className={`px-4 py-2.5 rounded-full text-[13px] font-bold transition-all inline-flex items-center gap-1.5 shrink-0 ${
                activeSubTab === t.key
                  ? 'bg-[#012749] text-white'
                  : 'border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff]'
              }`}
            >
              <IconComponent className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Mutasi Tab */}
      {activeSubTab === 'mutasi' && (
        <MutasiTab showToast={props.showToast} />
      )}

      {/* Laba Rugi Tab */}
      {activeSubTab === 'laba-rugi' && (
        <LabaRugiTab showToast={props.showToast} />
      )}

      {/* Neraca Tab */}
      {activeSubTab === 'neraca' && (
        <NeracaTab showToast={props.showToast} />
      )}

      {/* Cash Flow Tab */}
      {activeSubTab === 'cash-flow' && (
        <CashFlowTab showToast={props.showToast} />
      )}
    </div>
  );
}
