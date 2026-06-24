import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DiscountInlineInput } from './DiscountInlineInput';

describe('DiscountInlineInput', () => {
  beforeEach(() => cleanup());
  test('renders both Rp and % segments; null state has neither active', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Rp' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '%' })).toBeTruthy();
  });

  test('clicking Rp when no type selected sets type to AMOUNT with null value (empty state)', () => {
    // Regression: 2026-06-24 prod bug — value=0 hit setDiscountFromInput's
    // value<=0 guard upstream and silently reset state to null. Pass null
    // so the pill highlights without resetting the user's intent.
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rp' }));
    expect(onChange).toHaveBeenCalledWith(null, 'AMOUNT');
  });

  test('clicking % when no type selected sets type to PERCENT with null value (empty state)', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '%' }));
    expect(onChange).toHaveBeenCalledWith(null, 'PERCENT');
  });

  test('typing into input emits onChange with current type (defaults AMOUNT if null)', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    expect(onChange).toHaveBeenCalledWith(50, 'AMOUNT');
  });

  test('toggle PERCENT→AMOUNT preserves Rp equivalent', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={10} type="PERCENT" base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rp' }));
    // 10% of 1000 = 100. AMOUNT value should be 100.
    expect(onChange).toHaveBeenCalledWith(100, 'AMOUNT');
  });

  test('toggle AMOUNT→PERCENT preserves Rp equivalent', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={100} type="AMOUNT" base={1000} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '%' }));
    expect(onChange).toHaveBeenCalledWith(10, 'PERCENT');
  });

  test('clearing input sets type to null', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={50} type="AMOUNT" base={1000} onChange={onChange} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  test('disabled state prevents toggle click + input change', () => {
    const onChange = vi.fn();
    render(<DiscountInlineInput value={null} type={null} base={1000} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Rp' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
