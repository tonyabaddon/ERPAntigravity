# Syarat & Ketentuan Layanan Caleo

**Efektif sejak**: 2026-07-18
**Versi**: 1.0 (draft — memerlukan review founder untuk mengisi item bertanda `[REVIEW: ...]` sebelum publikasi)

Syarat & Ketentuan ("S&K") ini adalah perjanjian yang mengikat antara Anda ("Pelanggan", "Anda") dengan **Caleo** (selanjutnya "Caleo", "Kami"), yang mengatur penggunaan platform ERP Caleo (aplikasi di `app.caleo.id`, situs `caleo.id`, dan layanan terkait, selanjutnya "Layanan"). Dengan mendaftar akun dan/atau menggunakan Layanan, Anda menyatakan telah membaca, memahami, dan menyetujui S&K ini.

Jika Anda tidak setuju, mohon jangan menggunakan Layanan.

---

## 1. Definisi

- **Layanan**: platform ERP berbasis cloud Caleo, mencakup aplikasi, situs, API, dan dokumentasi
- **Akun**: pendaftaran pengguna individu di platform Caleo
- **Tenant**: unit bisnis (toko/usaha) yang Anda kelola di platform, dengan datanya sendiri terisolasi dari tenant lain
- **Data Pelanggan**: seluruh data yang Anda masukkan atau hasilkan di dalam Layanan, termasuk data pelanggan, supplier, karyawan, produk, transaksi, akuntansi Anda
- **Kebijakan Privasi**: dokumen [kebijakan-privasi.md](kebijakan-privasi.md) yang mengatur pemrosesan data pribadi
- **SLA**: Service Level Agreement, komitmen ketersediaan layanan

## 2. Kelayakan

Anda menyatakan bahwa:

1. Berusia minimal **18 tahun** atau memiliki kewenangan hukum untuk mengikat kontrak
2. Bertindak atas nama sendiri atau memiliki otoritas mewakili badan usaha
3. Informasi yang Anda berikan saat pendaftaran adalah **benar, akurat, dan mutakhir**
4. Anda **bukan** entitas yang dilarang menerima layanan berdasarkan hukum yang berlaku (mis. sanksi internasional, daftar hitam OFAC)

## 3. Pendaftaran dan Akun

### 3.1 Pembuatan akun

- Anda wajib memberikan email valid, nama, dan password kuat (minimal 8 karakter, kombinasi huruf + angka)
- Password Anda disimpan dalam bentuk hash — kami tidak dapat memulihkan password lupa; hanya reset via email

### 3.2 Keamanan akun

- Anda bertanggung jawab menjaga kerahasiaan password
- Segera beritahu kami di `security@caleo.id` bila mencurigai akses tidak sah ke akun Anda
- Kami tidak bertanggung jawab atas kerugian akibat akses tidak sah yang disebabkan kelalaian Anda menjaga kredensial

### 3.3 Satu akun per pengguna

Satu email = satu akun. Berbagi akun antar pengguna tidak diperbolehkan. Jika Anda memerlukan multi-user, tambahkan user tambahan melalui fitur User Management di dalam tenant Anda.

## 4. Penggunaan yang Diizinkan dan Dilarang

### 4.1 Diizinkan

- Mengelola satu atau lebih tenant/bisnis Anda sendiri
- Memasukkan data pelanggan/supplier/karyawan yang Anda miliki dasar hukum untuk memprosesnya
- Menggunakan seluruh fitur Layanan sesuai paket berlangganan Anda

### 4.2 Dilarang

Anda **TIDAK** boleh:

1. Menggunakan Layanan untuk aktivitas ilegal, penipuan, pencucian uang, atau melanggar hukum Republik Indonesia
2. Memasukkan data pribadi orang lain tanpa dasar hukum yang sah (mis. tanpa persetujuan)
3. Melakukan **reverse engineering**, dekompilasi, atau mencoba mengekstrak source code Layanan
4. Menggunakan Layanan untuk mengirim spam, phishing, konten kekerasan, konten SARA, atau konten yang melanggar hukum
5. Melakukan **serangan** terhadap infrastruktur (DDoS, brute-force, SQL injection, eksploitasi kerentanan)
6. Melakukan **web scraping** atau otomasi masif tanpa izin tertulis
7. Menyalahgunakan fitur AI/LLM untuk menghasilkan konten yang melanggar kebijakan penyedia model (kekerasan, konten seksual, deepfake, dll)
8. **Menjual, menyewakan, atau memberikan akses** Layanan ke pihak ketiga tanpa izin (kecuali sebagai user karyawan di tenant Anda)
9. Menghindari mekanisme keamanan, kuota, atau pembatasan yang kami terapkan
10. Menggunakan Layanan pada volume yang mengganggu tenant lain (kami berhak menerapkan rate limiting)

