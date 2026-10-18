const FIREBASE_SDK_VERSION = '10.12.0';
const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';

function isFirebaseConfigReady(config) {
    return config && Object.values(config).every(value =>
        typeof value === 'string' &&
        value.trim() !== '' &&
        !value.includes('REPLACE_WITH_') &&
        !value.includes('…')
    );
}

window.__FIREBASE_READY = (async () => {
    if (!isFirebaseConfigReady(window.firebaseConfig)) {
        window.__FIREBASE_INIT_ERROR = 'Konfigurasi Firebase belum diisi. Lengkapi firebaseConfig di js/firebase-init.js.';
        return;
    }

    try {
        const [appSdk, authSdk, firestoreSdk] = await Promise.all([
            import(FIREBASE_SDK_BASE + 'firebase-app.js'),
            import(FIREBASE_SDK_BASE + 'firebase-auth.js'),
            import(FIREBASE_SDK_BASE + 'firebase-firestore.js')
        ]);
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
