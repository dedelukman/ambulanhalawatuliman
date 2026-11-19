/* Cloud Function — mengirim push notification FCM saat status permintaan berubah.
   Diperlukan agar driver/admin tetap menerima notifikasi ketika aplikasi ditutup.

   Token perangkat disimpan aplikasi Android di dokumen si_state/push_tokens:
     { tokens: { "<fcm-token>": { role, name, memberId, platform, updatedAt } } }

   Deploy: lihat android-app/README.md bagian "Push notification". */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');

initializeApp();
const db = getFirestore();

const TOKENS_DOC = 'si_state/push_tokens';

function itemsOf(snapshot) {
  if (!snapshot || !snapshot.exists) return [];
  const data = snapshot.data();
  return data && Array.isArray(data.items) ? data.items : [];
}

function statusOf(item) {
  return item && item.status ? String(item.status) : '';
}

function isJenazah(item) {
  const type = String((item && item.type) || '').toLowerCase();
  if (type === 'jenazah' || type === 'dua') return true;
  if (type) return false;
  return String((item && item.jenis) || '').toLowerCase().indexOf('jenazah') !== -1;
}

/* Permintaan jenazah murni tidak memakai ambulans, jadi tidak boleh dikirim
   ke driver. Permintaan gabungan (type 'dua') tetap masuk karena butuh ambulans. */
function isAmbulan(item) {
  const type = String((item && item.type) || '').toLowerCase();
  if (type === 'dua') return true;
  const jenis = String((item && item.jenis) || '').toLowerCase();
  if (!jenis) return true;
  return jenis.indexOf('ambul') !== -1;
}

function bodyOf(item) {
  const jenis = (item && (item.jenis || item.type)) || 'Permintaan';
  const lokasi = (item && item.lokasi) || 'Lokasi menyusul';
  const nama = (item && item.nama) || 'Pemohon';
  return jenis + ' · ' + lokasi + ' · ' + nama;
}

async function tokensForRole(role) {
  const snapshot = await db.doc(TOKENS_DOC).get();
  if (!snapshot.exists) return [];
  const tokens = snapshot.data().tokens || {};
  return Object.keys(tokens).filter(token => tokens[token] && tokens[token].role === role);
}

async function removeTokens(tokens) {
  if (!tokens.length) return;
  const updates = {};
  tokens.forEach(token => { updates['tokens.' + token] = FieldValue.delete(); });
  await db.doc(TOKENS_DOC).update(updates)
    .catch(err => logger.warn('gagal menghapus token tidak valid', err));
}

async function sendToRole(role, title, body, extra) {
  const tokens = await tokensForRole(role);
  if (!tokens.length) {
    logger.info('tidak ada token untuk role ' + role);
    return;
  }

  const response = await getMessaging().sendEachForMulticast({
    tokens: tokens,
    notification: { title: title, body: body },
    data: Object.assign({}, extra, { role: role }),
    android: {
      priority: 'high',
      notification: {
        channelId: 'si_tasks',
        icon: 'ic_stat_ambulance',
        color: '#DC2626',
        defaultSound: true
      }
    }
  });

  const invalid = [];
  response.responses.forEach((res, index) => {
    if (res.success) return;
    const code = res.error && res.error.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument') {
      invalid.push(tokens[index]);
    } else {
      logger.warn('gagal mengirim ke token ' + tokens[index].slice(0, 12) + '…', res.error);
    }
  });
  await removeTokens(invalid);
  logger.info('push role ' + role + ': ' + response.successCount + '/' + tokens.length + ' terkirim');
}

exports.notifikasiPermintaan = onDocumentWritten('si_state/permintaan', async event => {
  const before = itemsOf(event.data.before);
  const after = itemsOf(event.data.after);
  const beforeById = new Map(before.map(item => [String(item && item.id), item]));

  const becameWaiting = after.filter(item => {
    if (!item || !item.id || statusOf(item) !== 'Menunggu') return false;
    const previous = beforeById.get(String(item.id));
    return statusOf(previous) !== 'Menunggu';
  });

  const becameProcessed = after.filter(item => {
    if (!item || !item.id || statusOf(item) !== 'Diproses') return false;
    const previous = beforeById.get(String(item.id));
    return statusOf(previous) !== 'Diproses';
  });

  for (const item of becameWaiting) {
    await sendToRole('admin', 'Permintaan baru ' + item.id, bodyOf(item), {
      type: 'task',
      id: String(item.id)
    });
  }

  for (const item of becameProcessed) {
    if (isAmbulan(item)) {
      await sendToRole('driver', 'Tugas baru ' + item.id, bodyOf(item), {
        type: 'task',
        id: String(item.id)
      });
    }
    if (isJenazah(item)) {
      await sendToRole('janaiz', 'Tugas jenazah ' + item.id, bodyOf(item), {
        type: 'task',
        id: String(item.id)
      });
    }
  }
});
