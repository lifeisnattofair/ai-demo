// 세로 3:4 사진 포스터. 사진은 장식이고, 제목과 기간과 유형은 실제 텍스트로 얹습니다.
// 마크업과 클래스는 설계 확정본(user-list.html)의 .poster 와 같습니다.

export const TYPE_LABEL = { PERFORMANCE: '공연', EXPERIENCE: '체험', COURSE: '정규 강좌' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 제목의 줄바꿈(\n)만 <br> 로 바꾸고 나머지는 글자 그대로 넣습니다.
function lines(node, text) {
  String(text ?? '').split('\n').forEach((line, i) => {
    if (i > 0) node.append(document.createElement('br'));
    node.append(document.createTextNode(line));
  });
  return node;
}

/**
 * @param {HTMLElement} host 포스터를 넣을 틀(.poster-wrap 클래스를 붙입니다)
 * @param {{image?:string, imagePosition?:string, tone?:'light'|'dark', series?:string, title:string,
 *   subtitle?:string, type?:string, periodText?:string, venue?:string}} p
 */
export function renderPoster(host, p) {
  host.classList.add('poster-wrap');
  const poster = el('div', 'poster');
  if (p.tone === 'light') poster.classList.add('light');

  const typeLabel = TYPE_LABEL[p.type] ?? '';
  const inner = el('div', 'p-inner');
  // 시리즈 문구가 없으면 유형 라벨이 그 자리에 보이고, 있으면 읽어 주기만 합니다.
  if (p.series) {
    if (typeLabel) inner.append(el('span', 'sr-only', typeLabel));
    inner.append(el('span', 'p-series', p.series));
  } else {
    inner.append(el('span', 'p-series', typeLabel));
  }
  inner.append(lines(el('span', 'p-title'), p.title));
  if (p.subtitle) inner.append(el('span', 'p-sub', p.subtitle));
  if (p.periodText || p.venue) {
    const meta = el('span', 'p-meta');
    if (p.periodText) meta.append(el('span', null, p.periodText));
    if (p.venue) meta.append(el('span', null, p.venue));
    inner.append(meta);
  }

  if (p.image) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = p.image;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (p.imagePosition) img.style.objectPosition = p.imagePosition;
    // 사진을 못 불러와도 빈 상자가 되지 않게 사진만 걷어 내고 같은 글자를 남깁니다.
    img.addEventListener('error', () => {
      img.remove();
      poster.classList.add('no-image');
    });
    poster.append(img);
  } else {
    poster.classList.add('no-image');
  }
  poster.append(inner);
  host.replaceChildren(poster);
  return poster;
}
