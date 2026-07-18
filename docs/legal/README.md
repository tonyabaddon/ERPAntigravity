# Dokumen Legal Caleo

Dokumen resmi yang mengatur hubungan hukum antara Caleo sebagai penyedia platform ERP dengan Pelanggan (pemilik tenant) dan Subjek Data.

## Daftar dokumen

| Dokumen | Untuk | Status |
|---|---|---|
| [kebijakan-privasi.md](kebijakan-privasi.md) | Perlindungan Data Pribadi (UU PDP) | Draft v1.0 — perlu review founder |
| [syarat-ketentuan.md](syarat-ketentuan.md) | Perjanjian layanan (S&K) | Draft v1.0 — perlu review founder |

## Bahasa

Semua dokumen legal dalam **Bahasa Indonesia**. Versi Bahasa Inggris tidak dibuat (per keputusan founder 2026-07-18). Bila di kemudian hari ada terjemahan Bahasa Inggris untuk keperluan pemasaran/investor luar, versi Bahasa Indonesia tetap yang mengikat secara hukum.

## Item yang harus diisi sebelum publikasi

Cari `[REVIEW: ...]` di kedua dokumen dan isi:

- **Legal entity**: nama PT/CV/perorangan yang menjalankan Caleo
- **Alamat kantor**: alamat sesuai akta / KTP
- **DPO / Petugas Perlindungan Data**: nama + email (bila diwajibkan)
- **Paket + harga**: sinkronisasi dengan pricing page
- **PPN**: include/exclude
- **SLA target**: 99.5% / 99.9%
- **Yurisdiksi**: Pengadilan Negeri sesuai domisili
- **Email kontak**: konfirmasi `privacy@caleo.id`, `support@caleo.id`, `billing@caleo.id`, `legal@caleo.id`, `security@caleo.id` semua sudah dibuat + Cloudflare Email Routing → founder Gmail

## Publikasi

Kedua dokumen harus dapat diakses publik sebelum tenant pertama yang membayar diaktifkan. Rekomendasi lokasi publik:

- `caleo.id/privacy` → render dari `kebijakan-privasi.md`
- `caleo.id/terms` → render dari `syarat-ketentuan.md`

Task 16 (landing Firebase deploy) dan Task 17 (DNS cutover) akan wire kedua endpoint ini ke landing page.

Untuk saat ini (belum ada tenant paying), dokumen cukup ada di repo + link disebutkan di halaman signup admin.

## Registrasi wajib

Bila skala pemrosesan data pribadi tergolong "menengah/besar" per PP turunan UU PDP:

- Registrasi Pengendali Data Pribadi di [pdp.kominfo.go.id](https://pdp.kominfo.go.id)
- Penunjukan DPO formal
- Data Protection Impact Assessment (DPIA) untuk fitur AI yang memproses data pribadi

Konsultasikan dengan konsultan hukum untuk menentukan batas skala.

## Version control

Perubahan dokumen legal HARUS lewat git commit dengan pesan yang menjelaskan:

- Alasan perubahan (regulasi baru, feature baru, keluhan tenant)
- Tanggal efektif baru
- Notifikasi ke tenant existing (email + in-app banner) minimal 30 hari sebelum berlaku bila material

Jangan pernah ubah dokumen legal secara langsung di production tanpa versi git yang traceable.
