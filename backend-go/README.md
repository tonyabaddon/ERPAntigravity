# ⚡ Sinar Elektrik - Go & Supabase Cloud Backend

Backend handal ini ditulis menggunakan bahasa pemrograman **Go (Golang)** yang terintegrasi secara modular dengan database **Supabase PostgreSQL**. Sistem ini dirancang untuk membaca, memperbaharui, dan mensinkronisasikan ketersediaan stok serta pricing katalog kelistrikan toko Sinar Elektrik secara real-time.

---

## 🛠️ Langkah 1: Persiapan Database di Supabase

### 1. Buat Tabel Data Stok
Buka **Dashboard Supabase**, lalu masuk ke menu **SQL Editor** dan jalankan perintah DDL query berikut untuk menginisialisasi tabel `stocks`:

```sql
CREATE TABLE IF NOT EXISTS public.stocks (
    sku VARCHAR(50) PRIMARY KEY,
    name TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    price NUMERIC NOT NULL,
    stock INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Atur tabel agar dapat diakses publik atau tambahkan policy RLS sesuai kebutuhan Anda
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;

-- Policy untuk mengizinkan Anonymous Read/Write data (opsional untuk kemudahan demo)
CREATE POLICY "Allow Public Access" ON public.stocks 
    FOR ALL USING (true) WITH CHECK (true);
```

### 2. Dapatkan Connection String Supabase Anda
1. Di Dashboard Supabase, pergi ke menu **Project Settings > Database**.
2. Gulir ke bagian **Connection string** lalu pilih tab **URI** atau **Node.js/Go**.
3. Format URL-nya akan terlihat seperti ini:  
   `postgres://postgres.[PROJECT_ID]:[YOUR_PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

---

## 🚀 Langkah 2: Menjalankan Go Backend

1. Buka folder backend-go Anda:
   ```bash
   cd backend-go
   ```

2. Jalankan perintah instalasi dependency driver PostgreSQL:
   ```bash
   go mod download
   ```

3. Daftarkan kredensial Connection String Supabase yang Anda peroleh sebelumnya pada Environment Variable:
   ```bash
   # Di Linux/macOS:
   export SUPABASE_DB_CONNECTION="postgres://postgres.[YOUR_PROJECT]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
   export PORT=8080

   # Di Windows (Command Prompt):
   set SUPABASE_DB_CONNECTION="postgres://postgres.[YOUR_PROJECT]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
   set PORT=8080
   ```

4. Jalankan Go Server Anda:
   ```bash
   go run main.go
   ```

Server akan aktif pada alamat `http://localhost:8080/api/stocks` dan otomatis menyinkronkan seluruh perubahan harga & stok dengan Supabase Cloud!

---

## 🔗 Endpoint List yang Disediakan

| Metode | Jalur (Path) | Fungsi / Tanggung Jawab |
| :--- | :--- | :--- |
| **GET** | `/api/health` | Mengecek status keaktifan server API Go |
| **GET** | `/api/stocks` | Mengambil seluruh katalog produk aktif dari Supabase |
| **POST**| `/api/stocks` | Melakukan insert / update (UPSERT) produk dengan aman |
| **PUT** | `/api/stocks/:sku` | Memperbarui nominal harga & kuantitas item stok |
| **DELETE**| `/api/stocks/:sku` | Menghapus listing produk dari database cloud |

---

## 💻 Integrasi ke React Frontend (Aplikasi Sinar Elektrik)
Untuk menghubungkan panel editor ke Supabase Cloud secara langsung, isi environment variables di file `.env` aplikasi utama Anda:
```env
VITE_SUPABASE_URL="https://[YOUR_PROJECT_ID].supabase.co"
VITE_SUPABASE_ANON_KEY="[YOUR_ANON_PUBLIC_KEY]"
```
Aplikasi Sinar Elektrik React Frontend akan mendeteksi konfigurasi tersebut secara otomatis dan beralih dari penyimpanan luring `localStorage` ke Sinkronisasi Awan secara instan!
