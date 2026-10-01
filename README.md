# Home Finance

Aplikasi pengelola keuangan rumah tangga: Node.js + Express (REST API), SQLite (relasional), frontend HTML/CSS/JS + Chart.js.

## Struktur
```
home-finance/
├── package.json
├── .env.example
├── db/schema.sql        # skema + index + foreign key (dijalankan otomatis saat start)
├── src/
│   ├── server.js        # Express, security header, error handler (tanpa error DB mentah)
│   ├── db.js            # koneksi DB + migrasi
│   └── routes.js        # auth, categories, transactions, budgets, dashboard, reports
└── public/
    ├── index.html
    ├── app.css
    └── app.js           # SPA: login, dashboard, transaksi, budget, kategori, laporan, profil
```

## Menjalankan lokal
Butuh Node.js 18+.
```bash
npm install
cp .env.example .env
# isi JWT_SECRET (min. 32 karakter):
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm start          # lalu buka http://localhost:3000
```
Klik **Daftar** untuk membuat akun; kategori default dibuat otomatis. Tidak ada transaksi dummy.

## Database
- Default: SQLite, file di `DATABASE_PATH` (`./data/homefinance.db`). Dibuat otomatis, data tetap tersimpan setelah refresh/restart. Tidak perlu install server database.
- Migrasi manual: `npm run migrate` (skema idempotent, aman diulang).
- Backup: salin file `data/homefinance.db`.
- Pindah ke PostgreSQL/MySQL: `db/schema.sql` hampir kompatibel (ganti `AUTOINCREMENT` → `SERIAL`/`AUTO_INCREMENT`), lalu ganti isi `src/db.js` dan query di `src/routes.js` ke driver pilihan (`pg`/`mysql2`).

## API (semua kecuali register/login butuh login; cookie httpOnly berisi JWT)
| Method | Endpoint |
|---|---|
| POST | /api/auth/register, /api/auth/login, /api/auth/logout |
| GET/PUT | /api/auth/me |
| GET | /api/dashboard |
| GET/POST | /api/transactions (filter: q, type, category_id, from, to, page, limit) |
| GET/PUT/DELETE | /api/transactions/:id |
| GET/POST | /api/categories · PUT/DELETE /api/categories/:id |
| GET/POST | /api/budgets?month=&year= · PUT/DELETE /api/budgets/:id |
| GET | /api/reports?range=week\|month\|lastmonth\|year\|custom&from=&to= |
| GET | /api/reports/export.csv (parameter sama) |

## Keamanan
bcrypt hashing, JWT di cookie httpOnly + SameSite=Lax (Secure di production), semua query memakai parameter (`?`) dan selalu memfilter `user_id`, validasi ownership sebelum edit/hapus, validasi di frontend dan backend, output HTML di-escape, header CSP, secret lewat environment variable.
Untuk deploy publik: gunakan HTTPS, `NODE_ENV=production`, dan tambahkan rate limiting pada `/api/auth/*` (mis. paket `express-rate-limit`).

## Catatan
- Jumlah uang disimpan sebagai bilangan bulat rupiah (tanpa sen).
- Saldo tidak disimpan; selalu dihitung dari transaksi.
- Kategori yang masih dipakai transaksi tidak bisa dihapus (pesan jelas ditampilkan).
