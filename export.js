/*
 * export.js — 匯出：CSV（Excel／Google 試算表都能開）、真正的 .xlsx（多工作表、凍結標題列、篩選、可點的連結）、
 * 瀏覽器書籤檔（Netscape 格式，任何瀏覽器都能匯入）、搜尋關鍵字清單。
 * 一般腳本（非 ES module），與 extract.js 同樣方式載入；純函式，沒有 DOM 依賴。
 */
(function (root) {
  'use strict';

  // ---------- 共用 ----------
  // 試算表公式注入：以 = + - @ 開頭的文字，Excel／Sheets 會當公式執行，前面補一個 '
  const guard = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));

  // ---------- CSV ----------
  function toCsv(rows) {
    const cell = (v) => {
      const s = v == null ? '' : String(guard(typeof v === 'object' && v.text != null ? v.text : v));
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // UTF-8 BOM：Excel 才會正確辨識中日文
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- zip（只用「存放」不壓縮，夠小也最簡單可靠）----------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const DOS_TIME = 0;
    const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let p = 0;
    for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }

  // ---------- xlsx ----------
  const xmlEsc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

  function sheetXml(rows, widths) {
    const cols = widths && widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const data = rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        const head = ri === 0 ? ' s="1"' : '';
        if (v == null || v === '') return '';
        if (typeof v === 'number') return `<c r="${ref}"${head}><v>${v}</v></c>`;
        if (typeof v === 'object' && v.link) {
          const url = String(v.link);
          const text = String(v.text == null ? url : v.text);
          // HYPERLINK 的字串引數上限 255 字元；超過或不是 http(s) 就退回純文字，避免公式錯誤與注入
          if (isHttp(url) && url.length <= 250 && !/["\r\n]/.test(url)) {
            const f = `HYPERLINK("${url}","${text.replace(/"/g, '""').slice(0, 200)}")`;
            return `<c r="${ref}" t="str" s="2"><f>${xmlEsc(f)}</f><v>${xmlEsc(text)}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
        }
        return `<c r="${ref}" t="inlineStr"${head}><is><t xml:space="preserve">${xmlEsc(guard(String(v)))}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const lastCol = colName(Math.max(0, (rows[0] || []).length - 1));
    const filter = rows.length > 1 ? `<autoFilter ref="A1:${lastCol}${rows.length}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${data}</sheetData>${filter}</worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

  function safeSheetName(name, used) {
    let n = String(name || 'Sheet').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let k = 2;
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + k++;
    used.add(n.toLowerCase());
    return n;
  }

  // sheets: [{ name, rows: [[標題列…], [資料…]…], widths?: [數字…] }]；儲存格可為字串、數字或 { link, text }
  function toXlsx(sheets) {
    const used = new Set();
    const list = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }));
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
      ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) })),
    ];
    return zip(files);
  }

  // ---------- 瀏覽器書籤檔（Netscape 格式：Chrome／Firefox／Safari／Edge 都能匯入）----------
  function toBookmarkHtml(items, { title = 'Bookmarks', now = Date.now() } = {}) {
    const ts = Math.floor(now / 1000);
    const li = items.filter((i) => isHttp(i.url)).map((i) => `        <DT><A HREF="${xmlEsc(i.url)}" ADD_DATE="${Math.floor((i.addedAt || now) / 1000)}">${xmlEsc(i.title || i.url)}</A>`).join('\n');
    return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n    <DT><H3 ADD_DATE="${ts}">${xmlEsc(title)}</H3>\n    <DL><p>\n${li}\n    </DL><p>\n</DL><p>\n`;
  }

  // ---------- 搜尋關鍵字：每筆一行，方便貼到搜尋引擎找回遺失的片源 ----------
  function keywordLine(it) {
    const title = String(it.title || '').replace(/\s+/g, ' ').trim();
    const id = it.code || ''; // 有編號的作品用「編號 片名」
    if (id && title) return title.toUpperCase().includes(id.toUpperCase()) ? title : `${id} ${title}`; // 標題已含編號就不重複
    if (id) return id;
    const channel = String(it.channel || '').replace(/\s+/g, ' ').trim(); // 其餘用「片名 頻道」
    if (title && channel && !title.toLowerCase().includes(channel.toLowerCase())) return `${title} ${channel}`;
    return title || it.url;
  }
  const keywordLines = (items) => [...new Set(items.map(keywordLine))].join('\n');

  const api = { toCsv, toXlsx, zip, crc32, toBookmarkHtml, keywordLine, keywordLines, colName };
  root.RSExport = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
