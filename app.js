/* 언어별 news JSON을 읽어 목록을 그립니다.
   기사 데이터는 이 파일이 아니라 data/news.<lang>.json 에 있습니다. */
(function () {
  var list = document.getElementById('news-list');
  if (!list) return;

  var src = list.getAttribute('data-src');
  var emptyMsg = list.getAttribute('data-empty') || 'No articles yet.';
  var errorMsg = list.getAttribute('data-error') || 'Could not load articles.';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  fetch(src)
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (items) {
      if (!Array.isArray(items)) throw new Error('not an array');
      items.sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
      if (items.length === 0) {
        list.innerHTML = '<li><span class="meta">' + esc(emptyMsg) + '</span></li>';
        return;
      }
      list.innerHTML = items.map(function (item) {
        return '<li>' +
          '<span class="tag">' + esc(item.tag || '') + '</span>' +
          '<h3>' + esc(item.title || '') + '</h3>' +
          '<span class="meta">' + esc(item.date || '') + '</span>' +
          '</li>';
      }).join('');
    })
    .catch(function () {
      list.innerHTML = '<li><span class="meta">' + esc(errorMsg) + '</span></li>';
    });
})();
