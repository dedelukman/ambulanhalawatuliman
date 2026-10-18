/* Bootstrap: initialize Firebase, import legacy data once, then load app code. */

function showBootstrapError(message) {
  let banner = document.getElementById('firebase-bootstrap-error');
  if (!document.body && !banner) {
    document.addEventListener('DOMContentLoaded', () => showBootstrapError(message), { once: true });
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'firebase-bootstrap-error';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px;background:#fee;color:#900;font:14px sans-serif;z-index:10000';
    document.body.prepend(banner);
  }
  banner.textContent = message;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(script);
  });
}

async function primeCache() {
  for (const [key, docName] of Object.entries(FS_DOC)) {
    const ref = db.collection('si_state').doc(docName);
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data();
      if (!Array.isArray(data.items)) {
        throw new Error('Format dokumen Firestore tidak valid: si_state/' + docName);
      }
      __cache[key] = data.items;
      __confirmedCache[key] = JSON.parse(JSON.stringify(data.items));
      __remoteExists[key] = true;
      continue;
    }

    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      let legacy;
      try {
        legacy = JSON.parse(raw);
      } catch (error) {
        throw new Error('Data localStorage "' + key + '" tidak valid JSON dan belum dapat diimpor.');
      }
      if (!Array.isArray(legacy)) {
        throw new Error('Data localStorage "' + key + '" harus berbentuk array.');
      }
      __cache[key] = legacy;
      await ref.set({ items: legacy });
      __confirmedCache[key] = JSON.parse(JSON.stringify(legacy));
      __remoteExists[key] = true;
      window.localStorage.removeItem(key);
      continue;
    }

    __remoteExists[key] = false;
  }
}

function syncGlobalArrays(key, items) {
  if (key === 'si_ambulances' && Array.isArray(window.ambulances)) {
    window.ambulances.length = 0;
    items.forEach(item => window.ambulances.push(item));
  }
  if (key === 'si_drivers' && Array.isArray(window.drivers)) {
    window.drivers.length = 0;
    items.forEach(item => window.drivers.push(item));
  }
}

function installSnapshots() {
  Object.entries(FS_DOC).forEach(([key, docName]) => {
    db.collection('si_state').doc(docName).onSnapshot(snap => {
      if (__pendingWrites[key]) return;
      if (!snap.exists) {
        __cache[key] = [];
        __confirmedCache[key] = [];
        __remoteExists[key] = false;
        document.dispatchEvent(new CustomEvent('firestore:update', { detail: { key } }));
        return;
      }
      const data = snap.data();
      if (!Array.isArray(data.items)) {
        reportStoreError(key, new Error('Format dokumen Firestore tidak valid.'));
        return;
      }
      __cache[key] = data.items;
      __confirmedCache[key] = JSON.parse(JSON.stringify(data.items));
      __remoteExists[key] = true;
      syncGlobalArrays(key, data.items);
      document.dispatchEvent(new CustomEvent('firestore:update', { detail: { key } }));
    }, error => reportStoreError(key, error));
  });
}

async function seedMissingDocuments() {
  const defaults = {
    si_ambulances: Array.isArray(window.ambulances) ? window.ambulances : AMBULANCE_SEED,
    si_drivers: Array.isArray(window.drivers) ? window.drivers : DRIVER_SEED,
    si_permintaan: [],
    si_kas: []
  };
  for (const key of Object.keys(FS_DOC)) {
    if (__remoteExists[key]) continue;
    const items = Array.isArray(__cache[key]) ? __cache[key] : defaults[key];
    __cache[key] = items;
    await db.collection('si_state').doc(FS_DOC[key]).set({ items: items });
    __confirmedCache[key] = JSON.parse(JSON.stringify(items));
    __remoteExists[key] = true;
  }
}

function loadPageScripts() {
  return (async () => {
    for (const src of (window.APP_PRE_DATA_SCRIPTS || [])) await loadScript(src);
    await loadScript('js/data.js');
    await seedMissingDocuments();
    for (const src of (window.APP_POST_DATA_SCRIPTS || [])) await loadScript(src);
    installSnapshots();
    document.dispatchEvent(new CustomEvent('app:ready'));
  })();
}

(async function boot() {
  try {
    if (window.__FIREBASE_INIT_ERROR) throw new Error(window.__FIREBASE_INIT_ERROR);
    if (!window.db || !window.auth) throw new Error('Firebase SDK belum siap. Periksa konfigurasi dan koneksi.');
    if (!auth.currentUser) await auth.signInAnonymously();
    await primeCache();
    await loadPageScripts();
  } catch (error) {
    console.error('Inisialisasi Firestore gagal:', error);
    showBootstrapError('Aplikasi tidak dapat terhubung ke Firestore: ' + error.message);
  }
})();

window.addEventListener('firestore:error', event => {
  const key = event.detail && event.detail.key ? event.detail.key : 'data';
  showBootstrapError('Gagal menyimpan atau menerima ' + key + ' dari Firestore. Periksa koneksi, konfigurasi, dan Firestore Rules.');
});
