-- Verification & fix migration:
-- 1. Ensures handle_new_user does NOT give signup bonus
-- 2. Fixes referrals table UNIQUE constraint to allow multi-level tracking
-- 3. Safe to run multiple times (idempotent)

-- ── Step 1: Remove UNIQUE constraint on referrals.referred_id ─────────────
-- The original schema has referred_id UNIQUE which prevents multi-level chain
-- storage (e.g. UserC can only appear once in referrals table).
-- We replace it with a composite unique (referrer_id, referred_id).

DO $$
BEGIN
  -- Drop old UNIQUE constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'referrals'
      AND constraint_type = 'UNIQUE'
      AND constraint_name NOT LIKE '%referrer%'
  ) THEN
    -- Find and drop the constraint by name
    DECLARE
      v_constraint_name TEXT;
    BEGIN
      SELECT constraint_name INTO v_constraint_name
      FROM information_schema.key_column_usage
      WHERE table_schema = 'public'
        AND table_name   = 'referrals'
        AND column_name  = 'referred_id'
        AND position_in_unique_constraint IS NULL;

      IF v_constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS ' || quote_ident(v_constraint_name);
      END IF;
    END;
  END IF;
END $$;

-- Add composite unique so the same pair (referrer, referred) can't duplicate
ALTER TABLE public.referrals
  DROP CONSTRAINT IF EXISTS referrals_referrer_referred_unique;

ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_referrer_referred_unique
  UNIQUE (referrer_id, referred_id);

-- ── Step 2: Confirm handle_new_user gives NO signup bonus ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _referral_code TEXT;
  _referrer_user_id UUID;
BEGIN
  _referral_code := NEW.raw_user_meta_data->>'referral_code';

  IF _referral_code IS NOT NULL AND _referral_code != '' THEN
    SELECT user_id INTO _referrer_user_id
    FROM public.profiles
    WHERE referral_code = _referral_code;

    IF _referrer_user_id = NEW.id THEN
      _referrer_user_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.profiles (user_id, full_name, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    _referrer_user_id
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  -- Build referral chain (up to 5 levels) — NO money at signup.
  -- Rewards are granted ONLY when admin approves the user's deposit.
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
