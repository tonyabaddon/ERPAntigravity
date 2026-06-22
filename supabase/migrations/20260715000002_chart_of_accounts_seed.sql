BEGIN;

INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_subtype, normal_balance, is_control_account, is_system) VALUES
-- ============ 1 ASET ============
('1-1000', 'ASET LANCAR', 'ASET', NULL, 'DEBIT', true, true),
('1-1100', 'Kas', 'ASET', 'KAS', 'DEBIT', true, true),
('1-1110', 'Kas Toko', 'ASET', 'KAS', 'DEBIT', false, true),
('1-1200', 'Bank', 'ASET', 'BANK', 'DEBIT', true, true),
  -- Sub-accounts per bank account seeded from cash_accounts existing
('1-1300', 'E-Wallet', 'ASET', 'E_WALLET', 'DEBIT', true, true),
  -- Sub per wallet seeded from cash_accounts
('1-1400', 'Piutang Usaha', 'ASET', 'PIUTANG_USAHA', 'DEBIT', true, true),
('1-1450', 'Piutang Lain-lain', 'ASET', 'PIUTANG', 'DEBIT', false, true),
('1-1500', 'Persediaan', 'ASET', 'PERSEDIAAN', 'DEBIT', true, true),
('1-1510', 'Persediaan Barang Jadi', 'ASET', 'PERSEDIAAN', 'DEBIT', false, true),
('1-1520', 'Persediaan Bahan Baku', 'ASET', 'PERSEDIAAN', 'DEBIT', false, true),
-- ('1-1600', 'PPN Masukan', 'ASET', 'PAJAK', 'DEBIT', false, true), -- conditional PKP
('1-2000', 'ASET TETAP', 'ASET', NULL, 'DEBIT', true, true),
('1-2100', 'Peralatan', 'ASET', 'ASET_TETAP', 'DEBIT', false, true),
('1-2200', 'Kendaraan', 'ASET', 'ASET_TETAP', 'DEBIT', false, true),
('1-2900', 'Akumulasi Penyusutan (contra)', 'ASET', 'KONTRA', 'CREDIT', false, true),

-- ============ 2 LIABILITAS ============
('2-1000', 'LIABILITAS LANCAR', 'LIABILITAS', NULL, 'CREDIT', true, true),
('2-1100', 'Hutang Usaha', 'LIABILITAS', 'HUTANG_USAHA', 'CREDIT', true, true),
('2-1200', 'Hutang Pajak', 'LIABILITAS', 'PAJAK', 'CREDIT', true, true),
('2-1210', 'Hutang PPh Final 0.5%', 'LIABILITAS', 'PAJAK', 'CREDIT', false, true),
('2-1220', 'Hutang PPh Pasal 25', 'LIABILITAS', 'PAJAK', 'CREDIT', false, true),
-- ('2-1230', 'PPN Keluaran', 'LIABILITAS', 'PAJAK', 'CREDIT', false, true), -- conditional PKP
('2-1300', 'Hutang Bank Jangka Pendek', 'LIABILITAS', 'HUTANG_BANK', 'CREDIT', false, true),
('2-1400', 'Hutang Lain-lain', 'LIABILITAS', NULL, 'CREDIT', false, true),
('2-1500', 'Pendapatan Diterima Dimuka (DP)', 'LIABILITAS', 'DP', 'CREDIT', false, true),  -- REV3
  -- Untuk track DP customer yang belum delivery
('2-2000', 'LIABILITAS JANGKA PANJANG', 'LIABILITAS', NULL, 'CREDIT', true, true),
('2-2100', 'Hutang Bank Jangka Panjang', 'LIABILITAS', 'HUTANG_BANK', 'CREDIT', false, true),

-- ============ 3 MODAL ============
('3-1000', 'EKUITAS', 'MODAL', NULL, 'CREDIT', true, true),
('3-1100', 'Modal Owner', 'MODAL', 'MODAL_DISETOR', 'CREDIT', false, true),
('3-1200', 'Prive (Owner Drawing)', 'MODAL', 'PRIVE', 'DEBIT', false, true),
('3-1300', 'Laba Ditahan', 'MODAL', 'LABA_DITAHAN', 'CREDIT', false, true),
('3-1400', 'Laba/(Rugi) Tahun Berjalan', 'MODAL', 'LABA_BERJALAN', 'CREDIT', false, true),
('3-1900', 'Ikhtisar Laba Rugi (closing)', 'MODAL', 'CLOSING', 'CREDIT', false, true),  -- REV3
  -- Akun perantara untuk year-end closing process

-- ============ 4 PENDAPATAN ============
('4-1000', 'PENDAPATAN USAHA', 'PENDAPATAN', NULL, 'CREDIT', true, true),
('4-1100', 'Penjualan', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', true, true),
('4-1110', 'Penjualan Walkin', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1120', 'Penjualan Marketplace', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1130', 'Penjualan Grosir', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1140', 'Penjualan Tempo (Kredit)', 'PENDAPATAN', 'PENJUALAN', 'CREDIT', false, true),
('4-1200', 'Pendapatan Lain-lain', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', true, true),
('4-1210', 'Pendapatan Bunga', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', false, true),
('4-1220', 'Pendapatan Ongkir (margin)', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', false, true),
('4-1230', 'Keuntungan Selisih Stock Opname', 'PENDAPATAN', 'PENDAPATAN_LAIN', 'CREDIT', false, true),  -- REV3
('4-1900', 'Diskon Penjualan (contra)', 'PENDAPATAN', 'KONTRA', 'DEBIT', false, true),

-- ============ 5 BEBAN ============
('5-1000', 'HARGA POKOK PENJUALAN', 'BEBAN', NULL, 'DEBIT', true, true),
('5-1100', 'HPP Penjualan', 'BEBAN', 'HPP', 'DEBIT', false, true),
('5-2000', 'BEBAN OPERASIONAL', 'BEBAN', NULL, 'DEBIT', true, true),
('5-2100', 'Beban Gaji', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2200', 'Beban Sewa Tempat', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2300', 'Beban Utilitas (Listrik, Air, Gas)', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2400', 'Beban Marketing', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2500', 'Beban Transportasi/Ongkir', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2600', 'Beban ATK', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2700', 'Beban Komunikasi/Internet', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2800', 'Beban MDR EDC / Bank Fee', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2900', 'Beban Konsumsi Karyawan', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-2950', 'Beban Operasional Lain-lain', 'BEBAN', 'BEBAN_OPERASIONAL', 'DEBIT', false, true),
('5-3000', 'BEBAN NON-OPERASIONAL', 'BEBAN', NULL, 'DEBIT', true, true),
('5-3100', 'Kerugian Piutang (Write-off)', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true),
('5-3150', 'Kerugian Selisih Stock Opname', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true),  -- REV3
('5-3200', 'Beban Penyusutan', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true),
('5-3300', 'Beban Pajak', 'BEBAN', 'BEBAN_NON_OPERASIONAL', 'DEBIT', false, true);

COMMIT;
