
-- Referral rewards are now granted ONLY after admin approves a deposit,
-- not immediately at signup. This migration updates handle_new_user to
-- remove the instant $2.50 signup bonus and commission record.

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

  -- Build referral chain (up to 5 levels) - NO reward at signup
  -- Rewards are only granted after the referred user's deposit is approved by an admin
  IF _referrer_user_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.referrals (referrer_id, referred_id, level)
      VALUES (_referrer_user_id, NEW.id, 1);

      INSERT INTO public.referrals (referrer_id, referred_id, level)
      SELECT r.referrer_id, NEW.id, r.level + 1
      FROM public.referrals r
      WHERE r.referred_id = _referrer_user_id
        AND r.level < 5
      ORDER BY r.level;
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
