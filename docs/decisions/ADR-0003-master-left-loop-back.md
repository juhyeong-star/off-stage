---
name: adr-0003-master-left-loop-back
description: 아티스트 페이지에서 마스터 블록을 왼쪽으로 배치하고 데모 체인이 오른쪽으로 흐른 뒤 마지막에 마스터로 회귀(↺)하는 순환형 레이아웃 채택. 데모 1→2→...→8→마스터.
status: accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

# ADR-0003 — Master Block on LEFT with Loop-Back to Master

## Context

데모→마스터 흐름의 공간 배치 옵션:
- A. 마스터 LEFT (anchor) + 데모 RIGHT → 흐름 (당시 v=118)
- B. 마스터 RIGHT (destination) + 데모 LEFT
- C. 마스터 TOP + 데모 BELOW (vertical)

사용자 요청 (v=121→122): "마스터는 왼쪽으로 옮겨주고 화살은 데모1부터 데모8까지 따라가다 마스터에게 오는걸로 순환형 또는 일자형으로 구성".

## Decision

순환형(loop-back) 옵션 A 변형:
- 마스터 블록 = 왼쪽 anchor (200px 폭)
- 데모 체인 = 오른쪽에서 가로 스크롤
- 마스터 블록 오른쪽 모서리에 ↶ 회전 화살표 (검정 원형 아이콘)
- 마지막 데모 → 후 별도 "↺ MASTER" 민트 배지로 회귀 명시

후속 작업 (v=123)에서 사용자 요청으로 마스터 옆 세로선/↶/제목/MASTER 이름 모두 제거. 현재는 cover 이미지만 남음.

## Consequences

**긍정**
- 시간 흐름(데모 1→N)이 좌→우 자연스러운 reading order
- 마스터가 anchor 역할로 "출발점이자 도착점" 시각화
- 가로 스크롤이 흐름 메타포와 조화

**부정**
- 데모 8개 이상이면 마스터와 마지막 데모가 화면에서 멀어짐
- 화살표·세로선 시각 요소들이 한때 과도해서 정리 필요했음 (v=123)

## 영향 파일

- `css/global.css` (`.artist-canvas .project-header`, `.demo-path`)
- `js/app.js` (renderProjectBox 구조)
