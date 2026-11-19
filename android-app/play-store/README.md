# Aset & Deklarasi Play Store — Ambulan dan Janaiz

Paket: `com.halawatuliman.ambulan` · versi 1.0.0 (versionCode 1)
Bundel unggahan: `android-app/android/app/build/outputs/bundle/release/app-release.aab`

## 1. Aset yang sudah tersedia

| Aset | File | Ukuran | Syarat Play | Status |
|---|---|---|---|---|
| Ikon aplikasi | `icon-512.png` | 512 × 512 | 512 × 512, PNG 32-bit, tanpa alpha | ✅ (pastikan latar penuh) |
| Feature graphic | `feature-graphic-1024x500.png` | 1024 × 500 | tepat 1024 × 500, JPG/PNG, tanpa alpha | ✅ |
| Screenshot ponsel 1 | `screenshot-01-beranda.png` | 1080 × 1920 (9:16) | min 2, min 320 px, maks 3840 px | ✅ |
| Screenshot ponsel 2 | `screenshot-02-form-jenazah.png` | 1080 × 1920 (9:16) | — | ✅ |
| Screenshot ponsel 3 | `screenshot-03-login.png` | 1080 × 1920 (9:16) | — | ✅ |
| Kebijakan privasi | `../privasi.html` (situs) | — | URL publik wajib | ⚠️ unggah ke hosting dulu |

URL kebijakan privasi setelah diunggah:
`https://ambulanhalawatuliman.freehosting.dev/privasi.html`

Screenshot diambil ulang dengan Chrome headless pada viewport 432×768 @2.5x
(hasil 1080×1920). Skrip pengambil: `android-app/.capture-screens.mjs`.

Belum wajib, bisa ditambahkan bila ingin: screenshot tablet 7"/10" (min 2),
dan video promosi (YouTube, 30 detik–2 menit).

## 2. Teks listing (siap tempel)

**Nama aplikasi (maks 30)**
```
Ambulan dan Janaiz
```

**Deskripsi singkat (maks 80)**
```
Permohonan ambulans & pengurusan jenazah gratis, siaga 24 jam.
```

**Deskripsi lengkap (maks 4000)**
```
Ambulan dan Janaiz adalah layanan ambulans dan pengurusan jenazah Markaz Halawatul Iman untuk warga — cepat, sigap, dan tidak dipungut biaya sewa (sukarela).

FITUR UNTUK WARGA
• Buat permohonan ambulans untuk pasien: jemput, antar ke fasilitas kesehatan, lengkap dengan alamat dan tujuan.
• Mohon pengurusan jenazah: data jenazah, waktu meninggal, tempat dishalatkan, dan lokasi pemakaman.
• Permohonan ambulans jenazah (pengantaran saja) dan formulir gabungan ambulans + pengurusan jenazah.
• Isi cepat hari dan tanggal (kemarin, hari ini, besok) agar pengisian lebih singkat.
• Alamat dan tautan peta terisi otomatis dari lokasi perangkat, bisa diperbaiki manual.
• Pantau posisi ambulans yang bertugas.
• Hubungi petugas langsung melalui WhatsApp.

FITUR UNTUK PETUGAS
• Admin: kelola armada, driver, permintaan masuk, dan riwayat layanan.
• Driver: terima tugas, navigasi ke titik jemput dan tujuan, serta pembaruan lokasi selama bertugas.
• Tim Janaiz: terima dan konfirmasi tugas pengurusan jenazah.
• Notifikasi tugas baru dan perubahan status permohonan.

TENTANG LAYANAN
Layanan dijalankan oleh relawan Markaz Halawatul Iman, Bogor, Jawa Barat. Ambulans melayani pengantaran/penjemputan tanpa tindakan medis selama perjalanan dan tidak melayani pemesanan (booking). Pastikan permohonan pengurusan jenazah telah disetujui DKM/RT setempat.

Darurat (WhatsApp): 0812-6000-2341

Kebijakan Privasi: https://ambulanhalawatuliman.freehosting.dev/privasi.html
```

**Kategori aplikasi:** Medical (atau Tools bila ingin lebih netral)
**Tag:** ambulans, layanan darurat, jenazah, relawan
**Email kontak pengembang:** (email pemilik akun Play Console)
**Situs web:** https://ambulanhalawatuliman.freehosting.dev
**Kebijakan privasi:** https://ambulanhalawatuliman.freehosting.dev/privasi.html

## 3. Deklarasi App content (jawaban per pertanyaan)

**App access** — Sebagian fitur butuh login.
Berikan akun demo untuk reviewer:
- Admin: halaman `login.html` → tab Admin.
- Driver: tab Driver.
- Tim Janaiz: tab Tim Janaiz.
Isi username/PIN akun demo yang memang aktif (jangan memakai akun produksi), lalu tulis
di kolom instruksi: "Form permohonan warga terbuka tanpa login. Area petugas memerlukan
akun demo di atas (tab Admin / Driver / Tim Janaiz pada halaman login)."

