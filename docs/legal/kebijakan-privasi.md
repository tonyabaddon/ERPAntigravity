# Kebijakan Privasi Caleo

**Efektif sejak**: 2026-07-18
**Versi**: 1.0 (draft — memerlukan review founder untuk mengisi item bertanda `[REVIEW: ...]` sebelum publikasi)

Kebijakan Privasi ini menjelaskan bagaimana **Caleo** (selanjutnya disebut "Caleo", "kami", "kita") mengumpulkan, menggunakan, menyimpan, membagikan, dan melindungi data pribadi Anda saat Anda menggunakan platform ERP Caleo (aplikasi di `app.caleo.id`, situs `caleo.id`, dan layanan terkait). Kebijakan ini disusun sesuai **Undang-Undang Nomor 27 Tahun 2022 tentang Perlindungan Data Pribadi ("UU PDP")** dan **Undang-Undang Informasi dan Transaksi Elektronik ("UU ITE")**.

---

## 1. Identitas Pengendali Data Pribadi

- **Nama entitas**: `[REVIEW: nama PT / CV / perorangan]`
- **Alamat**: `[REVIEW: alamat lengkap]`
- **Email kontak privasi**: `privacy@caleo.id` `[REVIEW: konfirmasi]`
- **Petugas Perlindungan Data / DPO**: `[REVIEW: nama + email, atau isi "belum ditunjuk karena skala pemrosesan belum wajib DPO per UU PDP Pasal 53"]`

Sebagai Pengendali Data Pribadi, Caleo bertanggung jawab atas seluruh keputusan mengenai pengumpulan dan pemrosesan data pribadi Anda dalam platform kami.

## 2. Data Pribadi yang Kami Kumpulkan

Kami mengumpulkan data yang Anda berikan langsung dan data yang terkumpul otomatis saat Anda menggunakan platform:

### 2.1 Data akun (dari Anda saat mendaftar)

- Nama lengkap
- Alamat email
- Nomor telepon (jika Anda mengaktifkan integrasi WhatsApp)
- Password (disimpan dalam bentuk hash, tidak pernah dalam bentuk teks asli)

### 2.2 Data tenant / bisnis (dari Anda saat mengelola bisnis di platform)

- Nama toko / usaha
- Alamat toko
- NPWP (bila Anda memasukkannya untuk keperluan pajak)
- Data pelanggan Anda (nama, telepon, alamat)
- Data supplier Anda
- Data karyawan/kasir Anda (nama, role)
- Data produk, stok, transaksi penjualan, pembelian, pembayaran
- Data akuntansi (buku besar, jurnal, laporan keuangan)

**Catatan penting**: Anda sebagai pemilik tenant adalah **Pengendali Data** atas data pelanggan/supplier/karyawan yang Anda masukkan. Caleo bertindak sebagai **Prosesor Data** untuk data tersebut. Anda bertanggung jawab memperoleh dasar hukum (mis. persetujuan) dari mereka sebelum memasukkan datanya ke platform.

### 2.3 Data teknis (otomatis)

- Alamat IP
- Jenis perangkat, browser, sistem operasi
- Timestamp aktivitas (login, transaksi, aksi lain)
- Log error (untuk keperluan debugging, dianonimkan bila memungkinkan)
- Data usage counter (jumlah fitur digunakan per hari — untuk kapasitas planning)

### 2.4 Data pihak ketiga (opsional, bila Anda mengaktifkan)

- Data pesan WhatsApp yang dikirim/diterima (bila Anda mengaktifkan modul WA)
- Data dari integrasi payment gateway (bila diaktifkan di masa depan)

## 3. Dasar Hukum Pemrosesan (UU PDP Pasal 20)

Kami memproses data pribadi Anda berdasarkan salah satu dari:

- **Persetujuan Anda** (Pasal 20 ayat 2 huruf a) — saat Anda mendaftar dan mencentang "Saya menyetujui Kebijakan Privasi"
- **Pemenuhan perjanjian** (Pasal 20 ayat 2 huruf b) — untuk menjalankan Syarat & Ketentuan platform
- **Kepentingan sah Pengendali** (Pasal 20 ayat 2 huruf e) — untuk keamanan platform, deteksi fraud, monitoring
- **Pemenuhan kewajiban hukum** (Pasal 20 ayat 2 huruf c) — retensi data untuk keperluan pajak, audit

## 4. Tujuan Pemrosesan

Kami memproses data pribadi Anda untuk:

