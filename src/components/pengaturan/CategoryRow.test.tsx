import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import React from 'react';
import CategoryRow from './CategoryRow';

const wrap = (child: React.ReactNode) =>
  render(
    <DndContext>
      <SortableContext items={['r1']}>{child}</SortableContext>
    </DndContext>
  );

const baseRow = {
  id: 'r1', tenant_id: 't', label: 'Gaji', sort_order: 10,
  active: true, is_system: false, deleted_at: null,
  created_at: '', updated_at: '',
};

describe('CategoryRow', () => {
  it('renders label + toggle + delete when editable', () => {
    wrap(<CategoryRow row={baseRow} isEditable onLabelSubmit={vi.fn()} onActiveToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Gaji')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByLabelText('Hapus kategori Gaji')).toBeInTheDocument();
  });

  it('read-only mode hides toggle + delete', () => {
    wrap(<CategoryRow row={baseRow} isEditable={false} onLabelSubmit={vi.fn()} onActiveToggle={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Hapus kategori/)).not.toBeInTheDocument();
  });

  it('click label switches to edit mode + auto-focus + select', () => {
    wrap(<CategoryRow row={baseRow} isEditable onLabelSubmit={vi.fn()} onActiveToggle={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Gaji'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toHaveValue('Gaji');
    expect(document.activeElement).toBe(input);
  });

  it('Enter submits new label', () => {
    const onSubmit = vi.fn();
    wrap(<CategoryRow row={baseRow} isEditable onLabelSubmit={onSubmit} onActiveToggle={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Gaji'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Gaji Baru' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('Gaji Baru');
  });

  it('Esc reverts to display mode without calling onLabelSubmit', () => {
    const onSubmit = vi.fn();
    wrap(<CategoryRow row={baseRow} isEditable onLabelSubmit={onSubmit} onActiveToggle={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Gaji'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Gaji')).toBeInTheDocument();
  });

  it('toggle click fires onActiveToggle with new value', () => {
    const onToggle = vi.fn();
    wrap(<CategoryRow row={baseRow} isEditable onLabelSubmit={vi.fn()} onActiveToggle={onToggle} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('inactive row is grayed', () => {
    wrap(<CategoryRow row={{ ...baseRow, active: false }} isEditable onLabelSubmit={vi.fn()} onActiveToggle={vi.fn()} onDelete={vi.fn()} />);
    const container = screen.getByTestId('category-row-r1');
    expect(container.className).toMatch(/opacity-50/);
  });
});
