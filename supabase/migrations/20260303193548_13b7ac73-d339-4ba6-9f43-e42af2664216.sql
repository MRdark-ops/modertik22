
-- Add unique constraint on profiles.user_id so we can FK to it
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);

-- Add FK from deposits.user_id -> profiles.user_id
ALTER TABLE public.deposits 
  ADD CONSTRAINT deposits_user_id_profiles_fkey 
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- Add FK from withdrawals.user_id -> profiles.user_id
ALTER TABLE public.withdrawals 
  ADD CONSTRAINT withdrawals_user_id_profiles_fkey 
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- Add FK from activity_logs.user_id -> profiles.user_id
ALTER TABLE public.activity_logs 
  ADD CONSTRAINT activity_logs_user_id_profiles_fkey 
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- Add FK from referral_commissions.referrer_id -> profiles.user_id
ALTER TABLE public.referral_commissions 
  ADD CONSTRAINT referral_commissions_referrer_id_profiles_fkey 
  FOREIGN KEY (referrer_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
