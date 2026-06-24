import React from 'react';
import type { DiscountType } from '../../../types';
import { computeDiscountAmount } from './computeDiscountAmount';

export interface DiscountInlineInputProps {
  value: number | null;
  type: DiscountType;
  base: number;
  onChange: (value: number | null, type: DiscountType) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const DiscountInlineInput: React.FC<DiscountInlineInputProps> = ({
  value, type, base, onChange, disabled, placeholder = '0',
}) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value.trim();
    if (raw === '') { onChange(null, null); return; }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    const nextType: DiscountType = type ?? 'AMOUNT';
    onChange(num, nextType);
  };

  const handleToggle = (next: DiscountType) => {
    if (disabled) return;
    if (next === type) return;
    if (next === null) { onChange(null, null); return; }
    const currentAmount = computeDiscountAmount(value, type, base);
    if (currentAmount === 0 || base <= 0) {
      onChange(0, next);
      return;
    }
    const newValue = next === 'AMOUNT' ? currentAmount : Math.round((currentAmount / base) * 100);
    onChange(newValue, next);
  };

  const display = value == null ? '' : String(value);
  const segPillCls = 'inline-flex border border-slate-300 rounded overflow-hidden bg-white';
  const btnBase = 'text-[11px] font-bold leading-none px-1.5 py-1 cursor-pointer';
  const btnActive = 'bg-orange-700 text-white';
  const btnIdle = 'bg-white text-slate-600 hover:bg-slate-100';
  const isRp = type === 'AMOUNT';
  const isPct = type === 'PERCENT';

  return (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={display}
        onChange={handleInputChange}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-16 text-right text-[12px] font-mono border rounded px-2 py-1 ${
          type ? 'border-orange-700 font-bold text-orange-700' : 'border-slate-200 text-slate-400'
        }`}
      />
      <span className={segPillCls}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleToggle('AMOUNT')}
          className={`${btnBase} ${isRp ? btnActive : btnIdle}`}
        >Rp</button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleToggle('PERCENT')}
          className={`${btnBase} ${isPct ? btnActive : btnIdle}`}
        >%</button>
      </span>
    </div>
  );
};
