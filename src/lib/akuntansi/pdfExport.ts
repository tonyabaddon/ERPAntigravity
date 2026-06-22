import jsPDF from 'jspdf';

export interface PDFCompanyInfo {
  companyName: string;
  npwp: string | null;
  address: string | null;
}

export interface PDFGenerationOptions {
  company: PDFCompanyInfo;
  generatedAt: Date;
  fileName?: string;
}

export interface LabaRugiData {
  periodLabel: string;  // "Periode 1-30 Juni 2026"
  startDate: string;
  endDate: string;
  pendapatan: Array<{ code: string; name: string; amount: number }>;
  diskonPenjualan: number;
  pendapatanBersih: number;
  hpp: Array<{ code: string; name: string; amount: number }>;
  labaKotor: number;
  bebanOperasional: Array<{ code: string; name: string; amount: number }>;
  totalBebanOp: number;
  labaOperasional: number;
  pendapatanLainLain: Array<{ code: string; name: string; amount: number }>;
  bebanLainLain: Array<{ code: string; name: string; amount: number }>;
  labaSebelumPajak: number;
  bebanPajak: number;
  labaNeto: number;
}

export interface NeracaData {
  asOfDate: string;
  asOfLabel: string;  // "Per 30 Juni 2026"
  asetLancar: Array<{ code: string; name: string; amount: number }>;
  totalAsetLancar: number;
  asetTetap: Array<{ code: string; name: string; amount: number }>;
  akumulasiPenyusutan: number;
  totalAsetTetap: number;
  totalAset: number;
  liabilitasLancar: Array<{ code: string; name: string; amount: number }>;
  totalLiabLancar: number;
  liabilitasJkPanjang: Array<{ code: string; name: string; amount: number }>;
  totalLiabJkPanjang: number;
  totalLiabilitas: number;
  ekuitas: Array<{ code: string; name: string; amount: number }>;
  totalEkuitas: number;
}

export function generateLabaRugiPDF(data: LabaRugiData, options: PDFGenerationOptions): Blob {
  const doc = new jsPDF();
  doc.text('Laba Rugi - stub', 20, 20);
  return doc.output('blob');
}

export function generateNeracaPDF(data: NeracaData, options: PDFGenerationOptions): Blob {
  const doc = new jsPDF();
  doc.text('Neraca - stub', 20, 20);
  return doc.output('blob');
}
