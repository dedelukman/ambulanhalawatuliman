/* report.js — mesin laporan generik: rekap Excel (.xlsx) & PDF 1.4
   Dipakai permintaan.html (js/permintaan.js) dan kas.html (js/kas.js).
   Dibuat sepenuhnya di browser tanpa pustaka eksternal:
   - Excel : .xlsx asli (ZIP metode stored + SpreadsheetML inlineStr)
   - PDF   : PDF 1.4 multi-halaman (teks Helvetica, A4 lanskap)

   Bentuk objek laporan `d`:
     d.title    : judul laporan (baris pertama halaman 1)
     d.org      : baris instansi di bawah judul
     d.period   : teks periode, mis. '2026-10-08 s/d 2026-10-12'
     d.generated: teks tanggal cetak
     d.sheetName: nama sheet Excel
     d.columns  : daftar judul kolom
     d.rows     : baris data; sel berupa string biasa ATAU
                  { t: teksSel, n: true|false, f: tampilanCetakOpsional }
                  (n = sel angka untuk Excel; f = tampilan cetak PDF, mis. 'Rp 50.000')
     d.summary  : ringkasan berupa array [{ label, value }] */

function downloadBytes(bytes, filename, mime) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- Pembuat .xlsx: ZIP (stored) + SpreadsheetML ---------- */
function crc32Bytes(bytes) {
    if (!crc32Bytes.table) {
        const t = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        crc32Bytes.table = t;
    }
    const t = crc32Bytes.table;
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* entries: [{ name, text }] -> Uint8Array ZIP tanpa kompresi (method 0). */
function zipStore(entries) {
    const enc = new TextEncoder();
    const out = [];
    const central = [];
    const u16 = v => [v & 255, (v >>> 8) & 255];
    const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    const dosDate = 33;   // 1980-01-01 (format DOS)
    let offset = 0;

    entries.forEach(e => {
        const nameBytes = enc.encode(e.name);
        const data = enc.encode(e.text);
        const crc = crc32Bytes(data);
        const local = [0x50, 0x4B, 0x03, 0x04]
            .concat(u16(20), u16(0), u16(0), u16(0), u16(dosDate),
                u32(crc), u32(data.length), u32(data.length),
                u16(nameBytes.length), u16(0));
        local.forEach(b => out.push(b));
        Array.from(nameBytes).forEach(b => out.push(b));
        Array.from(data).forEach(b => out.push(b));

        central.push([].concat(u16(20), u16(20), u16(0), u16(0), u16(0), u16(dosDate),
            u32(crc), u32(data.length), u32(data.length),
            u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
            Array.from(nameBytes)));
        offset += local.length + nameBytes.length + data.length;
    });

    const cdStart = out.length;
    let cdSize = 0;
    central.forEach(ent => {
        [0x50, 0x4B, 0x01, 0x02].forEach(b => out.push(b));
        ent.forEach(b => out.push(b));
        cdSize += 4 + ent.length;
    });
    [0x50, 0x4B, 0x05, 0x06]
        .concat(u16(0), u16(0), u16(entries.length), u16(entries.length),
            u32(cdSize), u32(cdStart), u16(0))
        .forEach(b => out.push(b));
    return Uint8Array.from(out);
}

function colRef(i) {
    let s = '', n = i + 1;
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Sel berupa string biasa atau {t,n,f} -> objek sel seragam. */
function reportCell(c) {
    if (c && typeof c === 'object') return c;
    return { t: String(c === null || c === undefined ? '' : c), n: false };
}

function buildTableXlsx(d) {
    const sheetRows = [];
    let r = 0;
    const pushRow = cells => {
        r++;
        sheetRows.push('<row r="' + r + '">' + cells.map((c, i) => {
            const cell = reportCell(c);
            return cell.n
                ? '<c r="' + colRef(i) + r + '"><v>' + cell.t + '</v></c>'
                : '<c r="' + colRef(i) + r + '" t="inlineStr"><is><t xml:space="preserve">' +
                    xmlEsc(cell.t) + '</t></is></c>';
        }).join('') + '</row>');
    };
    const S = t => ({ t: String(t), n: false });
    const N = v => ({ t: String(v), n: true });

    pushRow([S(d.title || 'LAPORAN REKAP')]);
    pushRow([S(d.org || '')]);
    pushRow([S('Periode: ' + d.period + '  ·  Dibuat: ' + d.generated)]);
    pushRow([]);
    pushRow((d.columns || []).map(c => S(c)));
    (d.rows || []).forEach(row => pushRow(row.map(c => (c && typeof c === 'object') ? c : S(c))));
    pushRow([]);
    pushRow([S('RINGKASAN')]);
    (d.summary || []).forEach(item => {
        pushRow([S(item.label), typeof item.value === 'number' ? N(item.value) : S(String(item.value))]);
    });

    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<cols><col min="1" max="1" width="18" customWidth="1"/>' +
        '<col min="2" max="4" width="16" customWidth="1"/>' +
        '<col min="5" max="10" width="22" customWidth="1"/></cols>' +
        '<sheetData>' + sheetRows.join('') + '</sheetData></worksheet>';

    return zipStore([
        { name: '[Content_Types].xml', text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '</Types>' },
        { name: '_rels/.rels', text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>' },
        { name: 'xl/workbook.xml', text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="' + xmlEsc(d.sheetName || 'Rekap') + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            '</Relationships>' },
        { name: 'xl/styles.xml', text:
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
            '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
            '<fill><patternFill patternType="gray125"/></fill></fills>' +
            '<borders count="1"><border/></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
            '</styleSheet>' },
        { name: 'xl/worksheets/sheet1.xml', text: sheet }
    ]);
}

/* ---------- Pembuat PDF 1.4 (A4 lanskap, teks, multi-halaman) ---------- */
function pdfSan(s) {
    let out = '';
    const str = String(s === null || s === undefined ? '' : s);
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c < 32 || c > 255) c = (c > 255) ? 63 : 32;   // '?' utk non-latin1
        if (c === 40 || c === 41 || c === 92) out += '\\';
        out += String.fromCharCode(c);
    }
    return out;
}

function pdfTrunc(s, maxChars) {
    const str = String(s || '');
    return str.length <= maxChars ? str : str.slice(0, Math.max(0, maxChars - 1)) + '...';
}

/* Lebar kolom PDF: preset tabel 10 kolom rekap lama, atau dibagi rata. */
function pdfWidths(n) {
    if (n === 10) return [54, 72, 84, 52, 78, 70, 104, 84, 96, 100];
    const total = 794;
    const w = Math.floor(total / n);
    const arr = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
        const v = (i === n - 1) ? (total - used) : w;
        arr.push(v);
        used += v;
    }
    return arr;
}

function buildTablePdf(d) {
    const W = 842, H = 595;                      // A4 lanskap (point)
    const widths = pdfWidths((d.columns || []).length);
    const x0 = 24, step = 11, font = 7, bottom = 34;
    const maxChars = w => Math.max(3, Math.floor(w / 3.5));
    const title = d.title || 'LAPORAN REKAP';

    const pages = [];
    let cur = [], y = 0;

    function txt(x, s, fName, size, gray) {
        cur.push(gray + ' rg BT /' + fName + ' ' + size + ' Tf 1 0 0 1 ' +
            x + ' ' + y + ' Tm (' + pdfSan(s) + ') Tj ET');
    }

    function drawTableHeader() {
        cur.push('0.16 0.20 0.28 rg ' + x0 + ' ' + (y - 3) + ' 794 12 re f');
        let x = x0;
        d.columns.forEach((h, i) => {
            txt(x + 2, pdfTrunc(h, maxChars(widths[i])), 'F2', 7, '1 1 1');
            x += widths[i];
        });
        cur.push('0 0 0 rg');
        y -= step;
    }

    function newPage(first) {
        if (cur.length) pages.push(cur.join('\n'));
        cur = [];
        if (first) {
            y = H - 34;
            txt(x0, title, 'F2', 15, '0.12 0.45 0.85');
            y -= 14;
            txt(x0, d.org || '', 'F1', 9, '0 0 0');
            y -= 12;
            txt(x0, 'Periode: ' + d.period + '   -   Dibuat: ' + d.generated +
                '   -   ' + (d.rows || []).length + ' baris', 'F1', 8, '0.35 0.35 0.35');
            y -= 16;
        } else {
            y = H - 30;
            txt(x0, title + ' (lanjutan)', 'F2', 8, '0.12 0.45 0.85');
            y -= 14;
        }
        drawTableHeader();
    }

    function ensure(h) {
        if (y < bottom + h) newPage(false);
    }

    newPage(true);
    (d.rows || []).forEach(row => {
        ensure(56);
        let x = x0;
        row.forEach((cell, i) => {
            const c = reportCell(cell);
            txt(x + 2, pdfTrunc(c.f != null ? c.f : c.t, maxChars(widths[i])), 'F1', font, '0 0 0');
            x += widths[i];
        });
        y -= step;
    });

    ensure(64);
    y -= 6;
    txt(x0, 'RINGKASAN', 'F2', 9, '0.12 0.45 0.85');
    y -= 12;
    (d.summary || []).forEach(item => {
        ensure(10);
        txt(x0, item.label + ': ' + item.value, 'F1', 8, '0 0 0');
        y -= 10;
    });
    if (cur.length) pages.push(cur.join('\n'));

    // Susun objek PDF
    const total = pages.length;
    const streams = pages.map((s, i) => s + '\n0 0 0 rg BT /F1 7 Tf 1 0 0 1 740 20 Tm (' +
        pdfSan('Halaman ' + (i + 1) + ' / ' + total) + ') Tj ET');

    let out = '%PDF-1.4\n';
    const offs = [];
    function obj(num, body) {
        offs[num] = out.length;
        out += num + ' 0 obj\n' + body + '\nendobj\n';
    }
    const kids = streams.map((_, i) => (5 + 2 * i) + ' 0 R').join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + streams.length + ' /Kids [ ' + kids + ' ] >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    streams.forEach((s, i) => {
        obj(5 + 2 * i, '<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ' + W + ' ' + H +
            ' ] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + 2 * i) + ' 0 R >>');
        obj(6 + 2 * i, '<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream');
    });

    const xrefPos = out.length;
    const count = 5 + 2 * streams.length;   // objek 1..(count-1) + slot 0
    let xref = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (let n = 1; n < count; n++) {
        xref += ('000000000' + offs[n]).slice(-10) + ' 00000 n \n';
    }
    out += xref + 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' +
        xrefPos + '\n%%EOF';

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return bytes;
}
