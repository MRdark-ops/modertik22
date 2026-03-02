-- Add non-negative balance constraint
ALTER TABLE public.profiles ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);

-- Create atomic withdrawal function with row locking
CREATE OR REPLACE FUNCTION public.create_withdrawal(
  p_amount DECIMAL,
  p_wallet_address TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current_balance DECIMAL;
  v_withdrawal_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount < 50 OR p_amount > 10000 THEN
    RAISE EXCEPTION 'Amount must be between $50 and $10,000';
  END IF;

  -- Lock the profile row to prevent concurrent withdrawals
  SELECT balance INTO v_current_balance
  FROM profiles
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Atomically deduct balance
  UPDATE profiles
  SET balance = balance - p_amount
  WHERE user_id = v_user_id;

  -- Create withdrawal record
  INSERT INTO withdrawals (user_id, amount, wallet_address, status)
  VALUES (v_user_id, p_amount, p_wallet_address, 'pending')
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;