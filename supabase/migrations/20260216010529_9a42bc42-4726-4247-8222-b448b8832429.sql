
-- Fix 1: Remove user SELECT policy on user_totp (TOTP secrets must NEVER be readable client-side)
DROP POLICY IF EXISTS "Users can view own totp" ON public.user_totp;

-- Fix 2: Block direct INSERT on activity_logs (only service role / edge functions should create logs)
-- First drop any existing INSERT policy
DROP POLICY IF EXISTS "Users can insert own logs" ON public.activity_logs;
DROP POLICY IF EXISTS "No direct log creation" ON public.activity_logs;

CREATE POLICY "No direct log creation"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
