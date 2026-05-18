---
name: decisions-index
description: Off-Stage 디자인·아키텍처 결정 기록(ADR) 인덱스. 큰 피벗이 일어날 때마다 새 ADR을 추가하여 "왜 이렇게 갔는지"를 영구 보존. 4자리 일련번호 + kebab-case 슬러그 명명 규칙.
---

# Architecture Decision Records (ADR)

## 명명 규칙

`ADR-XXXX-<slug>.md`
- 4자리 번호 (0001~)
- kebab-case 슬러그
- 예: `ADR-0001-trading-cards-over-polaroids.md`

## status 라이프사이클

- `proposed` — 제안 중, 미확정
- `accepted` — 결정됨, 현재 코드 반영
- `superseded` — 새 ADR로 대체됨 (`superseded_by` 필드 필수)
- `rejected` — 검토 후 채택 안 함

## 언제 ADR을 쓰는가

다음 중 하나라도 해당하면 ADR을 남긴다:
- 디자인 톤·레이아웃의 큰 피벗
- 데이터 모델·스키마 변경
- 외부 의존성 추가/교체
- 폰트·색상 시스템 변경

작은 스타일 조정 (예: 패딩 4px → 6px)은 ADR 불필요.

## 인덱스

| 번호 | 제목 | Status | 날짜 |
|------|------|--------|------|
| 0001 | Trading cards over polaroids for STO collection | accepted | 2026-05-11 |
| 0002 | Demo chain: single horizontal line over wrap | accepted | 2026-05-11 |
| 0003 | Master block on LEFT with loop-back arrow | accepted | 2026-05-11 |
| 0004 | Listener page: 4-tab shape navigation | accepted | 2026-05-11 |
| 0005 | LG gram modern fonts for UI + Caveat handwriting for user writing | accepted | 2026-05-12 |
