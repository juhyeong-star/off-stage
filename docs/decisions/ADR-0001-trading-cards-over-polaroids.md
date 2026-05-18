---
name: adr-0001-trading-cards-over-polaroids
description: STO 후원 컬렉션 디자인을 폴라로이드 갤러리에서 포켓몬/야구 트레이딩 카드 스타일로 전환한 결정. 단일 노란색 + 두꺼운 검정 테두리 + 청키 그림자 + 시리얼 번호. 컬렉션 감성 + 수집욕 자극.
status: accepted
date: 2026-05-11
supersedes: null
superseded_by: null
---

# ADR-0001 — Trading Cards over Polaroids for STO Collection

## Context

청취자 페이지 STO 후원 컬렉션을 처음엔 Poolsuite 톤 폴라로이드(흰 테두리 + 회전 + 사진 위 시리얼)로 만듦. 문제:
- 폴라로이드는 "기억" 메타포지만 STO는 "투자/수집" 메타포
- 회전된 폴라로이드가 흩뿌려져 있어서 정렬·비교 불편
- 사용자 피드백: "포켓몬/야구카드 모으는 느낌"

## Decision

폴라로이드 → 트레이딩 카드 스타일:
- 두꺼운 검정 테두리 (3px) + 14px 라운드
- 청키 그림자 (4px 4px 0 #111 + halo)
- 4종 등급별 그라데이션 (씨앗→데모→비트→라이브→별빛)
- Lv3+ 홀로그래픽 시머 애니메이션
- 시리얼 번호 `1-XXX-XXXX` 형식 (트레이딩 카드 일련번호 모방)

후속(ADR-0005) 에서 LG gram 톤으로 한 번 더 부드럽게 다듬음 — 검정 테두리 제거하고 파스텔 그라데이션만 사용.

## Consequences

**긍정**
- 수집 동기 강화 (도장 깨기 게임 같은 felt)
- 등급별 색 차이로 진행도 한눈에
- 시리얼 번호로 unique 감성 확보

**부정**
- 트레이딩 카드 청키 톤이 다른 페이지(데모 카드)와 충돌 → ADR-0005에서 통일 작업

## 영향 파일

- `js/app.js` (renderProfile의 stoSection)
- `css/global.css` (`.spo-card`, `.tama-card`)
- `js/polaroid.js` (`_stoSerial` 함수 유지)
