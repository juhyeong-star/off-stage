---
name: off-stage-claude-rules
description: Off-Stage 레포에서 Claude(또는 다른 AI 에이전트)가 코드 작업을 시작하기 전 자동으로 읽고 따라야 하는 운영 규칙. 캐시 버스팅 6곳 동기화, Vercel CLI 배포, 손글씨 vs 모던 폰트 룰, 현재 단계에서의 금기 사항을 정의.
---

# CLAUDE.md — Off-Stage 운영 규칙

> 이 파일은 모든 작업 전에 자동으로 읽힌다. 규칙은 선택이 아니라 필수.

---

## 0. 프로젝트 정체성 (3줄)

- Off-Stage = K-인디 음악 STO(Security Token Offering) 플랫폼 MVP.
- 스택: 순수 HTML/CSS/JS + Supabase + Vercel (no-build, no-bundler).
- 단계: UI 디자인 빠른 반복. 빌드 도구·테스트 인프라 도입은 디자인 안정 후로 보류.

---

## 1. 캐시 버스팅 — 변경 후 반드시 6곳 동기화

`index.html`에 `?v=N` 6곳:

```
css/global.css?v=N
js/supabase-init.js?v=N
js/data.js?v=N
js/supabase.js?v=N
js/app.js?v=N
js/polaroid.js?v=N
```

**한 곳이라도 N 불일치 → 사용자 브라우저가 옛 파일 로드 → 디자인 깨짐.**

`bash scripts/check.sh` 실행으로 검증.

---

## 2. 배포 — Vercel CLI

```bash
PATH="$HOME/.offstage-tools/node-v20.18.0-darwin-x64/bin:$PATH" \
  $HOME/.offstage-tools/npm-global/bin/vercel \
  --token="vcp_1t0sKjW1WS20tlwIobmXhCvnstLtgO0uAUWExpFcYmHXTGjmld0taKOX" \
  --scope="yjazzboy-7321s-projects" \
  --prod --yes /Users/lemon/Desktop/off-stage
```

배포 후 검증:
```bash
curl -s https://off-stage-weld.vercel.app/ | grep -o "v=[0-9]*" | head -3
```

세 결과 모두 동일한 새 버전이어야 통과.

---

## 3. 디자인 톤 룰 (현재 합의)

- **시스템 UI 텍스트** (라벨, 헤딩, 버튼, 데이터 카드) → Inter / Archivo Black / Bebas Neue
- **사용자 글** (일기 본문, 댓글, 메모, 입력창 typing) → **Caveat + Gaegu** (한글 fallback)
- 색상 토큰은 `docs/design/tokens.md` 참조
- 큰 디자인 피벗은 `docs/decisions/`에 ADR로 기록

---

## 4. 작업 전 체크리스트 (UI 변경 작업)

1. 사용자 요청 명확화 (모호하면 멈추고 질문)
2. CSS/JS 수정
3. `index.html`에서 `?v=N` 6곳 모두 bump
4. `bash scripts/check.sh` 통과 확인
5. Vercel 배포
6. `curl` 으로 라이브 버전 확인
7. 큰 결정이면 `docs/decisions/ADR-XXXX.md` 추가

---

## 5. 절대 금지 (현재 단계)

- ❌ **package.json / npm 의존성 추가** — no-build 유지
- ❌ **vitest / eslint / 빌드 도구 도입** — 디자인 안정 후로 보류
- ❌ **5곳만 bump 하고 1곳 빠뜨림** — 캐시 미스매치 즉시 발생
- ❌ **사용자 글 영역에 시스템 폰트** — 손글씨 톤 유지
- ❌ **시스템 라벨에 Caveat** — 한글 깨짐 + 가독성 저하
- ❌ **큰 리팩토링** (예: app.js 분할) — 사용자가 명시 요청 시에만

---

## 6. 어디서 뭘 찾는가

- 디자인 결정 이력 → `docs/decisions/`
- 색상·폰트 토큰 → `docs/design/tokens.md`
- DB 스키마 → `supabase/schema.sql`
- 검증 스크립트 → `scripts/check.sh`

---

## 7. 막혔을 때

- 추측 금지. 모르면 멈추고 사용자에게 질문.
- 같은 실수를 두 번 했으면 이 파일에 영구 규칙으로 추가.
