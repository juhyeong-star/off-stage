#!/bin/bash
# Double-click this file to deploy off-stage to Vercel.
cd "$(dirname "$0")"

export PATH="/tmp/node-local/bin:/tmp/npm-global/bin:$PATH"

echo ""
echo "====================================="
echo " 🚀 Off-Stage → Vercel 배포"
echo "====================================="
echo ""

if ! command -v vercel &> /dev/null; then
  echo "❌ vercel CLI 없음. 먼저 설치 필요"
  echo "터미널에서: npm i -g vercel"
  read -p "엔터 눌러서 종료"
  exit 1
fi

echo "1) Vercel 로그인 (처음이면 이메일/GitHub 필요)"
vercel login

echo ""
echo "2) 배포 시작..."
vercel --prod --yes

echo ""
echo "✅ 완료! 위에 배포 URL이 나왔어요."
read -p "엔터 눌러서 종료"
