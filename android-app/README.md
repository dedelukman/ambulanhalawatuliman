# SI-Ambulans Relawan — Aplikasi Android

Aplikasi Android resmi untuk SI-Ambulans Relawan (Markaz Halawatul Iman). Aplikasi ini
membungkus aplikasi web yang sudah ada dengan **Capacitor 8**, lalu menambahkan fitur
native yang tidak bisa dilakukan browser:

| Fitur native | Cara kerja |
| --- | --- |
| **Notifikasi tugas** | Notifikasi sistem Android saat ada permintaan baru (admin), tugas ambulans (driver), atau tugas jenazah (Tim Janaiz). Muncul saat aplikasi terbuka maupun berjalan di latar belakang. |
| **Push notification** | FCM untuk notifikasi saat aplikasi benar-benar ditutup. Perlu `google-services.json` + Cloud Function (lihat di bawah). |
| **Update lokasi HP** | `watchPosition` dialihkan ke *foreground service* lokasi Android, jadi posisi driver tetap terkirim ke Firestore walau layar mati atau aplikasi di latar belakang. Notifikasi permanen "Berbagi lokasi aktif" tampil selama pelacakan (wajib dari Android). |
| **Tombol back** | Kembali ke halaman sebelumnya / beranda; keluar hanya dari beranda dengan dua kali tekan (2 detik). |

Web asli di root proyek **tidak diubah**. Folder `android-app/www` adalah hasil salin
otomatis saat build, jadi perbaikan di `index.html`, `js/*.js`, dan seterusnya langsung
ikut ke aplikasi Android.

## Struktur

```
android-app/
├── capacitor.config.json     # appId, nama aplikasi, ikon notifikasi
├── package.json              # dependensi Capacitor + skrip build
├── src/native-bridge.js      # jembatan lokasi latar belakang, notifikasi, push, tombol back
├── scripts/
│   ├── copy-web.mjs          # salin web -> www/ dan sisipkan native-bridge.js
│   ├── build-android.mjs     # cari JDK 17+ & Android SDK, jalankan Gradle
│   ├── make-icons.mjs        # ikon launcher, ikon notifikasi, aset Play Store
│   └── make-keystore.mjs     # buat kunci upload Play Store
├── android/                  # proyek Android native (Gradle)
├── functions/                # Cloud Function opsional pengirim push FCM
├── play-store/               # ikon 512px + feature graphic 1024x500
└── keystore/                 # JANGAN di-commit (sudah masuk .gitignore)
```

## Prasyarat

- **Node.js 22+**
- **JDK 17 atau 21** — skrip build mencari otomatis di `JAVA_HOME`, `C:\Program Files\Zulu\zulu-21`,
  Android Studio JBR, dan lokasi umum lain. Bisa dipaksa dengan `SI_JAVA_HOME`.
- **Android SDK** dengan `platforms/android-36` dan `build-tools` 36.x.
  Skrip memakai `ANDROID_HOME`, `ANDROID_SDK_ROOT`, atau `%LOCALAPPDATA%\Android\Sdk`.
- Android Studio (opsional, untuk menjalankan di emulator/HP dan merilis).
- `js/firebase-init.js` di root proyek harus ada (file konfigurasi Firebase, di-ignore git).
  Tanpa file ini aplikasi Android tidak bisa terhubung ke Firestore.

## Build

```bash
cd android-app
npm install

npm run debug      # APK debug untuk uji di HP
npm run apk        # APK release bertanda tangan (untuk dipasang manual di HP)
npm run release    # AAB release bertanda tangan untuk Play Store
```

Hasil build:

- APK debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- APK release: `android/app/build/outputs/apk/release/app-release.apk`
- AAB release: `android/app/build/outputs/bundle/release/app-release.aab`

Pasang APK debug ke HP yang terhubung:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Buka di Android Studio: `npm run open`.

`npm run sync` saja (tanpa build) berguna setelah mengubah file web: menyalin web terbaru
ke `www/` lalu menyinkronkan plugin.

## Kunci upload & Play App Signing

Kunci upload sudah dibuat di `keystore/si-ambulans-release.jks` dengan kata sandi acak yang
tersimpan di `keystore/keystore.properties` (keduanya di-ignore git).

> **PENTING:** cadangkan folder `android-app/keystore/` ke tempat aman **sekarang**.
> Tanpa file `.jks` dan kata sandinya, Anda tidak bisa mengunggah update aplikasi.
> Folder ini tidak boleh masuk repository publik.

Untuk membuat kunci baru di komputer lain: `npm run keystore` (hanya jika belum ada).

Saat unggah pertama di Play Console, aktifkan **Play App Signing** (disarankan Google).
Play Console akan memegang kunci penandatangan aplikasi; file `.jks` di atas menjadi
*kunci upload*. Bila kunci upload hilang, Play Console menyediakan "Reset upload key".

Sebelum setiap unggahan, naikkan `versionCode` di `android/app/build.gradle`
(`versionName` juga bila perlu). Play menolak `versionCode` yang sudah dipakai.

## Push notification (agar notifikasi tetap masuk saat aplikasi ditutup)

