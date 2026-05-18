---
name: design-tokens
description: Off-Stage UI 디자인 토큰 카탈로그. 색상(잉크·노트·마스터·Y2K 팔레트), 폰트(시스템 모던 vs 사용자 손글씨), 그림자·라운드·스페이싱 표준. CSS 변수로 추출되어 있지 않아 grep 키워드로 참조. 신규 컴포넌트 작성 전 이 문서 확인 필수.
---

# Design Tokens

> **현재 상태**: CSS 변수로 추출되지 않음. `global.css`에 하드코딩. 이 문서는 grep 가능한 카탈로그.
> 향후 CSS 변수화 작업 시 이 문서를 truth source로 사용.

---

## 1. 색상

### 1.1 잉크 / 텍스트
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--ink-black` | `#111` | 본문, 헤딩, 테두리, 청키 그림자 |
| `--ink-secondary` | `rgba(0,0,0,0.6)` | 메타 텍스트, 보조 라벨 |
| `--ink-muted` | `rgba(0,0,0,0.4)` | 비활성, 플레이스홀더 |
| `--ink-white` | `#fff` | 다크 배경 위 텍스트 |

### 1.2 노트 / 포스트잇 (사용자 글 영역)
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--note-yellow` | `#FFE066` | 일기 박스, 노란 데모 카드, 댓글 칩 |
| `--note-yellow-light` | `#FFF6CC` | 노란 그라데이션 상단 |
| `--note-yellow-deep` | `#FFD040` | 노란 그라데이션 하단 |
| `--note-pink-bg` | `#FFC8DC → #FFB0CC` | LG gram 핑크 카드 |
| `--note-cyan-bg` | `#C8EAFF → #8FCFF0` | LG gram 사이안 카드 |
| `--note-mint-bg` | `#C5F0D4 → #8FE2A8` | LG gram 민트 카드 |
| `--note-lilac-bg` | `#E0D0FF → #C0A5F0` | (선택) 보조 컬러 |

### 1.3 마스터 / 시그니쳐
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--master-mint` | `#6EE5A8` | "MASTER" 배지, 회귀 화살표, 민트 알약 |

### 1.4 Y2K NewJeans 팔레트 (청취자 탭 도형)
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--y2k-pink-hot` | `#FF4D90` | ▲ 투자 탭 도형, 핫핑크 글로우 |
| `--y2k-cyan-sky` | `#5EC7F0` | ● 즐겨듣기 탭 도형 |
| `--y2k-yellow` | `#FFD740` | ■ 포스트잇 탭 도형 |
| `--y2k-lime` | `#6FCC42` | ◆ 데이터 탭 도형 |
| `--y2k-bg-deep` | `#2B3E91 → #4A5FC7 → #6B7AD7 → #8B9DE3` | 청취자 페이지 딥블루 배경 |
| `--y2k-glow-pink` | `rgba(255, 100, 180, 0.45)` | 좌상단 핑크 글로우 |
| `--y2k-glow-cyan` | `rgba(100, 220, 255, 0.45)` | 우상단 사이안 글로우 |

### 1.5 브랜드 / 강조
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--brand-purple` | `#6B46C1` | 화살표 ㄴ, 메타 텍스트 |
| `--bg-purple` | `linear-gradient(180deg, #B9A5F0 0%, #C8B8F5 60%, #D4C5F7 100%)` | 아티스트 페이지 라일락 배경 |

---

## 2. 폰트 (역할별 분리 — ADR-0005)

### 2.1 시스템 폰트 (라벨·헤딩·버튼·데이터)
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

추가 강조용:
- **제목·임팩트**: `'Archivo Black', 'Inter', sans-serif`
- **라벨 uppercase**: `'Bebas Neue', 'Inter', sans-serif`

### 2.2 사용자 글 폰트 (감성·개인성)
```css
font-family: 'Caveat', 'Gaegu', 'Inter', cursive;
```

- **영문/숫자**: Caveat (라틴 손글씨)
- **한글**: Gaegu (한글 손글씨 fallback)
- 둘 다 Google Fonts로 로드 (`index.html` 헤더)

### 2.3 폰트 사이즈 스케일
| 토큰 | px | 용도 |
|------|-----|------|
| `--text-xs` | 10 | 메타, 작은 라벨 |
| `--text-sm` | 12 | 보조 텍스트 |
| `--text-base` | 14 | 본문 |
| `--text-md` | 16 | 헤딩 small |
| `--text-lg` | 22 | 손글씨 본문 |
| `--text-xl` | 32 | 큰 숫자 (데이터 카드) |
| `--text-2xl` | 44 | 청취자 "My.Page" 타이틀 |

---

## 3. 그림자

### 3.1 청키 (기존 아티스트 페이지)
```css
box-shadow: 4px 4px 0 #111;   /* 데모 카드 hover */
box-shadow: 5px 5px 0 #111;   /* 프로젝트 박스 */
```
- ADR-0005에서 사용자 글 영역은 soft shadow로 전환 중

### 3.2 Soft (LG gram 톤)
```css
box-shadow: 0 4px 12px rgba(0,0,0,0.12);   /* 카드 기본 */
box-shadow: 0 6px 18px rgba(0,0,0,0.18);   /* hover */
box-shadow: 0 10px 22px rgba(0,0,0,0.20);  /* 강조 카드 */
```

### 3.3 Glow (Y2K active state)
```css
box-shadow: 0 0 24px rgba(255, 100, 200, 0.7), 0 0 40px rgba(255, 100, 200, 0.45);
filter: drop-shadow(0 0 18px rgba(255, 77, 144, 0.95)) drop-shadow(0 0 32px rgba(255, 77, 144, 0.7));
```

---

## 4. 모서리 라운드

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--radius-sm` | 2px | 청키 톤 카드 (postit) |
| `--radius-md` | 12px | LG gram 데모 카드 |
| `--radius-lg` | 14px | LG gram 큰 카드, 일기 박스 |
| `--radius-pill` | 999px | 알약 버튼, 칩 |
| `--radius-circle` | 50% | 아바타, 동그란 버튼 |

---

## 5. 스페이싱 (참고)

| 토큰 | px |
|------|-----|
| `--gap-xs` | 4 |
| `--gap-sm` | 8 |
| `--gap-md` | 14 |
| `--gap-lg` | 20 |
| `--gap-xl` | 28 |
| `--gap-2xl` | 40 |

---

## 6. 사용 권장

신규 컴포넌트 작성 시:
1. 이 문서에서 가장 가까운 토큰 찾아 그 값 사용
2. 새 값이 필요하면 토큰 추가 (PR 본문에 명시)
3. 폰트 결정 시 ADR-0005 룰 따름 (사용자 글 / 시스템)

향후 작업:
- [ ] CSS 변수로 추출 (`:root { --note-yellow: #FFE066; }` 등)
- [ ] 토큰 미사용 색·하드코딩 grep 헬퍼 스크립트
- [ ] Storybook 같은 토큰 시각화 (현재 단계엔 과잉)
