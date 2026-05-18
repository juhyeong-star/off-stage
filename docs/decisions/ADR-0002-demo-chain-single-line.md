---
name: adr-0002-demo-chain-single-line
description: 아티스트 페이지의 데모 카드 체인을 wrap 멀티줄에서 단일 가로줄 + 가로 스크롤로 전환한 결정. 8개 이상이면 자연스럽게 스크롤. 시간 흐름의 일직선 시각화를 우선.
status: accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

# ADR-0002 — Demo Chain: Single Horizontal Line over Wrap

## Context

아티스트 페이지에서 데모1→2→3→...→마스터 흐름을 어떻게 보일지 두 옵션:
- A. `flex-wrap: wrap` — 4×2 그리드로 8개 한눈에
- B. `flex-wrap: nowrap` + `overflow-x: auto` — 한 줄 가로 스크롤

초기엔 A로 구현. 사용자 피드백: "데모는 깔끔히 한줄형이 좋을듯".

## Decision

옵션 B 채택. `.demo-path { flex-direction: row; flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x proximity; }`

데모 카드 사이 → 화살표는 모든 카드 우측에 표시. 마지막 카드 → 가 마스터 블록(왼쪽 anchor)으로 회귀하는 흐름 (ADR-0003 참조).

## Consequences

**긍정**
- 시간 흐름이 일직선으로 명확
- 화살표 → 가 row 끝에서 다음 row로 점프하는 어색함 해결
- scroll-snap 으로 카드 단위 스크롤 자연스러움

**부정**
- 8개 이상이면 한눈에 안 보임 → 사용자 피드백상 OK ("스크롤 방식 괜찮아")

## 영향 파일

- `css/global.css` (`.artist-canvas .demo-path`)
- `js/app.js` 변경 없음 (CSS-only)
