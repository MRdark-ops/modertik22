
-- ALL policies are currently RESTRICTIVE (Permissive: No), which means ALL must pass (AND logic).
-- We need PERMISSIVE policies so ANY can pass (OR logic).
-- This is the ROOT CAUSE of the admin being kicked out.

-- ============ user_roles ============
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============ profiles ============
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "No direct profile creation" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "No direct profile creation"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (false);

-- ============ deposits ============
DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Admins can view all deposits" ON public.deposits;
DROP POLICY IF EXISTS "Users can create own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Admins can update deposits" ON public.deposits;

CREATE POLICY "Users can view own deposits"
  ON public.deposits FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all deposits"
  ON public.deposits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can create own deposits"
  ON public.deposits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can update deposits"
  ON public.deposits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============ withdrawals ============
DROP POLICY IF EXISTS "Users can view own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Admins can view all withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Users can create own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Admins can update withdrawals" ON public.withdrawals;

CREATE POLICY "Users can view own withdrawals"
  ON public.withdrawals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all withdrawals"
  ON public.withdrawals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can create own withdrawals"
  ON public.withdrawals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can update withdrawals"
  ON public.withdrawals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============ activity_logs ============
DROP POLICY IF EXISTS "Users can view own logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admins can view all logs" ON public.activity_logs;
DROP POLICY IF EXISTS "No direct log creation" ON public.activity_logs;

CREATE POLICY "Users can view own logs"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all logs"
  ON public.activity_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "No direct log creation"
  ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (false);

-- ============ referrals ============
DROP POLICY IF EXISTS "Users can view own referrals" ON public.referrals;
DROP POLICY IF EXISTS "Admins can view all referrals" ON public.referrals;

CREATE POLICY "Users can view own referrals"
  ON public.referrals FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

CREATE POLICY "Admins can view all referrals"
  ON public.referrals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============ referral_commissions ============
DROP POLICY IF EXISTS "Users can view own commissions" ON public.referral_commissions;
DROP POLICY IF EXISTS "Admins can view all commissions" ON public.referral_commissions;

CREATE POLICY "Users can view own commissions"
  ON public.referral_commissions FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id);

CREATE POLICY "Admins can view all commissions"
  ON public.referral_commissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============ user_totp ============
DROP POLICY IF EXISTS "Users can insert own totp" ON public.user_totp;
DROP POLICY IF EXISTS "Users can update own totp" ON public.user_totp;

CREATE POLICY "Users can insert own totp"
  ON public.user_totp FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own totp"
  ON public.user_totp FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
