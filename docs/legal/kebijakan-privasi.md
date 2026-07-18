# Kebijakan Privasi Caleo

**Efektif sejak**: 2026-07-18
**Versi**: 1.0

Dokumen ini menjelaskan bagaimana Caleo memproses data Anda saat
menggunakan aplikasi `app.caleo.id`, situs `caleo.id`, panel admin
`admin.caleo.id`, dan layanan pendukungnya (selanjutnya "Layanan").
"Kami" = Caleo. "Anda" = pengguna Layanan.

---

## TL;DR untuk pemilik toko

Ringkasan singkat — versi lengkap tetap yang mengikat:

- **Data toko Anda milik Anda.** Kami tidak menjual, tidak membagikan
  ke pesaing, tidak memakainya untuk melatih AI.
- **Vendor cloud terpercaya** (Supabase, Google Cloud, Cloudflare —
  daftar lengkap di bawah). Data disimpan terenkripsi.
- **Setiap tenant terisolasi** di level database (Row-Level Security).
  Toko A tidak bisa melihat data toko B.
- **Anda bisa minta ekspor atau penghapusan data kapan saja** lewat
  `privacy@caleo.id`. Kami merespon paling lambat 14 hari kalender.

---

## 1. Identitas Pengendali Data

- **Nama entitas**: Caleo (usaha perorangan)
- **Alamat kantor**: Lindeteves Trade Center (LTC) Glodok, Blok C30
  No. 15 Lantai UG, Jakarta Barat
- **Email privasi**: `privacy@caleo.id`
- **Email umum**: `halo@caleo.id`
- **WhatsApp support**: +62-852-6478-7775

Petugas Perlindungan Data (DPO) formal akan ditunjuk saat skala
pemrosesan mewajibkan. Sementara ini, fungsi DPO dijalankan founder
Caleo.

## 2. Data yang Kami Kumpulkan

**Data akun** (Anda berikan saat mendaftar): nama, email, nomor
telepon (bila integrasi WhatsApp aktif), password (hash — tidak pernah
teks asli).

**Data tenant / bisnis** (Anda berikan saat mengelola bisnis): nama
dan alamat toko, NPWP (bila dimasukkan), data pelanggan, supplier,
karyawan, produk, stok, transaksi, akuntansi.

**Penting**: Anda sebagai pemilik tenant adalah **Pengendali Data**
atas data pelanggan/supplier/karyawan yang Anda masukkan. Caleo
bertindak sebagai **Prosesor Data**. Anda bertanggung jawab
memperoleh dasar hukum (misal persetujuan) dari mereka sebelum
memasukkan datanya.

**Data teknis** (otomatis): IP, jenis perangkat, browser, OS,
timestamp aktivitas, log error (dianonimkan bila memungkinkan),
counter agregat penggunaan fitur.

**Data pihak ketiga** (opsional): pesan WhatsApp inbound/outbound
(bila modul WA dan AI Calista aktif), data payment gateway (bila
diaktifkan di masa depan).

## 3. Dasar Hukum Pemrosesan

Kami memproses data Anda berdasarkan persetujuan Anda saat mendaftar
dan sepanjang diperlukan untuk menjalankan Layanan, menjaga keamanan,
dan memenuhi kewajiban hukum (misal retensi pajak).

## 4. Tujuan Pemrosesan

1. Menyediakan Layanan ERP; mengelola akun dan tenant Anda.
2. Memproses transaksi bisnis Anda.
3. Mengirim notifikasi operasional (verifikasi, reset password, alert,
   tagihan).
4. Memberikan dukungan pelanggan (`halo@caleo.id` / WhatsApp).
5. Menganalisis penggunaan agregat untuk perbaikan fitur (data
   dianonimkan).
6. Menjalankan kewajiban hukum (pajak, audit, permintaan penegak
   hukum sah).
7. Mendeteksi dan mencegah fraud atau serangan keamanan.

Kami **TIDAK** menjual data Anda ke pihak ketiga untuk iklan.

