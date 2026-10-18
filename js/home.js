/* home.js — logika halaman utama (index.html)
   - info singkat (jumlah armada / driver dari data.js)
   - pemilihan jenis permintaan (Pengurusan Jenazah / Ambulans / Ambulan Jenazah / Keduanya)
   - validasi + penyimpanan permintaan ke Firestore (lihat store.js)
   - cek status permintaan berdasarkan kode */

const TYPE_LABELS = {
    jenazah: 'Pengurusan Jenazah',
    ambulan: 'Permintaan Ambulan Pasien',
    'ambulan-jenazah': 'Permohonan Ambulan Jenazah (tanpa pengurusan)',
    dua: 'Ambulan + Pengurusan Jenazah'
};

const TYPE_HINTS = {
    jenazah: 'Jenis dipilih: <strong class="text-slate-200">Formulir Permohonan Pengurusan Jenazah</strong> — Yayasan Halawatul Iman.',
    ambulan: 'Jenis dipilih: <strong class="text-slate-200">Formulir Permohonan Ambulan Pasien</strong> — pengantaran pasien, bukan tindakan medis.',
    'ambulan-jenazah': 'Jenis dipilih: <strong class="text-slate-200">Formulir Permohonan Ambulan Jenazah</strong> — hanya pengantaran, tanpa pengurusan jenazah.',
    dua: 'Jenis dipilih: <strong class="text-slate-200">Formulir Ambulan + Pengurusan Jenazah</strong> — khusus pasien yang meninggal.'
};

let selectedType = 'ambulan';

appOnReady(() => {
    renderStats();
    setupChoices();
    setupForm();
    setupCheckStatus();
    setupAuthVisibility();
    if (typeof applyRoleNav === 'function') applyRoleNav();
});

document.addEventListener('firestore:update', event => {
    if (event.detail && (event.detail.key === STORE_KEYS.AMBULANCES ||
        event.detail.key === STORE_KEYS.DRIVERS)) renderStats();
});

/* ---------- Info singkat ---------- */
function renderStats() {
    const totalAmb = (typeof ambulances !== 'undefined' && Array.isArray(ambulances)) ? ambulances.length : 0;
    const totalDrv = (typeof drivers !== 'undefined' && Array.isArray(drivers)) ? drivers.length : 0;
    const readyDrv = (typeof drivers !== 'undefined' && Array.isArray(drivers))
        ? drivers.filter(d => d && d.status === 'Standby').length : 0;

    setText('statUnit', totalAmb);
    setText('statDriver', totalDrv);
    setText('statReady', readyDrv);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

/* ---------- Pilihan jenis permintaan ---------- */
function setupChoices() {
    const choices = document.querySelectorAll('.choice[data-type]');
    choices.forEach(btn => {
        btn.addEventListener('click', () => selectType(btn.getAttribute('data-type')));
    });
    selectType(selectedType);
}

function selectType(type) {
    if (!TYPE_LABELS[type]) return;
    selectedType = type;

    document.querySelectorAll('.choice[data-type]').forEach(btn => {
        btn.setAttribute('aria-checked', String(btn.getAttribute('data-type') === type));
    });

    const showJenazah = (type === 'jenazah' || type === 'dua' || type === 'ambulan-jenazah');
    const showAmbulan = (type === 'ambulan');
    const showAmbulanJenazah = (type === 'ambulan-jenazah');
    const showDua = (type === 'dua');
    toggleGroup('groupJenazah', showJenazah);
    toggleGroup('groupAmbulan', showAmbulan);
    toggleGroup('groupAmbulanJenazah', showAmbulanJenazah);
    toggleGroup('groupDua', showDua);
    toggleGroup('jDeathWrap', type !== 'ambulan-jenazah');
    toggleGroup('jReqWrap', type !== 'ambulan-jenazah');
    toggleGroup('jFuneralDetails', type !== 'ambulan-jenazah');

    const jGroupTitle = document.getElementById('jGroupTitle');
    if (jGroupTitle) {
        jGroupTitle.innerHTML = type === 'ambulan-jenazah'
            ? '<i class="fa-solid fa-truck-medical mr-1.5"></i>Data Jenazah untuk Pengantaran'
            : '<i class="fa-solid fa-praying-hands mr-1.5"></i>Data Pengurusan Jenazah';
    }

    // Catatan penting mengikuti formulir yang dipilih
    toggleGroup('noteJenazah', type === 'jenazah');
    toggleGroup('noteAmbulan', type === 'ambulan');
    toggleGroup('noteAmbulanJenazah', showAmbulanJenazah);
    toggleGroup('noteDua', type === 'dua');

    // Label "hubungan" menyesuaikan objek permohonan
    const relationLabel = document.getElementById('reqRelationLabel');
    if (relationLabel) {
        relationLabel.textContent = (type === 'ambulan') ? 'Hubungan dengan Pasien' : 'Hubungan dengan Jenazah';
    }

    const hint = document.getElementById('typeHint');
    if (hint) hint.innerHTML = TYPE_HINTS[type];

    clearAllErrors();
}

function toggleGroup(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
}

/* ---------- Validasi + kirim ---------- */
function requiredFields(type) {
    const fields = ['reqName', 'reqPhone', 'reqRelation'];
    if (type === 'ambulan') fields.push('aPatientName', 'aHome', 'aReqDate', 'aPickup', 'aDest');
    if (type === 'jenazah') fields.push('jName', 'jHome', 'jDeathDate', 'jReqDate', 'jBurial');
    if (type === 'dua') fields.push('jName', 'jHome', 'jDeathDate', 'jReqDate', 'jBurial', 'dAmbDate');
    if (type === 'ambulan-jenazah') fields.push('jName', 'jHome', 'ajReqDate', 'ajPickup', 'ajDest');
    return fields;
}


function fieldValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
}

