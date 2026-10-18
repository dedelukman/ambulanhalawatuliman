const FS_DOC = Object.freeze({
    si_ambulances: 'ambulances',
    si_drivers: 'drivers',
    si_permintaan: 'permintaan',
    si_kas: 'kas'
});

const __cache = Object.create(null);
const __confirmedCache = Object.create(null);
const __remoteExists = Object.create(null);
const __writeQueue = Object.create(null);
const __pendingWrites = Object.create(null);

const firebaseConfigScriptUrl = new URL('firebase-config.js', document.currentScript.src);

function loadFirebaseConfig() {
    return new Promise((resolve, reject) => {
        if (window.FIREBASE_CONFIG) {
            resolve(window.FIREBASE_CONFIG);
            return;
        }
        const script = document.createElement('script');
        script.src = firebaseConfigScriptUrl.href;
        script.onload = () => {
            if (window.FIREBASE_CONFIG) {
                resolve(window.FIREBASE_CONFIG);
            } else {
                reject(new Error('File konfigurasi hasil generate tidak memuat FIREBASE_CONFIG.'));
            }
        };
        script.onerror = () => reject(new Error(
            'Konfigurasi hasil .env belum tersedia. Jalankan: node scripts/generate-firebase-config.js'
        ));
        document.head.appendChild(script);
    });
}

window.__FIREBASE_READY = (async function initializeFirebaseFromEnv() {
    try {
        const firebaseConfig = await loadFirebaseConfig();
        if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK tidak berhasil dimuat.');
        }
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
        window.db = app.firestore();
        window.auth = app.auth();
        window.db.enablePersistence({ synchronizeTabs: true }).catch(error => {
            if (error.code !== 'failed-precondition' && error.code !== 'unimplemented') {
                console.error('Firestore persistence gagal:', error);
            }
        });
    } catch (error) {
        window.__FIREBASE_INIT_ERROR = 'Inisialisasi Firebase gagal: ' + error.message;
        throw error;
    }
})();
