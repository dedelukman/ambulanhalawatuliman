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
    setupAutoAddress();
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
    setupDateShortcuts();

    const modal = document.getElementById('successModal');
    if (modal) {
        modal.addEventListener('click', e => { if (e.target === modal) closeSuccessModal(); });
    }
    const close = document.getElementById('successClose');
    if (close) close.addEventListener('click', closeSuccessModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSuccessModal(); });

    const again = document.getElementById('againBtn');
    if (again) {
        again.addEventListener('click', () => {
            closeSuccessModal();
            form.reset();
            clearAllErrors();
            selectType(selectedType);
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}

function closeSuccessModal() {
    const modal = document.getElementById('successModal');
    if (modal) modal.classList.remove('is-open');
}

/* ---------- Shortcut Hari ini / Besok (Permohonan Ambulan) ----------
   Tombol mengisi otomatis dropdown Hari dan input Tanggal permohonan. */
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function setupDateShortcuts() {
    document.querySelectorAll('[data-date-shortcut]').forEach(btn => {
        btn.addEventListener('click', () => {
            const offset = Number(btn.getAttribute('data-date-shortcut')) || 0;
            fillRequestDate('aReqDay', 'aReqDate', offset);
        });
    });
}

function fillRequestDate(dayId, dateId, offsetDays) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);

    const dayEl = document.getElementById(dayId);
    if (dayEl) dayEl.value = DAY_NAMES[date.getDay()];

    const dateEl = document.getElementById(dateId);
    if (dateEl) {
        const pad = n => String(n).padStart(2, '0');
        // Format lokal YYYY-MM-DD agar tidak bergeser oleh zona waktu UTC.
        dateEl.value = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
        setFieldError(dateId, false);
    }
}

/* ---------- Alamat & link Maps otomatis dari lokasi browser ----------
   Kolom alamat rumah (jHome / aHome), alamat penjemputan (ajPickup / aPickup),
   dan link Google Maps (jMaps / aHomeMaps) diisi dari posisi perangkat
   (navigator.geolocation). Koordinat diubah menjadi alamat lewat reverse
   geocoding OpenStreetMap (Nominatim).
   - Otomatis saat halaman dibuka: hanya kolom yang masih kosong yang diisi.
   - Tombol "Aktifkan / Perbarui Lokasi" di dekat link Maps: mengambil posisi
     terbaru lalu memperbarui alamat + link pada kelompoknya. Alamat penjemputan
     hanya diisi bila masih kosong agar titik jemput yang sudah diubah manual
     tidak tertimpa. */
const LOCATION_GROUPS = {
    jenazah: { address: 'jHome', maps: 'jMaps', pickup: 'ajPickup' },
    pasien: { address: 'aHome', maps: 'aHomeMaps', pickup: 'aPickup' }
};

function setupAutoAddress() {
    document.querySelectorAll('[data-loc-btn]').forEach(btn => {
        btn.addEventListener('click', () => refreshBrowserLocation(
            btn.getAttribute('data-loc-btn'), btn
        ));
    });

    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
        pos => fillLocationFromCoords(pos.coords, { force: false }),
        () => { /* izin ditolak / lokasi tidak tersedia: isian manual tetap bisa dipakai */ },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
}

