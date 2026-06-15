// src/components/produk/categorySpecs.ts
// Extracted from StockManagerScreen.tsx. Multi-tenant ready:
// if category not in this map, the form falls back to Aksesori pattern.

export type SpecFieldDef = {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text';
  options?: string[];
  required?: boolean;
};

export const CATEGORY_SPECS: Record<string, SpecFieldDef[]> = {
  Panel: [
    { key: 'material', label: 'Material', type: 'select', options: ['Besi', 'Stainless SS304', 'Stainless SS316', 'Aluminium', 'PVC'], required: true },
    { key: 'tipe_pasang', label: 'Tipe Pemasangan', type: 'select', options: ['Indoor', 'Outdoor'], required: true },
    { key: 'ketebalan_mm', label: 'Ketebalan Plat', type: 'select', options: ['1', '1.2', '1.5', '1.8', '2', '3'] },
    { key: 'finishing', label: 'Finishing', type: 'select', options: ['RAL7032', 'Warna Khusus'] },
    { key: 'tinggi_cm', label: 'Tinggi (cm)', type: 'number', required: true },
    { key: 'lebar_cm', label: 'Lebar (cm)', type: 'number', required: true },
    { key: 'tebal_cm', label: 'Tebal (cm)', type: 'number', required: true },
    { key: 'kelengkapan', label: 'Kelengkapan', type: 'select', options: ['Kosong', 'Dengan Komponen + Rakit'] },
  ],
  MCB: [
    { key: 'mcb_merek', label: 'Merek', type: 'select', options: [], required: true },  // options loaded from product_brands
    { key: 'mcb_ampere', label: 'Ampere (A)', type: 'number', required: true },
    { key: 'mcb_phase', label: 'Phase', type: 'select', options: ['1P', '2P', '3P'], required: true },
  ],
  Kabel: [
    { key: 'kabel_tipe', label: 'Tipe Kabel', type: 'select', options: ['NYM', 'NYA', 'NYY', 'NYFGBY', 'AAAC'], required: true },
    { key: 'kabel_mm2', label: 'mm²', type: 'number', required: true },
    { key: 'kabel_panjang', label: 'Panjang', type: 'text', required: true },
  ],
  Aksesori: [
    { key: 'deskripsi', label: 'Deskripsi Produk', type: 'text', required: true },
  ],
};

export const AKSESORI_FALLBACK: SpecFieldDef[] = CATEGORY_SPECS.Aksesori;

/** Returns spec fields for a category. For categories not in CATEGORY_SPECS,
 *  returns Aksesori pattern (1 free-text deskripsi) — multi-tenant generic fallback. */
export function specFieldsFor(category: string): SpecFieldDef[] {
  return CATEGORY_SPECS[category] ?? AKSESORI_FALLBACK;
}

/** Auto-name generator (matches existing generateName in StockManagerScreen.tsx). */
export function generateName(category: string, specs: Record<string, string>): string {
  switch (category) {
    case 'Panel': {
      const { material = '', tipe_pasang = '', tinggi_cm = '', lebar_cm = '', tebal_cm = '',
              ketebalan_mm = '', finishing = '', kelengkapan = '' } = specs;
      const dims = (tinggi_cm && lebar_cm && tebal_cm) ? `${tinggi_cm}×${lebar_cm}×${tebal_cm}cm` : '';
      const thickness = ketebalan_mm ? `${ketebalan_mm}mm` : '';
      return ['Panel', material, tipe_pasang, dims, thickness, finishing, kelengkapan].filter(Boolean).join(' ');
    }
    case 'MCB': {
      const { mcb_merek = '', mcb_ampere = '', mcb_phase = '' } = specs;
      return ['MCB', mcb_merek, mcb_ampere ? `${mcb_ampere}A` : '', mcb_phase].filter(Boolean).join(' ');
    }
    case 'Kabel': {
      const { kabel_tipe = '', kabel_mm2 = '', kabel_panjang = '' } = specs;
      return ['Kabel', kabel_tipe, kabel_mm2 ? `${kabel_mm2}mm²` : '', kabel_panjang].filter(Boolean).join(' ');
    }
    default:
      // Generic fallback for Aksesori + any custom category
      return specs.deskripsi || '';
  }
}
