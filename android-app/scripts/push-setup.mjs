/* push-setup.mjs — menyiapkan push notification FCM untuk aplikasi Android.
   Otomatis: daftarkan aplikasi Android di Firebase (bila belum ada) dan unduh
   google-services.json. Butuh login Firebase CLI (`npx firebase-tools login`).

   Pakai:
     npm run push:setup              # daftar app + unduh google-services.json
     npm run push:setup -- --deploy  # sekaligus deploy Cloud Function (butuh Blaze)
*/
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');

const PROJECT = 'ambulanhalawatuliman';
const PACKAGE_NAME = 'com.halawatuliman.ambulan';
const APP_LABEL = 'Ambulan dan Janaiz';
const CONFIG_PATH = path.join(appDir, 'android', 'app', 'google-services.json');

const firebase = 'npx';
const FIREBASE_ARGS = ['--yes', 'firebase-tools@latest'];

function run(args, { capture = true } = {}) {
  const res = spawnSync(firebase, FIREBASE_ARGS.concat(args), {
    cwd: appDir,
    encoding: 'utf8',
    // Di Windows npx adalah .cmd sehingga harus lewat shell.
    shell: process.platform === 'win32',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (capture && res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error('firebase ' + args.join(' ') + ' gagal:\n' + detail);
  }
  return (res.stdout || '').trim();
}

function tryJson(text) {
  const start = text.indexOf('{');
  return start === -1 ? null : JSON.parse(text.slice(start));
}

if (existsSync(CONFIG_PATH)) {
  console.log('[push] google-services.json sudah ada: ' + path.relative(appDir, CONFIG_PATH));
  console.log('[push] Jalankan `npm run apk` untuk membangun ulang APK dengan push aktif.');
  if (!process.argv.includes('--deploy')) process.exit(0);
}

console.log('[push] memeriksa login Firebase CLI…');
let login = '';
try {
  login = run(['login:list']);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (/No authorized accounts/i.test(login)) {
  console.error('\nBelum login Firebase. Jalankan dulu:\n');
  console.error('  npx firebase-tools login --reauth\n');
  console.error('lalu ulangi: npm run push:setup\n');
  process.exit(1);
}

console.log('[push] mencari aplikasi Android di proyek ' + PROJECT + '…');
let appId = null;
try {
  const parsed = tryJson(run(['apps:list', 'android', '--project', PROJECT, '--json']));
  const apps = (parsed && parsed.result) || [];
  const found = apps.find(app => app.packageName === PACKAGE_NAME || app.namespace === PACKAGE_NAME);
  if (found) appId = found.appId;
} catch (error) {
  if (/401|UNAUTHENTICATED|invalid authentication/i.test(error.message)) {
    console.error('\nSesi Firebase CLI kedaluwarsa. Jalankan dulu:\n');
    console.error('  npx firebase-tools login --reauth\n');
    console.error('lalu ulangi: npm run push:setup\n');
    process.exit(1);
  }
  console.warn('[push] tidak bisa membaca daftar aplikasi: ' + error.message);
}

if (!appId) {
  console.log('[push] mendaftarkan aplikasi Android baru (' + PACKAGE_NAME + ')…');
  run(['apps:create', 'android', APP_LABEL, '--package-name', PACKAGE_NAME, '--project', PROJECT]);
  const parsed = tryJson(run(['apps:list', 'android', '--project', PROJECT, '--json']));
  const apps = (parsed && parsed.result) || [];
  const found = apps.find(app => app.packageName === PACKAGE_NAME || app.namespace === PACKAGE_NAME);
  appId = found ? found.appId : null;
}

if (!appId) {
  console.error('[push] gagal menemukan appId Android. Buka Firebase Console → Project settings → Your apps.');
  process.exit(1);
}

console.log('[push] mengunduh google-services.json (appId ' + appId + ')…');
run(['apps:sdkconfig', 'android', appId, '--project', PROJECT, '--out', CONFIG_PATH]);
console.log('[push] selesai: ' + path.relative(appDir, CONFIG_PATH));

if (process.argv.includes('--deploy')) {
  console.log('[push] deploy Cloud Function pengirim notifikasi…');
  run(['deploy', '--only', 'functions', '--project', PROJECT], { capture: false });
  console.log('[push] function ter-deploy. Jalankan `npm run apk` untuk membangun ulang APK.');
} else {
  console.log('\nLangkah berikutnya:');
  console.log('  1. npm run push:setup -- --deploy   (butuh paket Firebase Blaze)');
  console.log('  2. npm run apk                       (APK baru dengan push aktif)');
}
