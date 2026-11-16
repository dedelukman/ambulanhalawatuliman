/* build-android.mjs — menjalankan Gradle dengan JDK 17+ dan Android SDK yang benar.
   Pakai: node scripts/build-android.mjs debug
          node scripts/build-android.mjs release
   JDK bisa dipaksa lewat env SI_JAVA_HOME. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const androidDir = path.join(appDir, 'android');

const mode = (process.argv[2] || 'debug').toLowerCase();
const task = mode === 'release' ? 'bundleRelease'
  : (mode === 'apk' ? 'assembleRelease' : 'assembleDebug');

function javaMajor(javaExe) {
  const res = spawnSync(javaExe, ['-version'], { encoding: 'utf8' });
  const text = (res.stderr || '') + (res.stdout || '');
  const match = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const first = Number(match[1]);
  if (first === 1) return Number(match[2]);
  return first;
}

function findJava() {
  const candidates = [
    process.env.SI_JAVA_HOME,
    process.env.JAVA_HOME,
    'C:/Program Files/Zulu/zulu-21',
    'C:/Program Files/Zulu/zulu-17',
    'C:/Program Files/Android/Android Studio/jbr',
    'C:/Program Files/Eclipse Adoptium/jdk-21',
    'C:/Program Files/Microsoft/jdk-21',
    '/usr/lib/jvm/java-21-openjdk-amd64',
    '/usr/lib/jvm/java-17-openjdk-amd64'
  ].filter(Boolean);

  let best = null;
  for (const home of candidates) {
    const exe = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (!existsSync(exe)) continue;
    const major = javaMajor(exe);
    if (major >= 17 && (!best || major > best.major)) best = { home, exe, major };
  }
  return best;
}

const java = findJava();
if (!java) {
  console.error('JDK 17+ tidak ditemukan. Install JDK 21 (mis. Zulu/Temurin/Android Studio) lalu jalankan ulang,');
  console.error('atau set SI_JAVA_HOME ke folder JDK tersebut.');
  process.exit(1);
}
console.log('[build] JDK ' + java.major + ': ' + java.home);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null);

if (!sdk || !existsSync(sdk)) {
  console.error('Android SDK tidak ditemukan. Set ANDROID_HOME ke folder SDK (berisi platforms/android-36).');
  process.exit(1);
}

const localProps = path.join(androidDir, 'local.properties');
let props = existsSync(localProps) ? readFileSync(localProps, 'utf8') : '';
if (!/^\s*sdk\.dir\s*=/m.test(props)) {
  const sdkPath = sdk.replace(/\\/g, '/');
  props = (props.trim() ? props.trimEnd() + '\n' : '') + 'sdk.dir=' + sdkPath + '\n';
  writeFileSync(localProps, props);
  console.log('[build] local.properties dibuat: sdk.dir=' + sdkPath);
}

// Jalankan Gradle wrapper lewat Java langsung supaya bekerja sama di Windows
// (cmd/PowerShell), Git Bash, maupun Linux/macOS tanpa bergantung pada shell.
const wrapperJar = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.jar');

const res = spawnSync(java.exe, [
  '-Dorg.gradle.appname=gradlew',
  '-classpath', wrapperJar,
  'org.gradle.wrapper.GradleWrapperMain',
  task,
  '--no-daemon'
], {
  cwd: androidDir,
  stdio: 'inherit',
  env: Object.assign({}, process.env, {
    JAVA_HOME: java.home,
    PATH: path.join(java.home, 'bin') + path.delimiter + process.env.PATH,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk
  })
});

process.exit(res.status === null ? 1 : res.status);
