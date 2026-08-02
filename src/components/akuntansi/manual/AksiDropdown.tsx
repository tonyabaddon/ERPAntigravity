/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  Plus,
  ChevronDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowDown,
  CreditCard,
  Scale,
  Edit,
  ArrowUpCircle,
  ArrowDownCircle,
} from 'lucide-react';
import type { CashAccountBalance } from '../../../lib/kasbank/types';

/**
 * Union type of all possible actions that can be triggered from the dropdown.
 */
export type AksiAction =
  | 'transfer'         // Transfer Internal (BANK only)
  | 'setor_bank'       // Setor ke Bank (KAS only)
  | 'setor_dari_kas'   // Setor dari Kas (BANK only, source = a KAS account)
  | 'tarik_pribadi'    // Owner Drawing (BANK, KAS)
  | 'manual_expense'   // Catat Pengeluaran (BANK, KAS)
  | 'penyesuaian'      // Penyesuaian Saldo PIN (all 3 types)
  | 'wallet_topup'     // Top-Up Wallet (E_WALLET only)
  | 'wallet_spend'     // Catat Spending (E_WALLET only)
  | 'edit_akun';       // Edit Akun (all 3)

/**
 * Props for AksiDropdown component.
 */
export interface AksiDropdownProps {
  account: CashAccountBalance;
  onAction: (action: AksiAction) => void;
}

/**
 * MenuItem definition: label, icon, action, and styling.
 */
interface MenuItem {
  label: string;
  icon: React.ReactNode;
  action: AksiAction;
  /** bg color on hover: 'blue-50' | 'rose-50' | 'gray-50' */
  hoverBg: string;
  /** text color: 'on-surface' (default) | 'rose-700' (special) */
  textColor?: string;
}

/**
 * Context-aware menu items per account_type.
 */
function getMenuItems(accountType: CashAccountBalance['account_type']): MenuItem[] {
  const baseItems: Record<string, MenuItem[]> = {
    BANK: [
      {
        label: 'Transfer Internal',
        icon: <ArrowRightLeft className="w-3.5 h-3.5 text-blue-600" />,
        action: 'transfer',
        hoverBg: 'hover:bg-blue-50',
      },
      {
        label: 'Setor dari Kas',
        icon: <ArrowUp className="w-3.5 h-3.5 text-emerald-600" />,
        action: 'setor_dari_kas',
        hoverBg: 'hover:bg-blue-50',
      },
      {
        label: 'Tarik Pribadi',
        icon: <ArrowDown className="w-3.5 h-3.5 text-slate-600" />,
        action: 'tarik_pribadi',
        hoverBg: 'hover:bg-blue-50',
      },
      {
        label: 'Catat Pengeluaran',
        icon: <CreditCard className="w-3.5 h-3.5 text-rose-600" />,
        action: 'manual_expense',
        hoverBg: 'hover:bg-rose-50',
      },
      // separator (handled in JSX)
      {
        label: 'Penyesuaian (PIN)',
        icon: <Scale className="w-3.5 h-3.5" />,
        action: 'penyesuaian',
        hoverBg: 'hover:bg-rose-50',
        textColor: 'text-rose-700',
      },
      {
        label: 'Edit Akun',
        icon: <Edit className="w-3.5 h-3.5" />,
        action: 'edit_akun',
        hoverBg: 'hover:bg-gray-50',
      },
    ],
    KAS: [
      {
        label: 'Setor ke Bank',
        icon: <ArrowUp className="w-3.5 h-3.5 text-emerald-600" />,
        action: 'setor_bank',
        hoverBg: 'hover:bg-blue-50',
      },
      {
        label: 'Tarik Pribadi',
        icon: <ArrowDown className="w-3.5 h-3.5 text-slate-600" />,
        action: 'tarik_pribadi',
        hoverBg: 'hover:bg-blue-50',
      },
      {
        label: 'Catat Pengeluaran',
        icon: <CreditCard className="w-3.5 h-3.5 text-rose-600" />,
        action: 'manual_expense',
        hoverBg: 'hover:bg-rose-50',
      },
      // separator
      {
        label: 'Penyesuaian (PIN)',
        icon: <Scale className="w-3.5 h-3.5" />,
        action: 'penyesuaian',
        hoverBg: 'hover:bg-rose-50',
        textColor: 'text-rose-700',
      },
      {
        label: 'Edit Akun',
        icon: <Edit className="w-3.5 h-3.5" />,
        action: 'edit_akun',
        hoverBg: 'hover:bg-gray-50',
      },
    ],
    E_WALLET: [
      {
        label: 'Top-Up dari Bank',
        icon: <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-600" />,
        action: 'wallet_topup',
        hoverBg: 'hover:bg-blue-50',
      },
      {
        label: 'Catat Spending',
        icon: <ArrowDownCircle className="w-3.5 h-3.5 text-rose-600" />,
        action: 'wallet_spend',
        hoverBg: 'hover:bg-rose-50',
      },
      // separator
      {
        label: 'Penyesuaian (PIN)',
        icon: <Scale className="w-3.5 h-3.5" />,
        action: 'penyesuaian',
        hoverBg: 'hover:bg-rose-50',
        textColor: 'text-rose-700',
      },
      {
        label: 'Edit Akun',
        icon: <Edit className="w-3.5 h-3.5" />,
        action: 'edit_akun',
        hoverBg: 'hover:bg-gray-50',
      },
    ],
  };

  return baseItems[accountType] || [];
}

