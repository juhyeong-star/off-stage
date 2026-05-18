#!/usr/bin/env bash
# check.sh — Off-Stage 최소 검증 스크립트
#
# 실행 시점:
#   1. CSS/JS 수정 후 index.html 의 ?v=N 업데이트 직후
#   2. Vercel 배포 전
#   3. 배포 후 라이브 확인
#
# 항목:
#   1. index.html 의 ?v=N 6곳이 모두 동일한가
#   2. css/global.css 가 10K 줄 넘었는가 (경고)
#   3. js/app.js 가 7K 줄 넘었는가 (경고)
#   4. (옵션) --live: 라이브 사이트의 v=N 이 로컬과 같은가
#
# 사용:
#   bash scripts/check.sh             # 로컬 검증만
#   bash scripts/check.sh --live      # 라이브 비교 포함
#
# 종료 코드:
#   0 = 통과
#   1 = ?v=N 미스매치 (치명)
#   2 = 파일 크기 과대 (경고만, 통과는 함)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="$ROOT/index.html"
CSS="$ROOT/css/global.css"
APP="$ROOT/js/app.js"

FATAL=0
WARN=0

echo "── Off-Stage check.sh ──"

# 1. ?v=N sync check
echo ""
echo "[1] index.html ?v=N 동기화 (6곳 기대)"
VERSIONS=$(grep -oE "\?v=[0-9]+" "$INDEX" | sort -u)
COUNT_LINES=$(grep -cE "\?v=[0-9]+" "$INDEX")
UNIQUE_COUNT=$(echo "$VERSIONS" | wc -l | tr -d ' ')

if [ "$COUNT_LINES" -ne 6 ]; then
  echo "  ❌ index.html 의 ?v=N 라인 개수가 6이 아님 (실제: $COUNT_LINES)"
  echo "     css 1개 + js 5개 = 6 이어야 함"
  FATAL=1
fi

if [ "$UNIQUE_COUNT" -eq 1 ]; then
  CURRENT=$(echo "$VERSIONS" | tr -d '?')
  echo "  ✅ 모든 ?v 일치: $CURRENT"
else
  echo "  ❌ ?v=N 미스매치 ($UNIQUE_COUNT 종류 발견):"
  echo "$VERSIONS" | sed 's/^/     /'
  FATAL=1
fi

# 2. CSS size warning
echo ""
echo "[2] css/global.css 크기 점검 (한도 10000줄)"
if [ -f "$CSS" ]; then
  CSS_LINES=$(wc -l < "$CSS" | tr -d ' ')
  if [ "$CSS_LINES" -gt 10000 ]; then
    echo "  ⚠️  $CSS_LINES 줄 — 한도 초과. 분할 검토."
    WARN=1
  elif [ "$CSS_LINES" -gt 8000 ]; then
    echo "  ⚠️  $CSS_LINES 줄 — 80% 도달. 한도 임박."
    WARN=1
  else
    echo "  ✅ $CSS_LINES 줄"
  fi
else
  echo "  ❌ css/global.css 없음"
  FATAL=1
fi

# 3. JS size warning
echo ""
echo "[3] js/app.js 크기 점검 (한도 7000줄)"
if [ -f "$APP" ]; then
  APP_LINES=$(wc -l < "$APP" | tr -d ' ')
  if [ "$APP_LINES" -gt 7000 ]; then
    echo "  ⚠️  $APP_LINES 줄 — 한도 초과. 모듈 분리 검토."
    WARN=1
  elif [ "$APP_LINES" -gt 6000 ]; then
    echo "  ⚠️  $APP_LINES 줄 — 80% 도달. 한도 임박."
    WARN=1
  else
    echo "  ✅ $APP_LINES 줄"
  fi
else
  echo "  ❌ js/app.js 없음"
  FATAL=1
fi

# 4. (Optional) live deploy check
if [ "${1:-}" = "--live" ]; then
  echo ""
  echo "[4] 라이브 사이트 ?v=N 확인"
  LIVE_VS=$(curl -s --max-time 10 "https://off-stage-weld.vercel.app/" 2>/dev/null | grep -oE "v=[0-9]+" | sort -u)
  if [ -z "$LIVE_VS" ]; then
    echo "  ❌ 라이브 페이지 fetch 실패"
    FATAL=1
  else
    LIVE_UNIQUE=$(echo "$LIVE_VS" | wc -l | tr -d ' ')
    if [ "$LIVE_UNIQUE" -ne 1 ]; then
      echo "  ❌ 라이브에 ?v=N 미스매치:"
      echo "$LIVE_VS" | sed 's/^/     /'
      FATAL=1
    else
      LIVE_V=$(echo "$LIVE_VS" | tr -d 'v=')
      LOCAL_V=$(echo "$VERSIONS" | head -1 | tr -d '?v=')
      if [ "$LIVE_V" = "$LOCAL_V" ]; then
        echo "  ✅ 라이브 v=$LIVE_V (로컬과 동일)"
      else
        echo "  ⚠️  로컬 v=$LOCAL_V vs 라이브 v=$LIVE_V (배포 안 됨)"
        WARN=1
      fi
    fi
  fi
fi

# Summary
echo ""
echo "── 요약 ──"
if [ "$FATAL" -ne 0 ]; then
  echo "❌ 치명 오류 있음. 배포 금지."
  exit 1
elif [ "$WARN" -ne 0 ]; then
  echo "⚠️  경고 있음 (배포는 가능)"
  exit 2
else
  echo "✅ 모든 검사 통과"
  exit 0
fi