## 5. Kerahasiaan Data Bisnis Anda

Selain perlindungan data pribadi, kami menjaga **kerahasiaan data
bisnis Anda** — penjualan, margin, daftar pelanggan, harga supplier,
laporan keuangan. Kami **tidak** mengungkapkannya ke publik, media,
pesaing, atau afiliasi tanpa persetujuan tertulis Anda; **tidak**
memakainya untuk keuntungan komersial kami (benchmarking
teridentifikasi, penjualan insight). Akses internal dibatasi untuk
dukungan teknis dan hanya dengan izin Anda, kecuali diwajibkan proses
hukum sah. Karyawan/kontraktor kami terikat kewajiban kerahasiaan.

Bila kami diwajibkan mengungkapkan data oleh perintah pengadilan atau
penegak hukum, kami akan berupaya memberitahu Anda terlebih dahulu
(kecuali dilarang) agar Anda dapat menempuh upaya hukum yang tersedia.

## 6. Pihak Ketiga (Sub-Prosesor)

Sub-prosesor berikut kami evaluasi untuk kepatuhan keamanan setara
atau lebih tinggi:

| Sub-prosesor | Fungsi | Lokasi data | Kepatuhan |
|---|---|---|---|
| Supabase Inc. | Database Postgres + Auth | Singapura (ap-southeast-1) | SOC 2 Type II, GDPR |
| Google Cloud Platform | Cloud Run hosting + backup storage | Singapura (asia-southeast1) | ISO 27001, SOC 2, GDPR |
| Cloudflare Inc. | CDN + DNS + edge routing | Global edge (at-rest US) | ISO 27001, SOC 2, GDPR |
| Sentry (Functional Software) | Error monitoring | Uni Eropa | SOC 2 Type II, GDPR |
| Resend Inc. | Email transaksional | Amerika Serikat | SOC 2 |
| OpenRouter | LLM routing (Calista, opsional) | Amerika Serikat | Tidak menyimpan prompt untuk pelatihan model |
| Google AI Studio (Gemini) | LLM inference (Calista, opsional) | Amerika Serikat / global | ISO 27001; tier berbayar tidak dipakai untuk pelatihan model |

Kami akan memberitahukan penambahan atau perubahan sub-prosesor via
email atau notifikasi in-app.

## 7. Transfer Data Lintas Negara

Sebagian data Anda diproses di server luar Indonesia (Singapura, Uni
Eropa, AS) sesuai daftar di atas. Transfer dilakukan berdasarkan
kepatuhan sub-prosesor pada standar perlindungan data yang setara,
klausul kontraktual standar (SCC), dan mekanisme transfer internasional
yang diterima (Data Privacy Framework). Salinan mekanisme transfer
tersedia via `privacy@caleo.id`.

## 8. Retensi Data

| Kategori data | Periode retensi |
|---|---|
| Data akun aktif | Selama akun aktif |
| Data akun setelah penutupan | Maksimal 30 hari, kecuali kewajiban hukum pajak (10 tahun untuk dokumen fiskal) |
| Data transaksi bisnis | 10 tahun (kewajiban hukum pajak) |
| Log teknis (IP, timestamp) | 180 hari (auto-prune) |
| Backup harian | 30 hari (lifecycle Google Cloud Storage) |
| Data WhatsApp inbound/outbound | 90 hari, kecuali Anda minta lebih lama untuk audit |

Setelah periode retensi berakhir, data **dihapus permanen** atau
dianonimkan.

## 9. Hak Anda sebagai Subjek Data

Anda berhak untuk:

1. Mendapatkan **informasi** tentang pemrosesan data Anda.
2. **Mengakses** salinan data pribadi Anda.
3. **Memperbaiki** data yang tidak akurat.
4. **Menghapus** data (kecuali diwajibkan disimpan oleh hukum).
5. **Menarik persetujuan** kapan saja.
6. **Menolak** pemrosesan otomatis yang berakibat hukum bagi Anda.
7. **Portabilitas data** — menerima data dalam format CSV / JSON.
8. **Mengajukan keberatan** ke lembaga pengawas.