Pelanggaran atas larangan di atas dapat mengakibatkan **suspensi atau terminasi akun** tanpa pengembalian dana.

## 5. Paket, Harga, dan Pembayaran

### 5.1 Paket berlangganan

`[REVIEW: daftar paket + harga per bulan/tahun. Contoh:]`

| Paket | Harga | Fitur |
|---|---|---|
| Starter | `[REVIEW]` | Kasir, produk, pelanggan, laporan dasar |
| Growth | `[REVIEW]` | + Tempo/piutang, akuntansi, WA AI |
| Pro | `[REVIEW]` | + multi-cabang, API akses, prioritas support |

### 5.2 Pembayaran

- Pembayaran dilakukan di muka (prepaid) untuk periode berlangganan (bulanan atau tahunan)
- Metode: `[REVIEW: transfer bank, kartu kredit, e-wallet, dll]`
- Invoice dan bukti pembayaran diterbitkan dalam waktu 1×24 jam setelah dana masuk
- Pajak (PPN 11% atau sesuai tarif yang berlaku) `[REVIEW: konfirmasi apakah harga sudah include atau exclude PPN]`

### 5.3 Perpanjangan otomatis

`[REVIEW: apakah default auto-renew ON atau OFF]`. Anda dapat menonaktifkan auto-renew kapan saja melalui pengaturan akun.

### 5.4 Perubahan harga

Kami dapat mengubah harga berlangganan. Perubahan akan **diberitahukan minimal 30 hari** sebelum berlaku. Harga baru berlaku pada periode perpanjangan berikutnya — harga periode berjalan tidak berubah.

### 5.5 Pengembalian dana

- **Trial gratis**: `[REVIEW: apakah ada free trial, durasi, batasan]`
- **Refund**: tidak ada refund untuk periode berjalan yang sudah dibayar, kecuali:
  - Kami gagal memberikan Layanan >48 jam berturut-turut dalam bulan yang sama (refund pro-rata untuk periode down)
  - Kesalahan penagihan dari sisi kami (refund penuh atas selisih)
- Permintaan refund: `billing@caleo.id`

## 6. SLA (Service Level Agreement)

### 6.1 Komitmen uptime

`[REVIEW: pilih tingkat SLA, umumnya 99.5% - 99.9%]` bulanan untuk aplikasi utama `app.caleo.id`. SLA tidak berlaku untuk:

- Downtime terjadwal (maintenance window, diberitahu ≥24 jam sebelumnya)
- Force majeure (bencana alam, perang, cyberattack terkoordinasi)
- Downtime yang disebabkan oleh sub-prosesor pihak ketiga (mis. Supabase, GCP) di luar kendali kami — kami akan meneruskan kompensasi bila diberikan oleh sub-prosesor
- Downtime dari sisi Anda (mis. koneksi internet Anda, konfigurasi salah)

### 6.2 Kompensasi

Bila kami gagal memenuhi SLA dalam satu bulan kalender, Anda berhak atas:

- Kredit senilai **10% biaya bulanan** untuk setiap 1% penurunan di bawah SLA, maksimal **50% biaya bulanan**
- Kredit diklaim via `billing@caleo.id` dalam 30 hari setelah insiden
- Kredit hanya berlaku untuk perpanjangan periode berikutnya, tidak dapat dicairkan sebagai uang

### 6.3 Bukan garansi

SLA adalah target operasional, bukan garansi mutlak. Untuk kebutuhan mission-critical, silakan diskusikan dengan kami untuk plan enterprise.

## 7. Data Anda

### 7.1 Kepemilikan data

**Data Anda tetap milik Anda.** Kami tidak mengklaim kepemilikan atas Data Pelanggan yang Anda masukkan ke Layanan. Kami hanya diberi izin oleh Anda untuk memproses data tersebut sepanjang diperlukan untuk menyediakan Layanan.

### 7.2 Ekspor data

Anda dapat mengekspor data Anda kapan saja melalui:

- Menu Export di dalam aplikasi (`[REVIEW: fitur export akan tersedia mulai... — sekarang belum lengkap]`)
- Permintaan ke `support@caleo.id` — kami akan menyediakan export dalam format CSV/JSON dalam waktu maksimal **7 hari kerja**

### 7.3 Penghapusan data

Bila Anda memutus berlangganan / offboarding:

