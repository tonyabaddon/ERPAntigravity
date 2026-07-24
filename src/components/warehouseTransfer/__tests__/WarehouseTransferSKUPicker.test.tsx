import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import WarehouseTransferSKUPicker, { TransferLine } from '../WarehouseTransferSKUPicker';

function Harness({ initialLines = [] as TransferLine[] }) {
  const [lines, setLines] = useState<TransferLine[]>(initialLines);
  return (
    <WarehouseTransferSKUPicker
      fromWarehouseId="wa"
      lines={lines}
      onChange={setLines}
      searchSKU={vi.fn().mockResolvedValue([])}
    />
  );
}

describe('WarehouseTransferSKUPicker qty edit (regression: clamp-on-blur, not per keystroke)', () => {
  it('allows typing a value larger than stockAvailable while focused; clamps only on blur', () => {
    render(
      <Harness initialLines={[{ sku: 'S1', name: 'Cat', qty: 1, stockAvailable: 5 }]} />
    );
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    // User types "14" (would previously clamp to 5 mid-keystroke)
    fireEvent.change(input, { target: { value: '14' } });
    expect(input.value).toBe('14'); // draft shows raw value, not clamped

    // On blur, clamped to stockAvailable
    fireEvent.blur(input);
    expect(input.value).toBe('5');
  });

  it('accepts intermediate empty value during edit; blur snaps to 1', () => {
    render(
      <Harness initialLines={[{ sku: 'S1', name: 'Cat', qty: 3, stockAvailable: 10 }]} />
    );
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe(''); // no snap-back to 1 while editing

    fireEvent.blur(input);
    expect(input.value).toBe('1');
  });

  it('keeps typed value when within [1, stockAvailable]', () => {
    render(
      <Harness initialLines={[{ sku: 'S1', name: 'Cat', qty: 1, stockAvailable: 100 }]} />
    );
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);
    expect(input.value).toBe('4');
  });

  // Regression: sibling-row removal between edit and blur — clamp must use the
  // right row's stockAvailable (looked up by SKU), not the stale index.
  it('commits the correct row when a sibling row is removed before blur', () => {
    render(
      <Harness
        initialLines={[
          { sku: 'S1', name: 'Cat', qty: 1, stockAvailable: 3 },
          { sku: 'S2', name: 'Kuas', qty: 1, stockAvailable: 999 },
        ]}
      />
    );
    const [inputS1, inputS2] = screen.getAllByRole('spinbutton') as HTMLInputElement[];

    // Focus S2 (i=1), type '50'
    fireEvent.change(inputS2, { target: { value: '50' } });

    // Remove S1 (i=0) — S2 shifts to i=0. If commitQty still used the stale
    // `i=1`, it would either crash or clamp against undefined.
    fireEvent.click(screen.getAllByRole('button')[0]);

    // Blur S2 — clamp must use S2's own stockAvailable (999), not S1's (3).
    fireEvent.blur(inputS2);
    const remaining = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].value).toBe('50');
  });

  // Regression: draft state must be cleared on removeLine so re-adding the same
  // SKU doesn't resurrect the previously typed value.
  it('clears the draft when a line is removed (re-adds do not resurrect stale draft)', () => {
    function Harness2() {
      const [lines, setLines] = useState<TransferLine[]>([
        { sku: 'S1', name: 'Cat', qty: 1, stockAvailable: 100 },
      ]);
      return (
        <>
          <button data-testid="readd" onClick={() =>
            setLines([{ sku: 'S1', name: 'Cat', qty: 1, stockAvailable: 100 }])
          }>readd</button>
          <WarehouseTransferSKUPicker
            fromWarehouseId="wa"
            lines={lines}
            onChange={setLines}
            searchSKU={vi.fn().mockResolvedValue([])}
          />
        </>
      );
    }
    render(<Harness2 />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    // Type '99' but don't blur — draft is set to '99'
    fireEvent.change(input, { target: { value: '99' } });
    expect(input.value).toBe('99');

    // Remove the line (X button is the first button INSIDE the picker; the
    // first button in DOM is the readd harness button, so index 1 targets the row X)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]); // last button is the row X

    // Re-add same SKU
    fireEvent.click(screen.getByTestId('readd'));

    // Input should show '1' (parent's qty), not '99' (orphaned draft)
    const readded = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(readded.value).toBe('1');
  });
});

// NOTE on blur→submit race: `fireEvent.blur` + `fireEvent.click` in RTL runs
// in isolated React events and does NOT reproduce the real-browser sequence
// where mousedown fires blur inside the same task as the click handler. The
// flushSync in the picker's onBlur handles that race in production, but this
// test suite can't observe it. Manual browser verification of "type qty →
// click Kirim without tabbing out → submit ships the typed qty" is still
// required until we adopt @testing-library/user-event for this flow.