1. Menyediakan dan memelihara layanan platform ERP
2. Mengelola akun Anda dan tenant Anda
3. Memproses transaksi bisnis Anda
4. Mengirim notifikasi operasional (email verifikasi, reset password, alert)
5. Memberikan dukungan pelanggan (via email, WhatsApp founder)
6. Menganalisis penggunaan agar dapat memperbaiki layanan (data yang dianonimkan/dikumpulkan agregat)
7. Menjalankan kewajiban hukum (pajak, audit, permintaan penegak hukum yang sah)
8. Mendeteksi dan mencegah fraud, penyalahgunaan, atau serangan keamanan

Kami **TIDAK** menjual data pribadi Anda ke pihak ketiga untuk keperluan iklan.

## 5. Pihak Ketiga (Sub-Prosesor)

Untuk menjalankan layanan, kami menggunakan sub-prosesor berikut. Semua sub-prosesor telah kami evaluasi kepatuhannya terhadap standar keamanan yang setara atau lebih tinggi:

| Sub-prosesor | Fungsi | Lokasi data | Kepatuhan |
|---|---|---|---|
| Supabase Inc. | Database + Auth | AWS Tokyo (ap-northeast-1) | SOC 2 Type II, GDPR |
| Google Cloud Platform | Cloud Run hosting + backup storage | asia-southeast1 (Singapura) | ISO 27001, SOC 2, GDPR |
| Cloudflare Inc. | CDN + DNS + email routing | Global edge (data at rest di US) | ISO 27001, SOC 2, GDPR |
| Sentry (Functional Software, Inc.) | Error tracking | US | SOC 2 Type II, GDPR |
| Resend Inc. | Transactional email | US | SOC 2 |
| OpenRouter | LLM routing (fitur AI Calista, opsional) | US | `[REVIEW: verify compliance status]` |
| Google AI Studio (Gemini) | LLM inference (fitur AI Calista, opsional) | US | ISO 27001 |

Kami akan memperbarui daftar ini apabila terjadi penambahan atau perubahan sub-prosesor, dan akan memberitahukan Anda melalui email/notifikasi in-app.

## 6. Transfer Data Lintas Negara (UU PDP Pasal 56)

Sebagian data pribadi Anda diproses di server yang berlokasi di luar Indonesia (mis. Jepang, Singapura, Amerika Serikat) sesuai daftar sub-prosesor di atas. Transfer lintas negara ini dilakukan berdasarkan:

- Kepatuhan sub-prosesor terhadap standar perlindungan setara UU PDP
- Klausul kontraktual standar dengan sub-prosesor
- Untuk sub-prosesor US: berdasarkan mekanisme yang diterima secara internasional (DPF, SCC)

Anda dapat menghubungi kami untuk memperoleh salinan mekanisme transfer.

## 7. Retensi Data

Kami menyimpan data pribadi Anda selama:

| Kategori data | Periode retensi |
|---|---|
| Data akun aktif | Selama akun Anda aktif |
| Data akun setelah penutupan | Maksimal 30 hari setelah offboarding, kecuali diwajibkan lebih lama oleh hukum pajak (10 tahun untuk dokumen fiskal per UU KUP) |
| Data transaksi bisnis | 10 tahun (sesuai kewajiban dokumen fiskal UU KUP) |
| Log teknis (IP, timestamp) | 180 hari (audit_log auto-prune) |
| Backup harian | 30 hari (lifecycle otomatis di GCS) |
| Data WhatsApp inbound/outbound | 90 hari, kecuali disimpan lebih lama untuk keperluan audit |

Setelah periode retensi berakhir, data akan **dihapus permanen** atau dianonimkan agar tidak dapat dikaitkan kembali dengan Anda.

## 8. Hak Anda sebagai Subjek Data (UU PDP Pasal 5–14)

Anda memiliki hak-hak berikut:

1. **Hak untuk mendapatkan informasi** tentang pemrosesan data Anda (via Kebijakan Privasi ini + permintaan langsung)
2. **Hak untuk mengakses** salinan data pribadi Anda yang kami simpan
3. **Hak untuk memperbaiki** data yang tidak akurat
4. **Hak untuk menghapus** data (kecuali diwajibkan disimpan oleh hukum)
5. **Hak untuk menarik persetujuan** kapan saja
6. **Hak untuk menolak** pemrosesan otomatis yang menimbulkan akibat hukum bagi Anda
7. **Hak atas portabilitas data** — menerima data Anda dalam format terstruktur yang umum dipakai
8. **Hak untuk mengajukan keberatan** atas pelanggaran perlindungan data ke lembaga pengawas

