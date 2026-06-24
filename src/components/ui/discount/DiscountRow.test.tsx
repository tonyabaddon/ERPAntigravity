import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscountRow } from './DiscountRow';

describe('DiscountRow', () => {
  test('renders default label "Diskon Order"', () => {
    const { container } = render(<DiscountRow value={null} type={null} base={1000} onChange={() => {}} />);
    expect(container.textContent).toContain('Diskon Order');
  });

  test('renders custom label', () => {
    const { container } = render(<DiscountRow label="Diskon Tagihan" value={null} type={null} base={1000} onChange={() => {}} />);
    expect(container.textContent).toContain('Diskon Tagihan');
  });

  test('shows computed Rp amount when PERCENT selected', () => {
    const { container } = render(<DiscountRow value={10} type="PERCENT" base={1000000} onChange={() => {}} />);
    expect(container.textContent).toContain('100.000');
  });

  test('shows 0 when no discount selected', () => {
    const { container } = render(<DiscountRow value={null} type={null} base={1000} onChange={() => {}} />);
    expect(container.textContent).toContain('= − Rp 0');
  });

  test('forwards onChange', () => {
    const onChange = vi.fn();
    const { container } = render(<DiscountRow value={null} type={null} base={1000} onChange={onChange} />);
    // input change tested in DiscountInlineInput; here just verify renders without errors
    expect(onChange).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });
});
