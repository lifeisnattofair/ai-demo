// 목록이 비었을 때 보여 주는 화면(사용자 화면 공용). 제목, 다음 행동 안내, 선택적으로 이동 링크나 버튼 하나.
// 스타일은 .empty-state (src/styles/screens.css) 입니다.

/**
 * @param {{title:string, body?:string, href?:string, label?:string, onAction?:()=>void, level?:2|3}} opts
 * @returns {HTMLElement}
 */
export function emptyState({ title, body, href, label, onAction, level = 2 }) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  const h = document.createElement(`h${level}`);
  h.textContent = title;
  box.append(h);
  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    box.append(p);
  }
  if (label && (href || onAction)) {
    const a = document.createElement(href ? 'a' : 'button');
    a.className = 'btn btn-secondary';
    a.textContent = label;
    if (href) a.href = href;
    else { a.type = 'button'; a.addEventListener('click', onAction); }
    box.append(a);
  }
  return box;
}
