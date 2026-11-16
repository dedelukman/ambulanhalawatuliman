/* make-keystore.mjs — membuat kunci upload Play Store (sekali saja) beserta
   keystore.properties yang dibaca android/app/build.gradle.
   Simpan folder keystore/ di tempat aman: kunci ini tidak bisa dibuat ulang. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const keystoreDir = path.join(appDir, 'keystore');
const jksPath = path.join(keystoreDir, 'si-ambulans-release.jks');
const propsPath = path.join(keystoreDir, 'keystore.properties');

if (existsSync(propsPath) && existsSync(jksPath)) {
  console.log('[keystore] sudah ada: ' + path.relative(appDir, jksPath));
  console.log('[keystore] tidak ada perubahan. Hapus file tersebut bila memang ingin membuat kunci baru.');
  process.exit(0);
}

function findKeytool() {
  const candidates = [
    process.env.SI_JAVA_HOME,
    process.env.JAVA_HOME,
    'C:/Program Files/Zulu/zulu-21',
    'C:/Program Files/Android/Android Studio/jbr',
    'C:/Program Files/Eclipse Adoptium/jdk-21',
    '/usr/lib/jvm/java-21-openjdk-amd64'
  ].filter(Boolean);

  for (const home of candidates) {
    const exe = path.join(home, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
    if (existsSync(exe)) return exe;
  }
  return null;
}

const keytool = findKeytool();
if (!keytool) {
  console.error('keytool tidak ditemukan. Install JDK 17+ atau set SI_JAVA_HOME.');
  process.exit(1);
}

mkdirSync(keystoreDir, { recursive: true });

const password = randomBytes(18).toString('base64url');
const alias = 'si-ambulans';

const result = spawnSync(keytool, [
  '-genkeypair', '-v',
  '-keystore', jksPath,
  '-alias', alias,
  '-keyalg', 'RSA',
  '-keysize', '4096',
  '-validity', '10000',
  '-storepass', password,
  '-keypass', password,
  '-dname', 'CN=SI Ambulans, OU=Markaz Halawatuliman, O=Markaz Halawatuliman, L=Bogor, ST=Jawa Barat, C=ID'
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error((result.stderr || result.stdout || '').trim());
  process.exit(1);
}

writeFileSync(propsPath, [
  '# Kunci upload Play Store — JANGAN di-commit atau dibagikan.',
  '# Simpan cadangan file .jks dan kata sandi ini; tanpa keduanya update aplikasi tidak bisa diunggah.',
  'storeFile=../../keystore/si-ambulans-release.jks',
  'storePassword=' + password,
  'keyAlias=' + alias,
  'keyPassword=' + password,
  ''
].join('\n'));

try { chmodSync(propsPath, 0o600); } catch { /* Windows: mode POSIX tidak berlaku */ }

console.log('[keystore] dibuat: ' + path.relative(appDir, jksPath));
console.log('[keystore] properti: ' + path.relative(appDir, propsPath));
console.log('[keystore] CADANGKAN folder android-app/keystore sekarang. Kata sandi ada di keystore.properties.');
