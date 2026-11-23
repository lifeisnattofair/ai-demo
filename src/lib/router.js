// 해시 라우터. 패턴 예: '#/programs/:id'. 핸들러 시그니처: (params, el, query) => void | Promise<void>

const NOT_FOUND = '페이지를 찾을 수 없습니다.';
const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${source}$`), keys };
}

function splitHash(hash) {
  // '#/...' 이 아닌 해시(인증 메일 링크의 토큰 등)는 홈으로 봅니다.
  const h = hash && hash.startsWith('#/') ? hash : '#/';
  const i = h.indexOf('?');
  const path = i === -1 ? h : h.slice(0, i);
  const query = new URLSearchParams(i === -1 ? '' : h.slice(i + 1));
  return { path: path.length > 2 ? path.replace(/\/+$/, '') : path, query };
}

function messageBlock(title, body, href, label) {
  const wrap = document.createElement('section');
  wrap.className = 'container page-message';
  const h = document.createElement('h1');
  h.className = 'page-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  wrap.append(h, p);
  if (href) {
    const a = document.createElement('a');
    a.className = 'btn btn-secondary';
    a.href = href;
    a.textContent = label;
    wrap.append(a);
  }
  return wrap;
}

export function createRouter(routes, el) {
  const table = Object.entries(routes).map(([pattern, handler]) => ({ ...compile(pattern), handler }));
  let seq = 0;
  let last = null;

  async function render(hash) {
    const my = ++seq;
    last = hash;
    const { path, query } = splitHash(hash);
    for (const { re, keys, handler } of table) {
      const m = re.exec(path);
      if (!m) continue;
      const params = {};
      try {
        keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      } catch {
        break; // 잘못된 퍼센트 인코딩은 없는 주소로 봅니다.
      }
      try {
        await handler(params, el, query);
      } catch (e) {
        console.error(e);
        if (my === seq) el.replaceChildren(messageBlock('문제가 발생했습니다.', GENERIC_ERROR, '#/', '처음으로'));
      }
      if (my === seq) afterRender();
      return;
    }
    if (my !== seq) return;
    el.replaceChildren(messageBlock(NOT_FOUND, '주소를 다시 확인하시거나 처음 화면에서 원하는 메뉴를 선택해 주세요.', '#/', '처음으로'));
    afterRender();
  }

  // 화면이 바뀌면 문서 제목을 갱신하고 초점을 본문으로 옮겨 스크린리더가 새 화면을 읽게 합니다.
  function afterRender() {
    document.title = pageTitle(el);
    if (el.hasAttribute('tabindex')) el.focus({ preventScroll: true });
  }

  return {
    start() {
      window.addEventListener('hashchange', () => {
        if (window.location.hash !== last) render(window.location.hash);
      });
      return render(window.location.hash);
    },
    go(path) {
      const p = render(path);
      if (window.location.hash !== path) window.location.hash = path;
      return p;
    },
    // 방문 기록을 늘리지 않고 주소를 바꿉니다(예전 주소 별칭, 뒤로 가기로 다시 돌아오면 안 되는 이동).
    replace(path) {
      const p = render(path);
      if (window.location.hash !== path) window.history.replaceState(window.history.state, '', path);
      return p;
    },
  };
}

/**
 * 문서 제목: 화면이 정한 data-title(필터를 반영한 목록 등)이 먼저이고, 없으면 h1 글자입니다.
 * h1 안의 줄바꿈(<br>) 자리는 띄어 씁니다.
 */
export function pageTitle(root) {
  const own = root.querySelector('[data-title]')?.dataset.title?.trim();
  let name = own;
  if (!name) {
    const h1 = root.querySelector('h1');
    if (h1) {
      const copy = h1.cloneNode(true);
      copy.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
      name = copy.textContent.replace(/\s+/g, ' ').trim();
    }
  }
  return name ? `${name} | 한빛아트센터` : '한빛아트센터';
}
