const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const outputPath = path.join(projectRoot, 'js', 'firebase-config.js');

function readEnvFile(contents) {
    const values = Object.create(null);
    contents.split(/\r?\n/).forEach(line => {
        const entry = line.trim();
        if (!entry || entry.startsWith('#')) return;

        const separator = entry.indexOf('=');
        if (separator < 1) return;

        const key = entry.slice(0, separator).trim();
        let value = entry.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    });
    return values;
}

if (!fs.existsSync(envPath)) {
    throw new Error('File .env tidak ditemukan di root proyek.');
}

const env = readEnvFile(fs.readFileSync(envPath, 'utf8'));
const config = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    databaseURL: env.FIREBASE_DATABASE_URL,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID,
    measurementId: env.FIREBASE_MEASUREMENT_ID
};

const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
const missingKeys = requiredKeys.filter(key =>
    typeof config[key] !== 'string' || config[key].trim() === ''
);
if (missingKeys.length) {
    throw new Error('Variabel Firebase wajib belum diisi di .env: ' + missingKeys.join(', '));
}

fs.writeFileSync(
    outputPath,
    'window.FIREBASE_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n',
    'utf8'
);
console.log('Konfigurasi Firebase dibuat di js/firebase-config.js.');