/* Tombol: ambil posisi terbaru lalu isi ulang alamat + link Maps kelompok itu. */
function refreshBrowserLocation(group, btn) {
    if (!('geolocation' in navigator)) {
        setLocStatus(group, 'Perangkat ini tidak mendukung lokasi.');
        return;
    }

    setLocBusy(btn, true);
    setLocStatus(group, 'Mengambil lokasi…');

    navigator.geolocation.getCurrentPosition(
        pos => {
            setLocBusy(btn, false);
            fillLocationFromCoords(pos.coords, { force: true, group: group });
            setLocStatus(group, 'Lokasi diperbarui — periksa alamat dan link.');
        },
        err => {
            setLocBusy(btn, false);
            setLocStatus(group, geoErrorMessage(err));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

async function fillLocationFromCoords(coords, opts) {
    const options = opts || {};
    const fields = locationFields(options.group);

    // Link Google Maps hanya butuh koordinat, jadi langsung diisi.
    fillAutoMaps(fields, coords, options.force);

    try {
        const address = await reverseGeocode(coords.latitude, coords.longitude);
        if (address) fillAutoAddress(fields, address, options.force);
    } catch (err) {
        // Diam saja: pengguna tetap bisa mengisi alamat secara manual.
    }
}

function locationFields(group) {
    const keys = (group && LOCATION_GROUPS[group])
        ? [group]
        : Object.keys(LOCATION_GROUPS);
    return keys.map(key => LOCATION_GROUPS[key]);
}

/* Link Google Maps dari titik lokasi browser, mis.
   https://www.google.com/maps?q=-6.48000,106.82500 */
function fillAutoMaps(fields, coords, force) {
    const lat = Number(coords.latitude).toFixed(5);
    const lng = Number(coords.longitude).toFixed(5);
    const url = 'https://www.google.com/maps?q=' + lat + ',' + lng;
    fields.forEach(group => setAutoField(group.maps, url, force));
}

function fillAutoAddress(fields, address, force) {
    fields.forEach(group => {
        setAutoField(group.address, address, force);
        // Titik jemput mengikuti lokasi saat ini, tetapi jangan menimpa isian
        // manual (mis. jemput di rumah sakit yang berbeda).
        if (group.pickup) setAutoField(group.pickup, address, false);
    });
}

/* force = true dipakai tombol (timpa nilai lama); saat otomatis hanya bila kosong. */
function setAutoField(id, value, force) {
    const el = document.getElementById(id);
    if (!el || !value) return;
    if (!force && String(el.value || '').trim()) return;

    el.value = value;
    const hint = document.querySelector('[data-loc-hint="' + id + '"]');
    if (hint) hint.classList.remove('hidden');
}

function setLocStatus(group, message) {
    const el = document.querySelector('[data-loc-status="' + group + '"]');
    if (el) el.textContent = message || '';
}

function setLocBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = busy;
}

function geoErrorMessage(err) {
    if (!err) return 'Gagal mengambil lokasi.';
    if (err.code === 1) return 'Izin lokasi ditolak. Izinkan akses lokasi di browser lalu coba lagi.';
    if (err.code === 2) return 'Lokasi tidak tersedia. Pastikan layanan lokasi/GPS aktif.';
    if (err.code === 3) return 'Waktu pengambilan lokasi habis. Coba lagi.';
    return 'Gagal mengambil lokasi.';
}

async function reverseGeocode(lat, lng) {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=id' +
        '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return formatReverseAddress(data);
}

/* Susun alamat ringkas dari komponen Nominatim, mis.
   "Jl. Raya Jakarta, Cibinong, Bogor, Jawa Barat, 16911". */
function formatReverseAddress(data) {
    const a = (data && data.address) || {};
    const road = [a.road || a.pedestrian || a.footway || a.path, a.house_number]
        .filter(Boolean).join(' No. ');
    const parts = [
        road,
        a.neighbourhood || a.quarter,
        a.suburb || a.village || a.hamlet,
        a.city_district || a.district,
        a.city || a.town || a.municipality || a.county,
        a.state,
        a.postcode
    ].map(s => String(s || '').trim()).filter(Boolean);

    const unique = parts.filter((part, i) => parts.indexOf(part) === i);
    return unique.join(', ') || String((data && data.display_name) || '').trim();
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
    const modal = document.getElementById('successModal');
    if (!modal) return;

    // Isian dikosongkan supaya form siap dipakai untuk permintaan berikutnya.
    const form = document.getElementById('requestForm');
    if (form) form.reset();
    clearAllErrors();

    setText('successCode', item.id);
    setText('successType', item.jenis);
    setText('successStatus', item.status);
    modal.classList.add('is-open');
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
