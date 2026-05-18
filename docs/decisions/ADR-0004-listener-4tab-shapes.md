---
name: adr-0004-listener-4tab-shapes
description: 청취자 페이지를 한 줄씩 쌓인 섹션에서 4개 도형 탭(▲ 투자 / ● 즐겨듣기 / ■ 포스트잇 / ◆ 데이터)으로 재구성. 도형만 표시, 글자 라벨 제거. 후원자 카드/3색 KPI 박스 등 중복 헤더 제거.
status: accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

# ADR-0004 — Listener Page: 4-Tab Shape Navigation

## Context

청취자 페이지가 처음엔 섹션 4~5개가 세로로 쌓인 구조 (STO 폴라로이드 / 플레이리스트 / 포스트잇 / 함께하는 아티스트). 문제:
- 스크롤이 너무 길어짐
- 후원자 카드 + 3색 KPI 박스가 동일 정보 중복
- 사용자 요청 (v=124): "탭으로 구분, 클릭 → 쭉, 전체"

## Decision

4 도형 탭 네비게이션:

| 탭 | 도형 | 콘텐츠 |
|----|------|--------|
| 1 | ▲ | 투자 — STO 트레이딩 카드 + 함께하는 아티스트 (포켓몬 카드) |
| 2 | ● | 즐겨듣기 — playlists |
| 3 | ■ | 포스트잇 — 내 글 + 수집한 포스트잇 |
| 4 | ◆ | 데이터 — 6개 통계 카드 (LG gram 스타일) |

- 라벨 텍스트 없음 (도형만)
- ◆ 다이아: remixicon에 `ri-rhombus-fill`이 없어서 유니코드 `◆` 직접 사용
- "응원하는 아티스트 vs 후원하는 아티스트" 헷갈림 → **함께하는 아티스트** 하나로 통합
- 폴더/저장한 곡 통계 제거 (즐겨듣기 탭이 처리)

## Consequences

**긍정**
- 페이지 height 짧아짐, 탐색 빠름
- 도형 = 일관된 시각 언어 (도형 메인 페이지와 호환)
- 데이터 탭이 LG gram 카드 그리드로 통일감

**부정**
- 라벨 없으니 첫 방문자 학습 곡선 (title 툴팁으로 완화)
- ◆ 유니코드는 폰트 따라 렌더 차이 있을 수 있음

## 영향 파일

- `js/app.js` (renderProfile 의 listenerBody 블록, switchListenerTab 함수)
- `css/global.css` (`.listener-tabs`, `.listener-tab`, `.tab-panel`, `.data-gram-card`)