**Cara**: kirim email ke `privacy@caleo.id` dengan subjek "Permintaan
Hak Subjek Data — [jenis hak]". Kami respon **maksimal 14 hari
kalender**. Permintaan kompleks dapat diperpanjang dengan
pemberitahuan alasan.

## 10. Keamanan Data

- **Enkripsi in-transit** TLS 1.2+; **at-rest** storage PostgreSQL +
  Google Cloud Storage.
- **Row-Level Security**: setiap tenant hanya akses datanya sendiri,
  dienforce di level database.
- **Autentikasi**: password bcrypt + JWT session token.
- **Backup harian** retensi 30 hari, disimpan terpisah; **uji restore**
  kuartalan.
- **Monitoring**: audit log + alert otomatis aktivitas mencurigakan;
  rotasi secret terjadwal.

Tidak ada sistem 100% aman. Bila Anda mengetahui pelanggaran
keamanan, hubungi `privacy@caleo.id` atau WA +62-852-6478-7775.

## 11. Notifikasi Insiden Keamanan

Bila terjadi kegagalan perlindungan data (data breach), kami akan:

1. Menyelidiki dan mengendalikan insiden segera.
2. Memberitahukan **Anda** dalam **maksimal 72 jam** setelah kami
   mengetahui, bila insiden berpotensi risiko tinggi.
3. Memberitahukan **Kementerian Komunikasi dan Digital** dalam
   maksimal 72 jam.
4. Mendokumentasikan insiden, dampak, dan pemulihan.

Notifikasi mencakup jenis data terdampak, potensi dampak, mitigasi
kami, dan langkah yang disarankan untuk Anda.

## 12. Cookie dan Tracking

Kami memakai cookie / localStorage untuk session login (essential),
preferensi tampilan (tema, bahasa), dan analytics agregat (Sentry
breadcrumbs — tidak melacak identitas personal). Kami **TIDAK**
memakai cookie iklan pihak ketiga, tracking pixel, atau analytics
pihak ketiga yang melacak identitas Anda di luar Layanan.

## 13. Data Anak-Anak

Layanan ditujukan untuk pemilik dan karyawan bisnis dewasa (minimal
18 tahun). Kami tidak sengaja mengumpulkan data anak di bawah 17 tahun.
Bila Anda tahu kami memproses data anak tanpa dasar hukum sah, hubungi
kami untuk penghapusan segera.

## 14. Perubahan Kebijakan

Perubahan material diberitahukan via email ke pemilik akun minimal
**30 hari** sebelum berlaku, dan dipublikasikan di halaman ini dengan
versi + tanggal efektif baru. Bila mengurangi hak Anda secara
material, kami minta persetujuan ulang. Perubahan minor (perbaikan
bahasa, ejaan) berlaku segera tanpa pemberitahuan formal.

## 15. Hukum yang Berlaku dan Penyelesaian Sengketa

Kebijakan ini tunduk pada hukum **Republik Indonesia**. Sengketa
diselesaikan melalui:

1. **Musyawarah** (penyelesaian non-litigasi lewat komunikasi
   langsung): hubungi `privacy@caleo.id` — kami respon dalam 14 hari
   kalender.
2. **Lembaga pengawas perlindungan data** bila musyawarah tidak
   berhasil.
3. **Pengadilan Negeri Jakarta Barat** sebagai forum terakhir, sesuai
   domisili kantor kami.

## 16. Kontak

- **Hak subjek data & insiden keamanan**: `privacy@caleo.id`
- **Pertanyaan umum**: `halo@caleo.id`
- **WhatsApp support**: +62-852-6478-7775
- **Alamat surat**: Lindeteves Trade Center (LTC) Glodok, Blok C30
  No. 15 Lantai UG, Jakarta Barat