Notifikasi sistem sudah bekerja tanpa konfigurasi tambahan selama aplikasi terbuka atau
di latar belakang. Untuk push saat aplikasi dimatikan, aplikasi **wajib** memakai FCM:
Android menghentikan proses WebView saat aplikasi ditutup, sehingga JavaScript tidak bisa
lagi memantau Firestore.

### Cara otomatis

```bash
npx firebase-tools login          # sekali saja, lewat browser
npm run push:setup                # daftarkan app Android + unduh google-services.json
npm run push:setup -- --deploy    # deploy Cloud Function (butuh paket Blaze)
npm run apk                       # APK baru dengan push aktif
```

### Cara manual

1. **Daftarkan aplikasi Android di Firebase**
   - Firebase Console → proyek `ambulanhalawatuliman` → Add app → Android.
   - Package name: `com.halawatuliman.siambulans`.
   - Unduh `google-services.json` dan letakkan di `android-app/android/app/google-services.json`.
   - Build ulang (`npm run release`). Plugin Google Services otomatis aktif bila file itu ada.

2. **Deploy Cloud Function** (butuh paket Firebase Blaze)
   ```bash
   cd android-app/functions
   npm install
   firebase deploy --only functions
   ```
   Function `notifikasiPermintaan` memantau dokumen `si_state/permintaan`:
   - status menjadi **Menunggu** → notifikasi ke peran `admin`
   - status menjadi **Diproses** → notifikasi ke peran `driver` (dan `janaiz` untuk permintaan jenazah)

3. **Firestore Rules** — token perangkat disimpan di dokumen `si_state/push_tokens`,
   memakai path yang sama dengan data aplikasi lain, jadi tidak perlu aturan baru.

Token disimpan perangkat setelah driver/admin login. Bila pengguna berganti peran,
token diperbarui otomatis saat aplikasi dibuka kembali.

## Jika notifikasi tidak muncul

1. **Login dengan peran yang benar** — notifikasi hanya untuk admin (permintaan baru),
   driver (tugas ambulans), dan Tim Janaiz (tugas jenazah). Pemohon/tamu tidak menerima.
2. **Izinkan notifikasi**: Pengaturan → Aplikasi → SI Ambulans → Notifikasi.
   Aplikasi menampilkan bar merah "Notifikasi tugas nonaktif" bila izin ditolak.
3. **Aplikasi harus berjalan** (terbuka atau di latar belakang). Notifikasi saat aplikasi
   benar-benar ditutup memerlukan push FCM (bagian di atas).
4. Gunakan versi **1.0.1+**; versi 1.0.0 memiliki bug sehingga notifikasi tidak pernah aktif.

## Izin Android dan kebijakan Play Store

Aplikasi meminta:

- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` — posisi driver.
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` — pelacakan saat layar mati.
- `POST_NOTIFICATIONS` — notifikasi tugas.
- `INTERNET`, `ACCESS_NETWORK_STATE`.

**Tidak** memakai `ACCESS_BACKGROUND_LOCATION`, sehingga tidak perlu mengajukan deklarasi
"background location" yang lebih berat. Lokasi hanya berjalan selama driver menekan login
dan berhenti saat logout.

Yang perlu diisi di Play Console:

1. **Target API 36** — sudah diatur (`compileSdk`/`targetSdk` 36), wajib sejak 31 Agustus 2026.
2. **App access** — berikan akun uji untuk reviewer (username + PIN driver, dan akun admin),
   karena sebagian fitur di balik login.
3. **Data safety** — deklarasikan: lokasi presisi (dikumpulkan saat driver bertugas),
   nama & nomor HP pemohon, data permintaan. Data diproses/di Hosting-kan lewat Firebase
   (Firestore) sebagai penyedia layanan.
4. **Foreground service → Location** — Play Console meminta deklarasi ini karena aplikasi
   memakai `FOREGROUND_SERVICE_LOCATION`. Isi: pelacakan posisi ambulans selama tugas,
   dimulai pengguna dengan login driver, dengan notifikasi permanen yang terlihat.
5. **Kebijakan privasi** — wajib berupa URL publik. Buat halaman privasi yang menjelaskan
   penggunaan lokasi driver, data pemohon, dan penyimpanan di Firebase.
6. **Ikon & grafis** — `play-store/icon-512.png` (512×512) dan
   `play-store/feature-graphic-1024x500.png` (1024×500).
7. **Screenshot** — minimal 2 tangkapan layar HP (beranda, panel driver/dashboard).
   Belum disediakan di repo ini.
8. **Konten & rating** — isi kuesioner rating konten; kategori aplikasi: Medis atau
   Gaya hidup (layanan komunitas).

## Catatan & batasan

- Lokasi latar belakang memakai foreground service; Android menampilkan notifikasi
  permanen selama pelacakan. Ini normal dan tidak bisa disembunyikan.
- GPS hanya aktif setelah driver login, dan berhenti otomatis saat logout.
- Notifikasi saat aplikasi dimatikan memerlukan langkah push di atas.
- Ganti `appId` (`com.halawatuliman.siambulans`) hanya **sebelum** unggahan pertama.
  Setelah terbit, package name tidak bisa diubah.