function setFieldError(id, invalid) {
    const field = document.getElementById(id);
    const err = document.querySelector('[data-error-for="' + id + '"]');
    if (field) field.classList.toggle('is-invalid', invalid);
    if (err) err.classList.toggle('is-visible', invalid);
}

function clearAllErrors() {
    document.querySelectorAll('.field-error').forEach(e => e.classList.remove('is-visible'));
    document.querySelectorAll('.input').forEach(e => e.classList.remove('is-invalid'));
}

function setupForm() {
    const form = document.getElementById('requestForm');
    if (!form) return;
    form.addEventListener('submit', onSubmitRequest);

    const again = document.getElementById('againBtn');
    if (again) {
        again.addEventListener('click', () => {
            const box = document.getElementById('successBox');
            if (box) box.classList.add('hidden');
            form.reset();
            clearAllErrors();
            selectType(selectedType);
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}

function onSubmitRequest(e) {
    e.preventDefault();

    const fields = requiredFields(selectedType);
    let firstInvalid = null;
    fields.forEach(id => {
        const invalid = fieldValue(id).length === 0;
        setFieldError(id, invalid);
        if (invalid && !firstInvalid) firstInvalid = id;
    });

    if (firstInvalid) {
        const el = document.getElementById(firstInvalid);
        if (el) {
            el.focus();
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    const item = {
        id: requestCode(),
        type: selectedType,
        jenis: TYPE_LABELS[selectedType],
        nama: fieldValue('reqName'),
        hp: fieldValue('reqPhone'),
        lokasi: resolveLocation(selectedType),
        detail: buildDetail(selectedType),
        status: 'Menunggu',
        createdAt: new Date().toISOString()
    };

    const saved = addPermintaan(item);
    if (!saved) {
        alert('Gagal menyimpan permintaan. Periksa koneksi dan akses Firestore.');
        return;
    }

    showSuccess(saved);
}

function buildDetail(type) {
    const detail = {};
    const relation = fieldValue('reqRelation');
    if (relation) detail.hubungan = relation;

    if (type === 'ambulan') {
        detail.namaPasien = fieldValue('aPatientName');
        detail.kelamin = fieldValue('aGender');
        detail.umur = fieldValue('aAge');
        detail.riwayatSakit = fieldValue('aRiwayat');
        detail.alamatRumah = fieldValue('aHome');
        detail.maps = fieldValue('aHomeMaps');
        detail.jadwalAmbulan = scheduleText('aReq');
        detail.penjemputan = fieldValue('aPickup');
        detail.tujuan = fieldValue('aDest');
    }

    if (type === 'jenazah' || type === 'dua') {
        detail.namaJenazah = fieldValue('jName');
        detail.kelamin = fieldValue('jGender');
        detail.umur = fieldValue('jAge');
        detail.penyebab = fieldValue('jRiwayat');
        detail.rumahDuka = fieldValue('jHome');
        detail.maps = fieldValue('jMaps');
        detail.meninggal = scheduleText('jDeath');
        detail.jadwalPengurusan = scheduleText('jReq');
        detail.dishalatkan = fieldValue('jPrayPlace');
        detail.tpu = fieldValue('jBurial');
    }

    if (type === 'ambulan-jenazah') {
        detail.namaJenazah = fieldValue('jName');
        detail.kelamin = fieldValue('jGender');
        detail.umur = fieldValue('jAge');
        detail.penyebab = fieldValue('jRiwayat');
        detail.rumahDuka = fieldValue('jHome');
        detail.maps = fieldValue('jMaps');
        detail.jadwalAmbulan = scheduleText('ajReq');
        detail.penjemputan = fieldValue('ajPickup');
        detail.tujuan = fieldValue('ajDest');
    }

    if (type === 'dua') {
        detail.jadwalAmbulan = scheduleText('dAmb');
        detail.parkirAmbulan = fieldValue('dPark');
    }

    return detail;
}

/* Alamat utama yang ikut tampil di daftar admin, sesuai jenis formulir. */
function resolveLocation(type) {
    if (type === 'ambulan') return fieldValue('aPickup') || fieldValue('aHome');
    if (type === 'ambulan-jenazah') return fieldValue('ajPickup');
    return fieldValue('jHome');
}

/* Gabungkan Hari | Tgl | Jam menjadi satu teks ringkas. */
function scheduleText(prefix) {
    const day = fieldValue(prefix + 'Day');
    const date = fieldValue(prefix + 'Date');
    const time = fieldValue(prefix + 'Time');
    if (!day && !date && !time) return '';
    return [day, date, time].filter(Boolean).join(' · ');
}


function requestCode() {
    const tail = (Date.now().toString(36).slice(-4) + Math.floor(Math.random() * 90 + 10)).toUpperCase();
    return 'REQ-' + tail;
}

function showSuccess(item) {
    const box = document.getElementById('successBox');
    if (!box) return;
    setText('successCode', item.id);
    setText('successType', item.jenis);
    setText('successStatus', item.status);
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- Akses dashboard: hanya tampil setelah user login ---------- */
function setupAuthVisibility() {
    const admin = (typeof isAdminLoggedIn === 'function') && isAdminLoggedIn();
    const driver = (typeof isDriverLoggedIn === 'function') && isDriverLoggedIn();
    const loggedIn = admin || driver;
    ['trackAmbulanceBtn', 'dashboardNavCard', 'successDashboardBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !loggedIn);
    });
}

/* ---------- Cek status ---------- */
function setupCheckStatus() {
    const btn = document.getElementById('checkBtn');
    const input = document.getElementById('checkCode');
    if (btn) btn.addEventListener('click', checkStatus);
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                checkStatus();
            }
        });
    }
}

function checkStatus() {
    const input = document.getElementById('checkCode');
    const result = document.getElementById('checkResult');
    if (!input || !result) return;

    const code = String(input.value || '').trim();
    result.classList.remove('hidden');

    if (!code) {
        result.innerHTML = '<p class="text-amber-400"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Masukkan kode permintaan Anda.</p>';
        return;
    }

    const item = findPermintaanByCode(code);
    if (!item) {
        result.innerHTML = '<p class="text-red-400"><i class="fa-solid fa-circle-xmark mr-1"></i> Kode <span class="mono">' + escapeHtml(code) +
            '</span> tidak ditemukan. Periksa kembali kode Anda.</p>';
        return;
    }

    const statusClass = item.status === 'Selesai' ? 'badge-green'
        : (item.status === 'Diproses' ? 'badge-amber' : 'badge-slate');

    result.innerHTML =
        '<div class="row-card">' +
            '<div class="flex items-center justify-between gap-2">' +
                '<span class="mono font-bold text-slate-100">' + escapeHtml(item.id) + '</span>' +
                '<span class="badge ' + statusClass + '">' + escapeHtml(item.status) + '</span>' +
            '</div>' +
            '<p class="text-slate-400 mt-1">' + escapeHtml(item.jenis) + ' · ' + escapeHtml(formatDateTime(item.createdAt)) + '</p>' +
            '<p class="text-slate-300 mt-1">Pemohon: ' + escapeHtml(item.nama) + ' (' + escapeHtml(item.hp) + ')</p>' +
            '<p class="text-slate-400 text-[11px] mt-0.5">Lokasi: ' + escapeHtml(item.lokasi) + '</p>' +
        '</div>';
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
