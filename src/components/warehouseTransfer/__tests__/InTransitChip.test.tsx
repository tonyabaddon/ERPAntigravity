// src/components/warehouseTransfer/__tests__/InTransitChip.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InTransitChip } from '../InTransitChip';

vi.mock('../../../hooks/useInTransitBySKU', () => ({
  useInTransitBySKU: () => new Map([['S1', 5]]),
}));

describe('InTransitChip', () => {
  it('renders +N in-transit when qty > 0', () => {
    render(<InTransitChip warehouseId="wh1" sku="S1" />);
    expect(screen.getByText(/\+5 in-transit/)).toBeInTheDocument();
  });
  it('renders nothing when qty is 0 / missing', () => {
    const { container } = render(<InTransitChip warehouseId="wh1" sku="S2" />);
    expect(container.textContent).toBe('');
  });
});
