// 관리자 화면 공통 조각: 경로와 제목, 상태 칩 규칙, 불러오기(스켈레톤/오류) 처리
import { escapeHtml } from '../../lib/format.js';
import { showSkeleton } from '../../components/skeleton.js';
import { describeError } from '../../lib/api.js';

export const TYPE_LABEL = { PERFORMANCE: '공연', EXPERIENCE: '체험', COURSE: '정규 강좌' };
export const TYPE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'PERFORMANCE', label: '공연' },
  { value: 'EXPERIENCE', label: '체험' },
  { value: 'COURSE', label: '정규 강좌' },
];

export const typeChip = (type) => ({ text: TYPE_LABEL[type] ?? type, tone: `type-${type}` });

// 회차 판매 상태(표시용). 판단은 서버가 다시 합니다.
export function offeringState(o, nowMs) {
  if (o.status === 'CANCELLED') return { key: 'CANCELLED', text: '회차 취소', tone: 'refund' };
  if (o.status === 'CANCEL_REQUESTED') return { key: 'CANCEL_REQUESTED', text: '취소 요청', tone: 'promo' };
  if (nowMs < Date.parse(o.sale_starts_at)) return { key: 'BEFORE', text: '판매 전', tone: 'hold' };
  if (nowMs >= Date.parse(o.sale_ends_at)) return { key: 'CLOSED', text: '판매 종료', tone: 'cancel' };
  return { key: 'ON_SALE', text: '판매 중', tone: 'ok' };
}

export function pageHead({ crumbs, title, help, actions = '' }) {
  return `<div class="page-head"><div>
      <div class="crumb">${['홈', ...crumbs].map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>
      <h1>${escapeHtml(title)}</h1>
    </div>${help ? `<span class="help">${escapeHtml(help)}</span>` : ''}${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}

/**
 * el 에 스켈레톤을 보이며 load() 를 기다립니다. 실패하면 원인과 「다시 시도」를 보입니다.
 * @returns {Promise<any|undefined>} 실패하면 undefined
 */
export async function loadInto(el, kind, load, { isStale = () => false } = {}) {
  el.replaceChildren();
  const release = showSkeleton(el, kind);
  try {
    const data = await load();
    if (isStale()) return undefined;
    release();
    return data;
  } catch (err) {
    if (isStale()) return undefined;
    release();
    const box = document.createElement('div');
    box.className = 'load-error';
    box.setAttribute('role', 'alert');
    const p = document.createElement('p');
    p.textContent = `목록을 불러오지 못했습니다. ${describeError(err)}`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.textContent = '다시 시도';
    box.append(p, retry);
    el.replaceChildren(box);
    return new Promise((resolve) => {
      retry.addEventListener('click', () => resolve(loadInto(el, kind, load, { isStale })), { once: true });
    });
  }
}
