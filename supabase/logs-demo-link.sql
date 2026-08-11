-- =====================================================================
-- OFFLOG — 데모 음원에 LOG 담기 (데모의 history)
--
-- 배경: "모든 데모음악에 LOG(history)를 설정할 수 있도록" 요청.
--   사용자가 고른 방식 = 데모마다 직접 골라 담기.
--   데모 음원도 logs 테이블의 한 행(kind='snd')이므로, 로그가 어떤 데모에
--   담겼는지는 같은 테이블을 가리키는 자기참조 컬럼 하나면 충분하다.
--
--   demo_id = 이 로그가 담긴 데모(logs.id). null 이면 어디에도 안 담긴 로그.
--   데모가 지워지면 담김만 풀리고 로그는 남는다(set null).
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

alter table public.logs
  add column if not exists demo_id uuid references public.logs(id) on delete set null;

create index if not exists idx_logs_demo on public.logs(demo_id) where demo_id is not null;

-- 쓰기 권한은 기존 logs UPDATE 정책(본인 로그만)이 그대로 적용된다 — 추가 정책 불필요.
