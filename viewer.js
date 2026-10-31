// 分享檢視頁：從網址 # 後面取出資料、解壓並驗證，然後用 textContent 顯示（絕不使用 innerHTML 放資料）。
(function () {
  'use strict';
  const L = (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const T = {
    zh: { items: (n) => `${n} 個連結`, search: '搜尋這份清單', bookmarks: '下載瀏覽器書籤檔', csv: '下載 CSV', empty: '網址裡沒有分享資料，或資料已損毀。請向分享的人重新索取連結。', foot: '這份清單的資料全部放在網址的 # 後面，只在你的瀏覽器裡解開，不會傳到任何伺服器。連結來自分享者，請自行判斷是否安全。', title: '分享的連結' },
    en: { items: (n) => `${n} links`, search: 'Search this list', bookmarks: 'Download browser bookmarks file', csv: 'Download CSV', empty: 'No share data in this URL, or the data is damaged. Ask the sender for a new link.', foot: 'All data for this list lives after the # in the URL and is decoded only in your browser — nothing is sent to a server. Links come from the sender; use your own judgment.', title: 'Shared links' },
  }[L];
  const $ = (id) => document.getElementById(id);
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000); };

  $('foot').textContent = T.foot;
  $('q').placeholder = T.search;
  $('dlBookmarks').textContent = T.bookmarks;
  $('dlCsv').textContent = T.csv;

  let rows = [];
  let current = null;
  $('q').addEventListener('input', () => { const q = $('q').value.trim().toLowerCase(); rows.forEach((r) => { r.li.hidden = !!q && !r.hay.includes(q); }); });
  $('dlBookmarks').onclick = () => current && download(new Blob([RSExport.toBookmarkHtml(current.items.map((x) => ({ url: x.u, title: x.t })), { title: current.title || T.title })], { type: 'text/html;charset=utf-8' }), 'bookmarks.html');
  $('dlCsv').onclick = () => current && download(new Blob([RSExport.toCsv([['Title', 'URL', 'Tags', 'Note'], ...current.items.map((x) => [x.t, x.u, x.g.join(', '), x.n])])], { type: 'text/csv;charset=utf-8' }), 'links.csv');

  function render(pack) {
    current = pack;
    document.title = pack.title || T.title;
    $('title').textContent = pack.title || T.title;
    $('sub').textContent = T.items(pack.items.length);
    $('bar').hidden = false;
    $('q').value = '';
    const ul = document.createElement('ul');
    rows = pack.items.map((x) => {
      const li = document.createElement('li');
      if (x.c) { const img = document.createElement('img'); img.src = x.c; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; li.appendChild(img); }
      const box = document.createElement('div');
      const t = document.createElement('div'); t.className = 't';
      const a = document.createElement('a'); a.href = x.u; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.textContent = x.t || x.u; t.appendChild(a);
      const u = document.createElement('div'); u.className = 'u'; u.textContent = x.u;
      box.append(t, u);
      if (x.g.length) { const g = document.createElement('div'); g.className = 'g'; g.textContent = x.g.map((s) => '#' + s).join(' '); box.appendChild(g); }
      if (x.n) { const n = document.createElement('div'); n.className = 'n'; n.textContent = x.n; box.appendChild(n); }
      li.appendChild(box);
      ul.appendChild(li);
      return { li, hay: (x.t + ' ' + x.u + ' ' + x.g.join(' ')).toLowerCase() };
    });
    $('out').replaceChildren(ul);
  }

  function fail() {
    current = null; rows = [];
    $('bar').hidden = true;
    $('title').textContent = T.title;
    $('sub').textContent = '';
    const d = document.createElement('div'); d.className = 'err'; d.textContent = T.empty;
    $('out').replaceChildren(d);
  }

  // 換貼另一個分享連結時只有 # 後面變，頁面不會重新載入，所以要監聽 hashchange
  function load() {
    const m = /^#p=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return fail();
    RSShare.decodePack(m[1]).then(render).catch(fail);
  }
  window.addEventListener('hashchange', load);
  load();
})();
