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

const firebaseConfig = {
    apiKey: 'AIzaSyAcaPg81RWbqDym4_mNA42IUHuJ39YIXyE',
    authDomain: 'ambulanhalawatuliman.firebaseapp.com',
    databaseURL: 'https://ambulanhalawatuliman-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'ambulanhalawatuliman',
    storageBucket: 'ambulanhalawatuliman.firebasestorage.app',
    messagingSenderId: '810299581241',
    appId: '1:810299581241:web:67c5df505ad04fad0dfee8',
    measurementId: 'G-E588GVXHNW'
};

const firebaseConfigIsReady = Object.values(firebaseConfig).every(value =>
    typeof value === 'string' &&
    value.trim() !== '' &&
    !value.includes('REPLACE_WITH_') &&
    !value.includes('…')
);

if (!firebaseConfigIsReady) {
    window.__FIREBASE_INIT_ERROR = 'Konfigurasi Firebase belum diisi. Lengkapi firebaseConfig di js/firebase-init.js.';
} else if (typeof firebase === 'undefined') {
    window.__FIREBASE_INIT_ERROR = 'Firebase SDK tidak berhasil dimuat.';
} else {
    try {
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
    }
}
