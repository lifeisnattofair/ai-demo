// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderPoster } from '../../src/user/components/poster.js';
import { posterImage } from '../../src/user/components/poster-images.js';

const BASE = {
  image: '/img/quartet.jpg',
  tone: 'dark',
  series: 'HANBIT CHAMBER 2026',
  title: '현의\n대화',
  subtitle: '겨울 실내악 시리즈',
  type: 'PERFORMANCE',
  periodText: '12.12 - 12.13',
  venue: '소극장',
};

describe('renderPoster', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('div');
    document.body.replaceChildren(el);
  });

  it('제목, 기간, 유형 라벨이 실제 텍스트로 들어갑니다', () => {
    renderPoster(el, BASE);
    const text = el.textContent;
    expect(text).toContain('현의');
    expect(text).toContain('대화');
    expect(text).toContain('겨울 실내악 시리즈');
    expect(text).toContain('12.12 - 12.13');
    expect(text).toContain('공연');
    expect(text).toContain('소극장');
  });

  it('제목의 줄바꿈은 br 로 나뉘고 HTML 은 해석하지 않습니다', () => {
    renderPoster(el, { ...BASE, title: '<b>현의</b>\n대화' });
    const title = el.querySelector('.p-title');
    expect(title.querySelectorAll('br')).toHaveLength(1);
    expect(title.querySelector('b')).toBeNull();
    expect(title.textContent).toContain('<b>현의</b>');
  });

  it('사진은 장식(alt 빈 값)이고 3:4 포스터 틀을 씁니다', () => {
    renderPoster(el, BASE);
    const img = el.querySelector('img');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('src')).toBe('/img/quartet.jpg');
    expect(el.querySelector('.poster')).not.toBeNull();
    expect(el.querySelector('.poster').classList.contains('light')).toBe(false);
  });

  it('밝은 사진은 light 변형을 씁니다', () => {
    renderPoster(el, { ...BASE, tone: 'light' });
    expect(el.querySelector('.poster').classList.contains('light')).toBe(true);
  });

  it('이미지가 없으면 사진 없이 같은 글자가 남습니다', () => {
    renderPoster(el, { ...BASE, image: '' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.poster').classList.contains('no-image')).toBe(true);
    expect(el.textContent).toContain('현의');
    expect(el.textContent).toContain('12.12 - 12.13');
  });

  it('이미지 로딩에 실패하면 사진을 치우고 같은 글자가 남습니다', () => {
    renderPoster(el, BASE);
    el.querySelector('img').dispatchEvent(new Event('error'));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.poster').classList.contains('no-image')).toBe(true);
    expect(el.querySelector('.p-title').textContent).toContain('현의');
    expect(el.textContent).toContain('공연');
  });

  it('시리즈 문구가 없으면 유형 라벨이 그 자리에 보입니다', () => {
    renderPoster(el, { ...BASE, series: '' });
    expect(el.querySelector('.p-series').textContent).toBe('공연');
  });
});

describe('posterImage', () => {
  it('알려진 키는 이미지 주소로, 모르는 키나 빈 값은 빈 문자열로 바꿉니다', () => {
    for (const key of ['quartet', 'theater', 'pottery', 'makeup', 'choir', 'watercolor']) {
      expect(posterImage(key).src).toBeTruthy();
    }
    expect(posterImage('nope').src).toBe('');
    expect(posterImage(null).src).toBe('');
  });
});