- Data Anda tetap dapat diakses melalui akun Anda selama **grace period 30 hari**
- Setelah 30 hari, data dihapus permanen dari sistem produksi kami
- Backup harian tetap menyimpan data hingga 30 hari sesuai retensi backup — setelah lifecycle GCS otomatis hapus
- Bila Anda meminta penghapusan segera (per UU PDP hak subjek data), kami akan hapus dari sistem produksi dalam **14 hari** dan mempercepat penghapusan backup dalam **60 hari maksimum**

Data yang wajib disimpan sesuai hukum pajak (10 tahun per UU KUP) tetap disimpan dalam bentuk **teranonimkan atau terisolasi** hingga masa retensi wajib berakhir.

### 7.4 Backup

Kami menjalankan backup harian otomatis dan telah **memverifikasi restorability** backup tersebut (drill terakhir: 2026-07-18). Anda dapat meminta restore ke titik waktu tertentu (RTO target: 30 menit, RPO target: 24 jam) melalui `support@caleo.id`.

## 8. Kekayaan Intelektual

### 8.1 Milik Kami

Seluruh source code, desain, logo, branding, dokumentasi, dan komponen platform Caleo adalah milik kami dan/atau licensor kami, dilindungi oleh hak cipta dan undang-undang terkait. Anda diberi **lisensi terbatas non-eksklusif** untuk menggunakan Layanan sesuai S&K ini.

### 8.2 Milik Anda

Data Pelanggan dan konten yang Anda hasilkan menggunakan Layanan tetap milik Anda. Anda memberi kami **lisensi terbatas** untuk menghosting, memproses, mem-backup, dan menampilkan konten tersebut kembali kepada Anda sebagai bagian dari Layanan.

### 8.3 Feedback

Bila Anda memberikan saran/feedback, Anda memberi kami hak untuk menggunakannya dalam pengembangan Layanan tanpa kewajiban kompensasi.

## 9. Fitur AI (Calista)

Bila Anda mengaktifkan fitur AI Calista (asisten WhatsApp bertenaga LLM):

1. Data percakapan WhatsApp Anda akan diproses oleh model LLM (OpenRouter/Google AI Studio) untuk menghasilkan respon
2. Kami **tidak** melatih model dengan data Anda
3. Kami menggunakan sub-prosesor LLM yang menyatakan tidak menyimpan/melatih dari data input Anda (mis. Google AI Studio Free Tier: 24 jam retensi untuk moderasi, kemudian dihapus)
4. **Anda bertanggung jawab** memberitahu pelanggan Anda bahwa mereka berinteraksi dengan asisten AI (sesuai UU PDP dan best-practice)
5. Kami tidak menjamin akurasi 100% dari respon AI — Anda wajib mereview kritis untuk keputusan bisnis penting

## 10. Suspensi dan Terminasi

### 10.1 Oleh Kami

Kami dapat menangguhkan atau menghentikan akses Anda dalam kasus:

- Pelanggaran S&K ini yang tidak diperbaiki dalam 7 hari setelah pemberitahuan tertulis
- Pelanggaran serius (fraud, aktivitas ilegal, ancaman keamanan) — suspensi bisa segera tanpa pemberitahuan
- Tidak dibayarnya invoice dalam 14 hari setelah jatuh tempo
- Force majeure atau kebijakan hukum yang mewajibkan penghentian
- Kami menghentikan layanan secara keseluruhan (dengan pemberitahuan minimal 60 hari)

### 10.2 Oleh Anda

Anda dapat menghentikan berlangganan kapan saja melalui pengaturan akun atau email ke `support@caleo.id`. Berlangganan berhenti pada akhir periode berjalan.

### 10.3 Efek terminasi

- Akses ke Layanan berakhir
- Data Anda tersedia untuk export selama 30 hari (grace period)
- Setelah 30 hari, data dihapus permanen kecuali diwajibkan disimpan oleh hukum
- Kewajiban pembayaran hingga tanggal terminasi tetap berlaku

## 11. Disclaimer dan Batasan Tanggung Jawab

### 11.1 Disclaimer

Layanan disediakan **"AS IS"** dan **"AS AVAILABLE"**. Kami menolak segala jaminan tersirat, termasuk merchantability dan fitness for particular purpose, sepanjang diperbolehkan oleh hukum.

Kami tidak menjamin:
- Layanan bebas dari bug atau error
- Layanan selalu memenuhi kebutuhan spesifik bisnis Anda
- Hasil kalkulasi/laporan akuntansi/pajak akurat 100% — Anda wajib review dan konsultasi dengan akuntan/konsultan pajak untuk keputusan resmi

### 11.2 Batasan tanggung jawab

Sepanjang diperbolehkan oleh hukum, **total tanggung jawab kami** terhadap Anda dalam setiap 12 bulan berjalan **TIDAK MELEBIHI** total biaya berlangganan yang telah Anda bayarkan kepada kami dalam 12 bulan tersebut.

