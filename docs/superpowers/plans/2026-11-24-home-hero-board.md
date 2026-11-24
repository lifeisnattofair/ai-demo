# 메인 첫 화면 대표 공연 + 예매 현황판 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메인 첫 화면을 큰 대표 사진(왼쪽)과 「지금 예매할 수 있는 회차」 현황판(오른쪽)으로 바꾼다.

**Architecture:** `src/user/pages/programs.js`의 hero 마크업과 `renderFeature`를 바꾸고, 현황판 행 계산을 순수 함수 `boardRows`로 분리해 테스트한다. 데이터는 이미 불러오는 `programs`와 `remaining`을 쓴다. 스타일은 `src/styles/user.css`의 hero 구역만 교체한다.

**Tech Stack:** Vite, 바닐라 JS, Vitest(jsdom), KRDS 토큰

**Spec:** `docs/superpowers/specs/2026-11-24-home-hero-board-design.md`

## Global Constraints

- 상태 문구: `잔여 N석`, 잔여 1~5석 `마감 임박 N석`, 잔여 0 `매진, 대기 신청`, 모름 `예매 중`
- 현황판: ON_SALE, SOLD_OUT_WAITLIST 회차만, 시작 시각 순, 최대 6건
- 빈 현황판 문구: `지금 예매할 수 있는 회차가 없습니다.`
- 누름 영역 44px 이상, 글자 대비 4.5:1, 자동 넘김 없음, 가운뎃점(·) 쓰지 않음
- 기존 클래스 `.hero`, `.hero-feature h2 a`, `a[href="#/me/bookings"]`(글자 「내 예약 확인」) 유지

## Review Focus

- 잔여석 조회 실패(remaining에 키 없음): 매진으로 보지 않고 「예매 중」
- 취소된 회차와 판매 전 회차는 현황판에 없어야 함
- 프로그램 이름이 길 때 한 줄 말줄임, 행 높이 44px 유지
- 모바일 폭에서 가로 스크롤 없음
- 사진이 없는 프로그램(poster_image null)도 대표 칸이 깨지지 않음

---

### Task 1: 현황판과 대표 칸

**Files:**
- Modify: `src/user/pages/programs.js`
- Modify: `src/styles/user.css`
- Modify: `DESIGN.md` (홈 초점 문구)
- Test: `tests/ui/programs.test.js`

**Interfaces:**
- Produces: `export function boardRows(programs, now: Date, remaining: Record<string, number>, limit = 6): Array<{program, offering, status: 'ON_SALE'|'SOLD_OUT_WAITLIST', left: number|undefined}>`

- [ ] **Step 1: 실패하는 테스트**: `describe('예매 현황판')`에 아래를 추가
  - `boardRows`가 fixture에서 판매 전(o6) 회차를 빼고 시작 순으로 6건 이하를 돌려준다(첫 행 o4).
  - 렌더 후 `.board li`가 6개 이하, 첫 줄 상태 `잔여 12석`, o3 줄은 `매진, 대기 신청`.
  - remaining 5이면 `마감 임박 5석`, 조회 실패 회차는 `예매 중`.
  - 줄 링크가 `#/programs/<id>`.
  - 판매 회차가 없으면 빈 문구.
  - 「전체 프로그램 보기」를 누르면 `#list-title`에 초점.
- [ ] **Step 2:** `npx vitest run tests/ui/programs.test.js` 실패 확인
- [ ] **Step 3:** `boardRows`와 hero 마크업, `renderFeature`(사진 칸), `renderBoard` 구현, CSS 교체
- [ ] **Step 4:** `npm test` 전체 통과
- [ ] **Step 5:** 브라우저(1440, 768, 375)에서 확인 후 DESIGN.md 갱신, 커밋
