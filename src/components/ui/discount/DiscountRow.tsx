import React from 'react';
import type { DiscountType } from '../../../types';
import { DiscountInlineInput } from './DiscountInlineInput';
import { computeDiscountAmount } from './computeDiscountAmount';
import { formatIDR } from '../../../lib/formatIDR';

export interface DiscountRowProps {
  label?: string;
  value: number | null;
  type: DiscountType;
  base: number;
  onChange: (value: number | null, type: DiscountType) => void;
  disabled?: boolean;
}

export const DiscountRow: React.FC<DiscountRowProps> = ({
  label = 'Diskon Order', value, type, base, onChange, disabled,
}) => {
  const amount = computeDiscountAmount(value, type, base);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center bg-orange-50 -mx-2 px-2 py-1.5 rounded">
        <span className="font-semibold text-orange-700 text-sm">⊖ {label}</span>
        <DiscountInlineInput
          value={value}
          type={type}
          base={base}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
      <div className="flex justify-between text-caleo-11 text-orange-700">
        <span></span>
        <span className="font-mono">= − {formatIDR(amount)}</span>
      </div>
    </div>
  );
};