Kami tidak bertanggung jawab atas:
- Kerugian tidak langsung, konsekuensial, insidental, atau special damages
- Kehilangan keuntungan, kehilangan bisnis, kehilangan reputasi
- Kerugian akibat kegagalan sub-prosesor pihak ketiga di luar kendali kami
- Kerugian akibat kesalahan input data oleh Anda atau user Anda
- Kerugian akibat force majeure

Batasan ini **TIDAK** berlaku untuk: kelalaian berat/kesengajaan kami, pelanggaran kewajiban perlindungan data pribadi yang menimbulkan kerugian material terbukti, atau kewajiban yang tidak dapat dikecualikan berdasarkan UU Perlindungan Konsumen.

## 12. Indemnifikasi

Anda setuju untuk **mengganti rugi (indemnify) dan melindungi (hold harmless)** kami dari segala klaim pihak ketiga yang timbul akibat:

1. Pelanggaran S&K ini oleh Anda
2. Data yang Anda masukkan ke Layanan (mis. Anda memasukkan data pelanggan tanpa persetujuan mereka, lalu mereka mengklaim ke Caleo)
3. Penggunaan Layanan yang melanggar hukum

## 13. Force Majeure

Tidak ada pihak yang bertanggung jawab atas kegagalan memenuhi kewajiban akibat force majeure — kejadian di luar kendali wajar, termasuk namun tidak terbatas pada: bencana alam, perang, terorisme, cyberattack terkoordinasi masif, pandemi, kegagalan infrastruktur listrik/internet nasional, tindakan pemerintah/regulator yang tidak terduga.

## 14. Perubahan S&K

Kami dapat memperbarui S&K dari waktu ke waktu. Perubahan material:

- Diberitahukan melalui email ke pemilik akun minimal **30 hari** sebelum berlaku
- Dipublikasikan di halaman ini dengan versi + tanggal efektif baru
- Bila Anda tidak setuju dengan perubahan, Anda dapat menghentikan berlangganan sebelum tanggal efektif — biaya periode berjalan tetap harus dibayar

Perubahan minor (perbaikan bahasa, klarifikasi, ejaan) berlaku segera tanpa pemberitahuan formal.

## 15. Hukum yang Berlaku dan Yurisdiksi

S&K ini tunduk pada hukum **Republik Indonesia**. Perselisihan diselesaikan melalui:

1. **Musyawarah**: kontak `support@caleo.id` — kami wajib merespon dalam 7 hari kerja
2. **Mediasi** melalui lembaga mediasi yang disepakati bersama
3. **Pengadilan Negeri `[REVIEW: yurisdiksi sesuai domisili PT — umumnya Jakarta Pusat/Jakarta Selatan]`** sebagai forum terakhir

## 16. Ketentuan Lain

### 16.1 Severability

Bila salah satu ketentuan dinyatakan tidak sah oleh pengadilan, ketentuan lain tetap berlaku.

### 16.2 Waiver

Kegagalan kami menegakkan hak dalam S&K bukan berarti pelepasan hak untuk menegakkannya di kemudian hari.

### 16.3 Assignment

Anda tidak dapat mengalihkan hak/kewajiban dalam S&K tanpa persetujuan tertulis kami. Kami dapat mengalihkan kepada afiliasi atau successor korporasi tanpa persetujuan Anda.

### 16.4 Notice

Notifikasi resmi ke Anda dikirim ke email pemilik akun yang terdaftar. Notifikasi ke kami dikirim ke `legal@caleo.id`.

### 16.5 Bahasa

S&K ini disusun dalam **Bahasa Indonesia**. Bila di kemudian hari ada terjemahan Bahasa Inggris, versi Bahasa Indonesia yang mengikat.

## 17. Kontak

- **Support umum**: `support@caleo.id`
- **Billing**: `billing@caleo.id`
- **Legal**: `legal@caleo.id`
- **Security**: `security@caleo.id`
- **Privacy**: `privacy@caleo.id`
- **Alamat surat**: `[REVIEW: alamat kantor]`

---

**Catatan review untuk founder** (hapus sebelum publikasi):
- Isi item `[REVIEW: ...]` — legal entity, alamat, paket harga, PPN, SLA target, yurisdiksi
- Konsultasi dengan legal counsel Indonesia untuk validasi klausul batasan tanggung jawab (dapat dikecualikan atau tidak menurut UU Perlindungan Konsumen)
- Selaraskan Pasal 5 (paket & harga) dengan halaman pricing di landing page
- Update tanggal efektif saat publikasi
