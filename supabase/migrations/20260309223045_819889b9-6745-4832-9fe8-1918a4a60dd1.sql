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
  -- Get referral code from metadata if provided
  _referral_code := NEW.raw_user_meta_data->>'referral_code';

  -- Look up referrer
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

  -- Assign 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  -- Build referral chain (up to 5 levels)
  IF _referrer_user_id IS NOT NULL THEN
    BEGIN
      -- Level 1: direct referrer
      INSERT INTO public.referrals (referrer_id, referred_id, level)
      VALUES (_referrer_user_id, NEW.id, 1);

      -- Levels 2-5: traverse upward
      INSERT INTO public.referrals (referrer_id, referred_id, level)
      SELECT r.referrer_id, NEW.id, r.level + 1
      FROM public.referrals r
      WHERE r.referred_id = _referrer_user_id
        AND r.level < 5
      ORDER BY r.level;

      -- Flat referral reward: $2.50 for direct referral
      INSERT INTO public.referral_commissions (
        referrer_id,
        referred_id,
        deposit_id,
        level,
        rate,
        commission_amount,
        status
      )
      SELECT _referrer_user_id, NEW.id, NULL, 1, 0, 2.50, 'paid'
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.referral_commissions rc
        WHERE rc.referrer_id = _referrer_user_id
          AND rc.referred_id = NEW.id
          AND rc.level = 1
      );

      UPDATE public.profiles
      SET balance = balance + 2.50
      WHERE user_id = _referrer_user_id;

      INSERT INTO public.activity_logs (user_id, action, details)
      VALUES (
        _referrer_user_id,
        'referral_bonus_awarded',
        jsonb_build_object('referred_user_id', NEW.id, 'amount', 2.50)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Log referral error but don't fail user creation
      RAISE WARNING 'Referral processing failed for user %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  -- Still create a basic profile so signup doesn't fail
  BEGIN
    INSERT INTO public.profiles (user_id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
    ON CONFLICT (user_id) DO NOTHING;
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fallback profile creation also failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;