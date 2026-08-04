import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubPartsModal } from './SubPartsModal';

describe('SubPartsModal', () => {
  it('parses one bullet per line and calls onSave with structured array', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SubPartsModal open={true} initialSubParts={[]} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Box Panel 1.2mm\nMCCB 3P 300A\nTerminal, Busbar\n\nPemasangan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    expect(onSave).toHaveBeenCalledWith([
      { name: 'Box Panel 1.2mm' },
      { name: 'MCCB 3P 300A' },
      { name: 'Terminal, Busbar' },
      { name: 'Pemasangan' },
    ]);
  });

  it('prefills textarea from initialSubParts', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SubPartsModal open={true}
      initialSubParts={[{ name: 'Foo' }, { name: 'Bar' }]}
      onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole('textbox')).toHaveValue('Foo\nBar');
  });
});
