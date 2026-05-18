---
name: adr-0005-lg-gram-fonts-handwriting-split
description: 시스템 UI(라벨/헤딩/버튼)는 LG gram 모던 폰트(Inter/Archivo Black/Bebas Neue), 사용자가 직접 쓰는 글(일기/댓글/입력창 typing)만 손글씨(Caveat + Gaegu 한글 fallback)로 명확히 이분화한 결정.
status: accepted
date: 2026-05-12
supersedes: null
superseded_by: null
---

# ADR-0005 — LG gram Modern Fonts for UI + Caveat Handwriting for User Writing

## Context

처음엔 청취자/아티스트 페이지 전체에 Caveat 손글씨를 광범위하게 적용. 문제:
- Caveat는 라틴 문자만 지원 → 한글이 폴백 폰트로 떨어져 깨짐 ("글씨가 꺠져")
- 시스템 라벨까지 손글씨라 가독성 저하 + 정보 위계 모호
- LG gram x NewJeans 같은 모던 카드 톤을 청취자 데이터 탭에 도입하면서 톤 충돌 발생

사용자 피드백 (v=132): "폰트와 단어들 아티스트 페이지를 LG gram처럼 하되 댓글이나 글쓰는것만 손글씨 형태".

## Decision

폰트 책임 분리:

| 영역 | 폰트 | 이유 |
|------|------|------|
| 시스템 라벨·헤딩·버튼 | `'Inter', 'Archivo Black', 'Bebas Neue'` | 가독성·정보 위계 |
| 데이터·메타데이터 | `'Inter', sans-serif` | 미니멀 |
| **사용자가 쓴 일기 본문** | `'Caveat', 'Gaegu', 'Inter', cursive` | 감성·개인성 |
| **사용자 댓글** | `'Caveat', 'Gaegu', 'Inter', cursive` | 같은 이유 |
| **사용자 typing 중 입력창** | `'Caveat', 'Gaegu', cursive` | 같은 이유 |

한글 fallback에 **Gaegu** 추가 — Caveat는 라틴 전용이라 한글이 깨졌던 문제 해결.

`---|` 이런 라벨 톤:
- DEMO `Inter 10px uppercase`
- "MEMO & COMMENTS" `Archivo Black 16px uppercase letter-spacing 1.5px`
- "📝 아티스트의 기록" `Inter 11px uppercase` (이전 Caveat 14px에서 변경)
- "💬 댓글 N개 보기" `Inter 13px` (이전 Caveat에서 변경)
- 댓글 작성자 `— 닉네임` `Inter 11px` (이전 Caveat에서 변경)
- 남기기 버튼 `Inter 12px 검정 알약` (이전 Caveat 노랑에서 변경)

색·간격 후속:
- 검정 외곽 + 청키 그림자 제거 → soft shadow + 12~14px rounded
- 데모 카드 회전 제거 (postit 기울임 없음)
- 일기 박스의 핑크 테이프 ::before 제거

## Consequences

**긍정**
- 정보 위계 명확 (라벨은 차분, 사용자 글은 감성)
- 한글 깨짐 해결 (Gaegu fallback)
- LG gram x NewJeans 톤과 일관

**부정**
- Caveat 광범위 적용 톤을 좋아했다면 손실감
- 디자인 시스템 토큰 분리가 늦어서 grep 작업 많았음 → ADR 발행 + `docs/design/tokens.md`로 보완

## 영향 파일

- `css/global.css` (`.artist-canvas` 하위 다수, `.listener-attic` 일부)
- `js/app.js` 변경 없음 (CSS-only)

## 후속 작업 권장

- 색·폰트를 CSS 변수로 추출 (`docs/design/tokens.md` 기반)
- 토큰 일관성 검사 스크립트 추가 (선택)
