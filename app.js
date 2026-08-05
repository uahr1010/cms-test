/* 언어별 news JSON을 읽어 목록을 그립니다.
   기사 데이터는 이 파일이 아니라 data/news.<lang>.json 에 있습니다.
   각 기사에 image 값이 있으면 사진도 함께 보여줍니다. */
(function () {
  var list = document.getElementById('news-list');
  if (!list) return;

  var src = list.getAttribute('data-src');
  var base = list.getAttribute('data-base') || '';
  var emptyMsg = list.getAttribute('data-empty') || 'No articles yet.';
  var errorMsg = list.getAttribute('data-error') || 'Could not load articles.';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* 사진 경로 보정:
     Pages CMS는 /media/images/... 처럼 맨 앞에 슬래시를 붙여 저장합니다.
     하위 폴더(en/, ja/, zh/)에서도 올바르게 찾도록 상대 경로로 바꿉니다. */
  function imgSrc(p) {
    if (!p) return '';
    if (/^https?:\/\//.test(p)) return p;
    return base + String(p).replace(/^\/+/, '');
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
        var thumb = item.image
          ? '<img class="thumb" src="' + esc(imgSrc(item.image)) + '" alt="" loading="lazy">'
          : '<span class="thumb thumb-empty" aria-hidden="true"></span>';
        var excerpt = item.body
          ? '<p class="excerpt">' + esc(String(item.body).split('\n')[0]) + '</p>'
          : '';
        return '<li>' +
          '<span class="tag">' + esc(item.tag || '') + '</span>' +
          thumb +
          '<div class="entry">' +
            '<h3>' + esc(item.title || '') + '</h3>' +
            excerpt +
          '</div>' +
          '<span class="meta">' + esc(item.date || '') + '</span>' +
          '</li>';
      }).join('');
    })
    .catch(function () {
      list.innerHTML = '<li><span class="meta">' + esc(errorMsg) + '</span></li>';
    });
})();