**Ads** — Tidak ada iklan.

**In-app purchases** — Tidak ada pembelian dalam aplikasi; layanan gratis.

**Target audience** — 18 tahun ke atas (dewasa). Bukan aplikasi untuk anak.

**News app** — Bukan.

**COVID-19 contact tracing** — Bukan.

**Data safety** — ringkasan jawaban:

| Kategori | Data | Dikumpulkan | Dibagikan | Opsional | Tujuan |
|---|---|---|---|---|---|
| Info pribadi | Nama | Ya | Tidak | Tidak | Fungsi aplikasi |
| Info pribadi | Nomor telepon | Ya | Tidak | Tidak | Fungsi aplikasi |
| Info pribadi | Alamat | Ya | Tidak | Tidak | Fungsi aplikasi |
| Lokasi | Perkiraan lokasi | Ya | Tidak | Ya (izin bisa ditolak) | Fungsi aplikasi |
| Lokasi | Lokasi presisi | Ya | Tidak | Ya | Fungsi aplikasi |
| Lokasi | Lokasi presisi di latar belakang | Ya (khusus akun driver saat bertugas) | Tidak | Ya | Fungsi aplikasi |
| Kesehatan | Info kesehatan lain (riwayat sakit) | Ya | Tidak | Tidak | Fungsi aplikasi |
| Info aplikasi | ID perangkat/lainnya (token FCM) | Ya | Tidak | Tidak | Fungsi aplikasi |
| Aktivitas aplikasi | Tindakan dalam aplikasi (log tugas) | Ya | Tidak | Tidak | Fungsi aplikasi |

- Data dienkripsi saat transit: **Ya** (HTTPS ke Firebase).
- Pengguna dapat meminta penghapusan data: **Ya** — melalui WhatsApp 0812-6000-2341
  (dijelaskan di kebijakan privasi).
- Tidak ada data yang dijual; tidak ada iklan/pelacakan iklan.

**Permissions declaration (akses lokasi latar belakang)**
```
Aplikasi memakai lokasi latar belakang hanya untuk akun driver yang sedang bertugas,
agar posisi ambulans dapat dipantau admin dan warga selama pengantaran. Pelacakan
berhenti saat driver logout atau tugas selesai. Untuk pengguna umum, lokasi hanya
diambil sekali saat menekan tombol "Aktifkan / Perbarui Lokasi" atau saat halaman
dibuka, guna mengisi alamat dan tautan peta.
```

**Health apps declaration** — Bukan aplikasi medis/alat kesehatan. Aplikasi hanya
mencatat riwayat sakit yang diisi pemohon sebagai informasi untuk petugas ambulans;
tidak memberi diagnosis, resep, atau tindakan medis.

**Government apps** — Bukan aplikasi pemerintah.

**Financial features** — Tidak ada fitur keuangan/pembayaran untuk pengguna.
(Halaman kas internal yayasan tidak diakses publik.)

**Content rating** — jawaban kuesioner (kategori Utility, Communication, atau Other):
- Kekerasan, konten seksual, bahasa kasar, narkoba, perjudian: **Tidak ada**.
- Berbagi lokasi pengguna dengan pengguna lain: **Ya** (lokasi driver dibagikan ke
  admin dan halaman lacak ambulans selama bertugas).
- Pembelian digital, iklan, konten buatan pengguna: **Tidak ada**.
- Hasil yang diharapkan: rating **3+ / Everyone** (setelah kuesioner).

**Play App Signing** — Aktifkan saat membuat aplikasi. Kunci unggahan yang dipakai
sekarang: `android-app/keystore/si-ambulans-release.jks` (alias dan kata sandi
tersimpan di `android-app/keystore/keystore.properties`). Simpan file dan kata sandinya; tanpa itu
pembaruan aplikasi tidak bisa diunggah.

## 4. Langkah unggah

1. Play Console → **Create app** → nama `Ambulan dan Janaiz`, bahasa Indonesia,
   jenis **App**, **Free**.
2. **App content**: isi semua deklarasi di bagian 3 (privasi, akses aplikasi,
   iklan, rating konten, target audiens, data safety, izin lokasi latar belakang).
3. **Store listing**: tempel teks bagian 2, unggah ikon, feature graphic, dan
   3 screenshot.
4. **Testing → Internal testing**: unggah `app-release.aab`, tambahkan email penguji,
   lalu uji dari Play Store (pastikan notifikasi dan lokasi berjalan di build dari Play).
5. **Production → Create release**: pilih bundel yang sama, isi catatan rilis, kirim
   untuk ditinjau.
6. Setiap rilis berikutnya: naikkan `versionCode` di `android-app/android/app/build.gradle`,
   jalankan `npm run release`, unggah AAB baru.
