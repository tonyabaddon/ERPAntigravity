// src/components/admin/PlansManagement.test.tsx
// Wave 4a: extends Wave 1 tests to cover inline edit mode + super-admin gate.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { PlansManagement } from './PlansManagement';

const listPlansAdmin = vi.fn();
const updatePlan = vi.fn();
const isSuperAdmin = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../../lib/adminPlansApi', () => ({
  listPlansAdmin: (...args: unknown[]) => listPlansAdmin(...args),
}));

vi.mock('../../lib/adminApi', () => ({
  updatePlan: (...args: unknown[]) => updatePlan(...args),
}));

vi.mock('../../lib/adminAuth', () => ({
  isSuperAdmin: () => isSuperAdmin(),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    info: vi.fn(),
  },
}));

const seed = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Warung / kios kecil dengan operasi minimal',
    target_segment: 'MSME 1-3 karyawan',
    is_recommended: false,
    feature_bundle: { modul_kasir: true, modul_akuntansi: true, modul_pengiriman: true },
    sort_order: 1,
    tenant_count: 0,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'Toko retail dengan tempo + accounting',
    target_segment: 'MSME 5-15 karyawan',
    is_recommended: true,
    feature_bundle: {
      modul_kasir: true, modul_tempo: true, modul_akuntansi: true, modul_pengiriman: true,
      modul_diskon_kasir: true, modul_diskon_penjualan: true, modul_diskon_tagihan: true,
    },
    sort_order: 2,
    tenant_count: 1,
  },
  {
    code: 'PREMIUM',
    name: 'Premium',
    description: 'Distributor / manufaktur multi-gudang',
    target_segment: 'B2B 20+ karyawan',
    is_recommended: false,
    feature_bundle: {
      modul_kasir: true, modul_tempo: true, modul_akuntansi: true, modul_pengiriman: true,
      modul_multi_warehouse: true, modul_bom_recipe: true, modul_multi_tier_price: true,
      modul_jasa_layanan: true, modul_diskon_kasir: true, modul_diskon_penjualan: true,
      modul_diskon_tagihan: true,
    },
    sort_order: 3,
    tenant_count: 1,
  },
];

beforeEach(() => {
  listPlansAdmin.mockReset();
  updatePlan.mockReset();
  isSuperAdmin.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  listPlansAdmin.mockResolvedValue(structuredClone(seed));
});

describe('PlansManagement — read mode', () => {
  it('renders 3 plan cards (STARTER, PRO, PREMIUM)', async () => {
    isSuperAdmin.mockResolvedValue(false);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByText('STARTER')).toBeInTheDocument());
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('PREMIUM')).toBeInTheDocument();
  });

  it('shows PALING POPULER ribbon only on PRO card', async () => {
    isSuperAdmin.mockResolvedValue(false);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('paling-populer-ribbon')).toBeInTheDocument());
    expect(screen.getAllByTestId('paling-populer-ribbon')).toHaveLength(1);
  });

  it('renders feature bullet list for each plan', async () => {
    isSuperAdmin.mockResolvedValue(false);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('feature-list-STARTER')).toBeInTheDocument());
    const starterList = screen.getByTestId('feature-list-STARTER');
    expect(within(starterList).getByText('Kasir (POS)')).toBeInTheDocument();
  });
});

describe('PlansManagement — non-super-admin', () => {
  it('renders disabled Butuh super admin CTA', async () => {
    isSuperAdmin.mockResolvedValue(false);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-disabled-STARTER')).toBeInTheDocument());
    const starterBtn = screen.getByTestId('edit-btn-disabled-STARTER');
    expect(starterBtn).toBeDisabled();
    expect(starterBtn).toHaveAttribute('title', 'Butuh peran super admin');
  });

  it('does not render Edit paket enabled buttons', async () => {
    isSuperAdmin.mockResolvedValue(false);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-disabled-STARTER')).toBeInTheDocument());
    expect(screen.queryByTestId('edit-btn-STARTER')).not.toBeInTheDocument();
  });
});

describe('PlansManagement — super admin edit flow', () => {
  it('renders enabled Edit paket buttons when super admin', async () => {
    isSuperAdmin.mockResolvedValue(true);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-STARTER')).toBeInTheDocument());
    expect(screen.getByTestId('edit-btn-STARTER')).not.toBeDisabled();
    expect(screen.getByTestId('edit-btn-PRO')).not.toBeDisabled();
    expect(screen.getByTestId('edit-btn-PREMIUM')).not.toBeDisabled();
  });

  it('swaps card into edit form when Edit paket clicked', async () => {
    isSuperAdmin.mockResolvedValue(true);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-PRO')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-btn-PRO'));
    expect(screen.getByTestId('edit-form-PRO')).toBeInTheDocument();
    expect(screen.getByTestId('edit-description-PRO')).toHaveValue('Toko retail dengan tempo + accounting');
    expect(screen.getByTestId('edit-target-PRO')).toHaveValue('MSME 5-15 karyawan');
  });

  it('cancel returns to view mode', async () => {
    isSuperAdmin.mockResolvedValue(true);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-PRO')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-btn-PRO'));
    fireEvent.click(screen.getByTestId('edit-cancel-PRO'));
    expect(screen.queryByTestId('edit-form-PRO')).not.toBeInTheDocument();
    expect(screen.getByTestId('edit-btn-PRO')).toBeInTheDocument();
  });

  it('save calls updatePlan with dirty fields and shows success toast', async () => {
    isSuperAdmin.mockResolvedValue(true);
    updatePlan.mockResolvedValue({ ok: true, plan_code: 'PRO', updated_keys: ['description'] });
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-PRO')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-btn-PRO'));
    fireEvent.change(screen.getByTestId('edit-description-PRO'), {
      target: { value: 'New description' },
    });
    fireEvent.click(screen.getByTestId('edit-save-PRO'));
    await waitFor(() => expect(updatePlan).toHaveBeenCalledWith('PRO', { description: 'New description' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Paket diperbarui.'));
    // Returns to view mode after save
    await waitFor(() => expect(screen.queryByTestId('edit-form-PRO')).not.toBeInTheDocument());
  });

  it('shows JSON error when features JSON is invalid', async () => {
    isSuperAdmin.mockResolvedValue(true);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-PRO')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-btn-PRO'));
    fireEvent.change(screen.getByTestId('edit-features-PRO'), {
      target: { value: 'not-json' },
    });
    expect(screen.getByTestId('edit-features-error-PRO')).toHaveTextContent('JSON tidak valid.');
    expect(screen.getByTestId('edit-save-PRO')).toBeDisabled();
  });

  it('no-op save (no dirty fields) shows Tidak ada perubahan and exits edit', async () => {
    isSuperAdmin.mockResolvedValue(true);
    render(<PlansManagement />);
    await waitFor(() => expect(screen.getByTestId('edit-btn-STARTER')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-btn-STARTER'));
    fireEvent.click(screen.getByTestId('edit-save-STARTER'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Tidak ada perubahan.'));
    expect(updatePlan).not.toHaveBeenCalled();
  });
});