/**
 * Separator indices: between "Catat Pengeluaran" / "Catat Spending" and "Penyesuaian".
 * BANK: 4 items before separator (indices 0-3), then 2 after (indices 4-5)
 * KAS: 3 items before separator (indices 0-2), then 2 after (indices 3-4)
 * E_WALLET: 2 items before separator (indices 0-1), then 2 after (indices 2-3)
 */
function getSeparatorIndex(accountType: CashAccountBalance['account_type']): number {
  switch (accountType) {
    case 'BANK':
      return 4; // after index 3 (Catat Pengeluaran)
    case 'KAS':
      return 3; // after index 2 (Catat Pengeluaran)
    case 'E_WALLET':
      return 2; // after index 1 (Catat Spending)
  }
}

/**
 * AksiDropdown: Context-aware context menu for cash account actions.
 *
 * Displays different menu items based on account_type:
 * - BANK: Transfer, Setor dari Kas, Tarik, Catat Pengeluaran, Penyesuaian, Edit
 * - KAS: Setor ke Bank, Tarik, Catat Pengeluaran, Penyesuaian, Edit
 * - E_WALLET: Top-Up, Catat Spending, Penyesuaian, Edit
 *
 * Features:
 * - Closes on click-outside
 * - Closes on Escape key
 * - ARIA-compliant menu button
 * - Matches mockup styling (btn-primary trigger, sub-card panel)
 */
export default function AksiDropdown({
  account,
  onAction,
}: AksiDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const items = getMenuItems(account.account_type);
  const separatorIndex = getSeparatorIndex(account.account_type);

  // Close dropdown on click-outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  function handleAction(action: AksiAction) {
    setIsOpen(false);
    onAction(action);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="btn-primary w-full inline-flex items-center justify-center gap-1.5"
        style={{
          background: '#012749',
          color: 'white',
          borderRadius: '9999px',
          fontSize: '12px',
          fontWeight: 700,
          padding: '8px 14px',
        }}
      >
        <Plus className="w-3.5 h-3.5" />
        Aksi
        <ChevronDown
          className="w-3 h-3"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
        />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-2 w-full rounded-sm py-2 shadow-lg z-10"
          style={{
            background: '#fafbff',
            border: '1px solid #c7d7f5',
          }}
        >
          {items.map((item, idx) => (
            <React.Fragment key={item.action}>
              {/* Separator before Penyesuaian */}
              {idx === separatorIndex && (
                <hr className="my-1 border-gray-200" />
              )}

              {/* Menu Item */}
              <button
                role="menuitem"
                onClick={() => handleAction(item.action)}
                className={`block w-full text-left px-4 py-2 text-[13px] flex items-center gap-2 ${item.hoverBg} ${
                  item.textColor || ''
                }`}
                style={{
                  color: item.textColor === 'text-rose-700' ? '#b91c1c' : 'inherit',
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
