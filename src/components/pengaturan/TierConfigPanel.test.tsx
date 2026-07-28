import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TierConfigPanel from './TierConfigPanel';
import * as pengaturanServicesModule from '../../lib/pengaturan/pengaturanServices';
import type { DbTenantSettings } from '../../types';

vi.mock('../../lib/pengaturan/pengaturanServices', () => ({
  tenantSettingsService: {
    updateTierConfig: vi.fn(),
  },
}));

const BASE_SETTINGS = {
  modul_multi_tier_price: true,
  tier_1_label: 'Eceran',
  tier_2_label: 'Grosir',
  tier_3_label: null,
  tier_4_label: null,
} as DbTenantSettings;

const BASE_PROPS = {
  tenantSettings: BASE_SETTINGS,
  onSaved: vi.fn(),
  showToast: vi.fn(),
};

describe('TierConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (pengaturanServicesModule.tenantSettingsService.updateTierConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders 4 label inputs preloaded with current values', () => {
    render(<TierConfigPanel {...BASE_PROPS} />);
    expect(screen.getByLabelText(/tier 1/i)).toHaveValue('Eceran');
    expect(screen.getByLabelText(/tier 2/i)).toHaveValue('Grosir');
    expect(screen.getByLabelText(/tier 3/i)).toHaveValue('');
    expect(screen.getByLabelText(/tier 4/i)).toHaveValue('');
  });

  it('saves with tier_3 label filled', async () => {
    render(<TierConfigPanel {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: 'Distributor Kecil' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(pengaturanServicesModule.tenantSettingsService.updateTierConfig).toHaveBeenCalledWith({
        tier_1_label: 'Eceran',
        tier_2_label: 'Grosir',
        tier_3_label: 'Distributor Kecil',
        tier_4_label: null,
      });
    });
    expect(BASE_PROPS.onSaved).toHaveBeenCalled();
    expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/tersimpan/i), 'success');
  });

  it('sends NULL when tier_3 field is cleared', async () => {
    const settings = { ...BASE_SETTINGS, tier_3_label: 'Distributor Kecil' };
    render(<TierConfigPanel {...BASE_PROPS} tenantSettings={settings} />);
    // Field starts filled, clear it
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(pengaturanServicesModule.tenantSettingsService.updateTierConfig).toHaveBeenCalledWith(
        expect.objectContaining({ tier_3_label: null })
      );
    });
  });

  it('surfaces TCFG_LABEL_INVALID as friendly Bahasa toast', async () => {
    (pengaturanServicesModule.tenantSettingsService.updateTierConfig as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('TCFG_LABEL_INVALID'), { code: 'P0400', hint: 'tier_3' })
    );

    render(<TierConfigPanel {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: 'AB' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/tier 3.*3-30/i),
        'warning'
      );
    });
  });

  it('surfaces TCFG_LABEL_DUPLICATE as friendly toast', async () => {
    (pengaturanServicesModule.tenantSettingsService.updateTierConfig as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('TCFG_LABEL_DUPLICATE'), { code: 'P0409' })
    );

    render(<TierConfigPanel {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/tier 3/i), { target: { value: 'Grosir' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/duplikat/i),
        'warning'
      );
    });
  });
});
