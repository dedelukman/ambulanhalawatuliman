const FIREBASE_SDK_VERSION = '10.12.0';
/* SDK disalin ke vendor/firebase saat build (lihat scripts/copy-web.mjs), sehingga
   aplikasi tetap bisa inisialisasi Firestore saat perangkat offline atau CDN
   gstatic diblokir. CDN hanya dipakai bila salinan lokal tidak ditemukan. */
const FIREBASE_SDK_LOCAL_BASE = new URL('vendor/firebase/', document.baseURI).href;
const FIREBASE_SDK_CDN_BASE = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';

function isFirebaseConfigReady(config) {
    return config && Object.values(config).every(value =>
        typeof value === 'string' &&
        value.trim() !== '' &&
        !value.includes('REPLACE_WITH_') &&
        !value.includes('…')
    );
}

async function importFirebaseSdk(base) {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import(base + 'firebase-app.js'),
        import(base + 'firebase-auth.js'),
        import(base + 'firebase-firestore.js')
    ]);
    return { appSdk, authSdk, firestoreSdk };
}

window.__FIREBASE_READY = (async () => {
    if (!isFirebaseConfigReady(window.firebaseConfig)) {
        window.__FIREBASE_INIT_ERROR = 'Konfigurasi Firebase belum diisi. Lengkapi firebaseConfig di js/firebase-init.js.';
        return;
    }

    try {
        let sdk;
        try {
            sdk = await importFirebaseSdk(FIREBASE_SDK_LOCAL_BASE);
        } catch (localError) {
            console.warn('SDK Firebase lokal gagal dimuat, memakai CDN: ' + localError.message);
            sdk = await importFirebaseSdk(FIREBASE_SDK_CDN_BASE);
        }
        const { appSdk, authSdk, firestoreSdk } = sdk;
        const app = appSdk.initializeApp(window.firebaseConfig);
        window.auth = authSdk.getAuth(app);
        window.db = firestoreSdk.initializeFirestore(app, {
            localCache: firestoreSdk.persistentLocalCache({
                tabManager: firestoreSdk.persistentMultipleTabManager()
            })
        });
        window.firebaseApi = {
            deleteDoc: firestoreSdk.deleteDoc,
            doc: firestoreSdk.doc,
            getDoc: firestoreSdk.getDoc,
            onSnapshot: firestoreSdk.onSnapshot,
            setDoc: firestoreSdk.setDoc,
            signInAnonymously: authSdk.signInAnonymously
        };
    } catch (error) {
        window.__FIREBASE_INIT_ERROR = 'Inisialisasi Firebase gagal: ' + error.message;
    }
})();
