-- ============================================================
-- APPLY THIS SQL IN: Supabase Dashboard → SQL Editor
-- ============================================================
-- Purpose: Guarantee that referral rewards (direct $2.50 and
--          indirect tiered) are ONLY granted after an admin
--          approves the referred user's deposit request.
--
-- This migration:
--   1. Removes UNIQUE constraint on referrals.referred_id
--      (it blocked multi-level chain storage)
--   2. Adds a composite UNIQUE (referrer_id, referred_id) instead
--   3. Rewrites handle_new_user to give NO signup bonus
--   4. Voids any existing signup bonuses (deposit_id IS NULL)
--      and corrects referrer balances accordingly
-- ============================================================


-- ── 1. Fix referrals table: allow multi-level chain ──────────────────────────

-- Drop old single-column UNIQUE on referred_id if it exists
DO $$
DECLARE
  v_con TEXT;
BEGIN
  SELECT kcu.constraint_name INTO v_con
  FROM information_schema.key_column_usage kcu
  JOIN information_schema.table_constraints tc
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
   AND tc.table_name      = kcu.table_name
  WHERE kcu.table_schema  = 'public'
    AND kcu.table_name    = 'referrals'
    AND kcu.column_name   = 'referred_id'
    AND tc.constraint_type = 'UNIQUE'
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.key_column_usage kcu2
      WHERE kcu2.constraint_name = kcu.constraint_name
        AND kcu2.column_name     = 'referrer_id'
    )
  LIMIT 1;

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.referrals DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

-- Add composite unique so the same (referrer, referred) pair can't duplicate
ALTER TABLE public.referrals
  DROP CONSTRAINT IF EXISTS referrals_referrer_referred_unique;

ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_referrer_referred_unique
  UNIQUE (referrer_id, referred_id);


-- ── 2. Rewrite handle_new_user — zero bonus at signup ────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _referral_code    TEXT;
  _referrer_user_id UUID;
BEGIN
  _referral_code := NEW.raw_user_meta_data->>'referral_code';

  IF _referral_code IS NOT NULL AND _referral_code != '' THEN
    SELECT user_id INTO _referrer_user_id
    FROM public.profiles
    WHERE referral_code = _referral_code;

    -- Prevent self-referral
    IF _referrer_user_id = NEW.id THEN
      _referrer_user_id := NULL;
    END IF;
  END IF;

  -- Create profile
  INSERT INTO public.profiles (user_id, full_name, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    _referrer_user_id
  );

  -- Assign default role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  -- Build referral chain up to 5 levels — NO MONEY at signup.
  -- Referral rewards are granted ONLY when an admin approves the
  -- referred user's first deposit (handled in approve-deposit function).
  IF _referrer_user_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.referrals (referrer_id, referred_id, level)
      VALUES (_referrer_user_id, NEW.id, 1)
      ON CONFLICT (referrer_id, referred_id) DO NOTHING;

      INSERT INTO public.referrals (referrer_id, referred_id, level)
      SELECT r.referrer_id, NEW.id, r.level + 1
      FROM public.referrals r
      WHERE r.referred_id = _referrer_user_id
        AND r.level < 5
      ORDER BY r.level
      ON CONFLICT (referrer_id, referred_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Referral chain failed for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  BEGIN
    INSERT INTO public.profiles (user_id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fallback also failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;


-- ── 3. Void existing signup bonuses (deposit_id IS NULL) ─────────────────────
-- For every commission row that was incorrectly inserted at signup
-- (identifiable because deposit_id IS NULL), we:
--   a. Deduct the amount from the referrer's balance (floor at 0)
--   b. Delete the erroneous commission row
-- The correct commission will be created by approve-deposit when the
-- admin approves the referred user's first deposit.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT rc.id, rc.referrer_id, rc.commission_amount
    FROM public.referral_commissions rc
    WHERE rc.deposit_id IS NULL
      AND rc.status     = 'paid'
  LOOP
    -- Deduct signup bonus from referrer balance
    UPDATE public.profiles
    SET balance = GREATEST(0, balance - rec.commission_amount)
    WHERE user_id = rec.referrer_id;

    -- Log the void
    INSERT INTO public.activity_logs (user_id, action, details)
    VALUES (
      rec.referrer_id,
      'referral_signup_bonus_voided',
      jsonb_build_object(
        'commission_id', rec.id,
        'voided_amount', rec.commission_amount,
        'reason', 'Signup bonus removed; reward now granted only on deposit approval'
      )
    );

    -- Delete the erroneous commission
    DELETE FROM public.referral_commissions WHERE id = rec.id;
  END LOOP;
END $$;