**Cara menggunakan hak Anda**: kirim email ke `privacy@caleo.id` dengan subjek "Permintaan Hak Subjek Data — [jenis hak]". Kami akan merespon dalam **maksimal 14 hari kalender** sesuai UU PDP Pasal 14.

## 9. Keamanan Data

Kami menerapkan langkah-langkah teknis dan organisasi untuk melindungi data pribadi Anda, termasuk:

- **Enkripsi in-transit**: TLS 1.2+ untuk seluruh komunikasi
- **Enkripsi at-rest**: PostgreSQL storage encryption + GCS default encryption
- **Row-Level Security**: setiap tenant hanya bisa mengakses datanya sendiri, dienforce di level database
- **Authentication**: password di-hash (bcrypt) + JWT session tokens
- **Backup harian** dengan retensi 30 hari, disimpan di GCS terpisah dari database utama
- **Monitoring**: log audit + alert otomatis untuk aktivitas mencurigakan
- **Rotasi rahasia (secret rotation)** terjadwal
- **Uji restore backup** kuartalan untuk memastikan integrity data recovery

Tidak ada sistem yang 100% aman. Bila Anda mengetahui adanya pelanggaran keamanan yang berpotensi mengekspos data Anda, hubungi `security@caleo.id`.

## 10. Notifikasi Insiden Keamanan (UU PDP Pasal 46)

Bila terjadi kegagalan perlindungan data pribadi (data breach), kami akan:

1. Menyelidiki dan mengendalikan insiden secara segera
2. Memberitahukan **Anda** dalam **maksimal 72 jam** setelah kami mengetahui insiden, bila insiden berpotensi menimbulkan risiko tinggi bagi Anda
3. Memberitahukan **Kementerian Komunikasi dan Digital (Kemenkomdigi)** dalam maksimal 72 jam sesuai UU PDP Pasal 46
4. Mendokumentasikan insiden dan pemulihannya di `docs/incidents/`

## 11. Cookie dan Tracking

Platform kami menggunakan cookie/localStorage untuk:

- Menyimpan session login (essential — tidak dapat dinonaktifkan)
- Menyimpan preferensi tampilan (tema, bahasa)
- Analytics agregat (via Sentry breadcrumbs — tidak melacak identitas)

Kami **TIDAK menggunakan** cookie iklan pihak ketiga, tracking pixel, atau third-party analytics yang melacak identitas.

## 12. Data Anak-Anak

Platform kami ditujukan untuk pemilik/karyawan bisnis dewasa (18 tahun ke atas). Kami tidak secara sengaja mengumpulkan data anak di bawah 17 tahun. Bila Anda mengetahui bahwa kami memproses data anak, hubungi kami untuk penghapusan segera.

## 13. Perubahan Kebijakan

Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Perubahan material akan:

- Diberitahukan melalui email ke pemilik akun Anda minimal **30 hari** sebelum berlaku
- Dipublikasikan di halaman ini dengan versi + tanggal efektif yang diperbarui
- Bila perubahan mengurangi hak Anda secara material, kami akan meminta persetujuan ulang

## 14. Hukum yang Berlaku dan Penyelesaian Sengketa

Kebijakan Privasi ini tunduk pada hukum **Republik Indonesia**, khususnya UU PDP dan UU ITE. Sengketa terkait perlindungan data pribadi diselesaikan melalui:

1. **Musyawarah**: hubungi `privacy@caleo.id` terlebih dahulu — kami wajib merespon dalam 14 hari
2. **Lembaga Pelindungan Data Pribadi (LPDP)** bila musyawarah gagal
3. **Pengadilan Negeri** `[REVIEW: yurisdiksi sesuai domisili PT]` sebagai forum terakhir

## 15. Kontak

- Email umum privasi: `privacy@caleo.id`
- Email insiden keamanan: `security@caleo.id`
- Nama Petugas Perlindungan Data: `[REVIEW: sesuai Pasal 1 huruf a]`
- Alamat surat: `[REVIEW: alamat kantor]`

---

**Catatan review untuk founder** (hapus sebelum publikasi):
- Item `[REVIEW: ...]` harus diisi/dikonfirmasi
- Konsultasikan draft dengan legal counsel Indonesia bila memungkinkan (mis. via LBH, notaris, atau konsultan hukum SaaS)
- Registrasi sebagai Prosesor/Pengendali di [pdp.kominfo.go.id](https://pdp.kominfo.go.id) apabila diwajibkan oleh regulasi turunan UU PDP
- Update tanggal efektif saat publikasi resmi
