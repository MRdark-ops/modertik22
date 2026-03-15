
ALTER TABLE public.withdrawals DROP CONSTRAINT withdrawals_amount_check;
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_amount_check CHECK (amount >= 2.50 AND amount <= 10000);

ALTER TABLE public.withdrawals DROP CONSTRAINT withdrawals_status_check;
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'in_progress', 'completed'));
