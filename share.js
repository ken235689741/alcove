/*
 * share.js — 分享包：把一批連結打包成「一個網址」或「一個獨立 HTML 檔」。
 *
 * 分享網址 = <檢視頁網址>#p=<壓縮後的資料>。資料放在網址的 # 後面，瀏覽器不會把它送給任何伺服器；
 * 檢視頁是純靜態網頁（share-site/），在收到的人瀏覽器裡解開並顯示。沒有帳號、沒有資料庫。
 * 一般腳本（非 ES module），擴充功能與檢視頁共用同一份。
 */
(function (root) {
  'use strict';

  const MAX_ITEMS = 2000;
  const MAX_DECODED = 4 * 1024 * 1024; // 解壓縮後上限，防止壓縮炸彈
  const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));

  function b64urlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function pipe(bytes, stream) {
    const w = stream.writable.getWriter();
    w.write(bytes).catch(() => {});
    w.close().catch(() => {});
    const reader = stream.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_DECODED) { reader.cancel(); throw new Error('too large'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  // items: 書架項目；opts: { title, tags, notes, covers }
  function buildPack(items, opts = {}) {
    const list = items.filter((i) => isHttp(i.url)).slice(0, MAX_ITEMS).map((i) => {
      const o = { u: i.url, t: String(i.title || '').slice(0, 300) };
      if (opts.tags && i.tags && i.tags.length) o.g = i.tags.slice(0, 20);
      if (opts.notes && i.note) o.n = String(i.note).slice(0, 500);
      if (opts.covers && isHttp(i.cover)) o.c = i.cover;
      return o;
    });
    return { v: 1, t: String(opts.title || '').slice(0, 120), n: list.length, i: list };
  }

  async function encodePack(pack) {
    const raw = new TextEncoder().encode(JSON.stringify(pack));
    return b64urlEncode(await pipe(raw, new CompressionStream('deflate-raw')));
  }

  // 解碼並驗證：資料來自網址，一律視為不可信。只留 http(s) 連結，限制筆數與長度
  async function decodePack(str) {
    const raw = await pipe(b64urlDecode(str), new DecompressionStream('deflate-raw'));
    const p = JSON.parse(new TextDecoder().decode(raw));
    if (!p || p.v !== 1 || !Array.isArray(p.i)) throw new Error('bad pack');
    const items = p.i.slice(0, MAX_ITEMS).filter((x) => x && isHttp(x.u)).map((x) => ({
      u: String(x.u).slice(0, 2000),
      t: String(x.t || '').slice(0, 300),
      g: Array.isArray(x.g) ? x.g.slice(0, 20).map((t) => String(t).slice(0, 40)) : [],
      n: x.n ? String(x.n).slice(0, 500) : '',
      c: isHttp(x.c) ? String(x.c).slice(0, 2000) : '',
    }));
    return { title: String(p.t || '').slice(0, 120), items };
  }

  async function shareUrl(base, pack) {
    return base.replace(/#.*$/, '') + '#p=' + (await encodePack(pack));
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 獨立 HTML 檔：不載入任何外部資源，連結用 rel=noopener noreferrer；內容全部轉義
  function toStandaloneHtml(pack) {
    const rows = pack.i.map((x) => `<li><a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(x.t || x.u)}</a>${x.g && x.g.length ? ` <span class="g">${x.g.map((t) => '#' + esc(t)).join(' ')}</span>` : ''}${x.n ? `<div class="n">${esc(x.n)}</div>` : ''}<div class="u">${esc(x.u)}</div></li>`).join('\n');
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(pack.t || 'Shared links')}</title><style>body{font:16px/1.6 system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;max-width:820px;margin:0 auto;padding:24px 16px;color:#1c1a18;background:#f7f5f2}h1{font-size:22px}li{margin:0 0 14px;list-style:none}a{color:#c0301a;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}.u{font-size:12px;color:#655f58;overflow-wrap:anywhere}.g{font-size:13px;color:#655f58}.n{font-size:14px;color:#3a3733}ul{padding:0}@media(prefers-color-scheme:dark){body{background:#121212;color:#f2f0ed}a{color:#ff6b4f}.u,.g{color:#a8a5a0}.n{color:#d6d3ce}}</style></head><body><h1>${esc(pack.t || 'Shared links')}</h1><p>${pack.i.length}</p><ul>\n${rows}\n</ul></body></html>`;
  }

  const api = { buildPack, encodePack, decodePack, shareUrl, toStandaloneHtml, b64urlEncode, b64urlDecode, MAX_ITEMS };
  root.RSShare = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
