/* copy-web.mjs — menyalin aplikasi web (HTML/CSS/JS) ke android-app/www
   lalu menyisipkan js/native-bridge.js di setiap halaman.
   Sumber kebenaran tetap file web di root proyek; www/ adalah hasil build. */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const webRoot = path.resolve(appDir, '..');
const www = path.join(appDir, 'www');

const BRIDGE_SRC = path.join(appDir, 'src', 'native-bridge.js');
const BRIDGE_TAG = '    <script src="js/native-bridge.js"></script>\n';

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await rm(www, { recursive: true, force: true });
await mkdir(path.join(www, 'js'), { recursive: true });

const rootEntries = await readdir(webRoot, { withFileTypes: true });
const htmlFiles = rootEntries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.html')).map(e => e.name);

for (const name of ['app.css', 'styles.css']) {
  await cp(path.join(webRoot, name), path.join(www, name));
}

for (const dir of ['js', 'vendor', 'assets']) {
  if (await exists(path.join(webRoot, dir))) {
    await cp(path.join(webRoot, dir), path.join(www, dir), { recursive: true });
  }
}

if (!(await exists(path.join(www, 'js', 'firebase-init.js')))) {
  console.warn('[copy-web] PERINGATAN: js/firebase-init.js tidak ditemukan — aplikasi Android tidak akan bisa terhubung ke Firestore.');
}

for (const name of htmlFiles) {
  let html = await readFile(path.join(webRoot, name), 'utf8');
  if (!html.includes('js/native-bridge.js')) {
    if (!/<\/body>/i.test(html)) {
      console.warn('[copy-web] ' + name + ': tidak ada </body>, bridge tidak disisipkan.');
      await writeFile(path.join(www, name), html);
      continue;
    }
    html = html.replace(/<\/body>/i, BRIDGE_TAG + '</body>');
  }
  await writeFile(path.join(www, name), html);
}

await cp(BRIDGE_SRC, path.join(www, 'js', 'native-bridge.js'));

console.log('[copy-web] ' + htmlFiles.length + ' halaman + aset web disalin ke ' + path.relative(process.cwd(), www));
