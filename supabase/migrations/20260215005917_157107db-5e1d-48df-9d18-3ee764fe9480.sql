
-- Fix 1: Remove admin access to TOTP secrets
DROP POLICY IF EXISTS "Admins can view all totp" ON public.user_totp;

-- Fix 2: Add explicit deny INSERT policy on profiles (only trigger can create)
CREATE POLICY "No direct profile creation" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (false);
