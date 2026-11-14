-- Principle 4 (B2, B3): money facts are not overwritten.
--
-- A PAID expense's amount, currency and payment state — and any ledger entry's amount,
-- currency, payer and void mark — can only change inside a transaction that set the GUC
-- `ed.correction` to 'on'. Only the correction functions in @ed/core do that, right after
-- writing the `corrections` row, in the same transaction (set_config(..., true) = local).
-- A plain UPDATE from anywhere else is rejected. Idempotent file.

CREATE OR REPLACE FUNCTION ed_correction_active() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('ed.correction', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION ed_expenses_paid_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_state = 'paid' AND NOT ed_correction_active() THEN
      RAISE EXCEPTION 'expenses: a paid expense is a fact and cannot be deleted'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.payment_state = 'paid'
     AND (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
          OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.payment_state IS DISTINCT FROM OLD.payment_state)
     AND NOT ed_correction_active() THEN
    RAISE EXCEPTION 'expenses: amount and payment of a paid expense change only through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_paid_guard ON expenses;
CREATE TRIGGER expenses_paid_guard
  BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION ed_expenses_paid_guard();

CREATE OR REPLACE FUNCTION ed_ledger_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.paid_by_participant_id IS DISTINCT FROM OLD.paid_by_participant_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.voided_at IS DISTINCT FROM OLD.voided_at)
     AND NOT ed_correction_active() THEN
    RAISE EXCEPTION 'ledger_entries: an entry is a fact and changes only through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_guard ON ledger_entries;
CREATE TRIGGER ledger_entries_guard
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ed_ledger_entries_guard();

CREATE OR REPLACE FUNCTION ed_ledger_shares_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ed_correction_active() THEN
    RAISE EXCEPTION 'ledger_shares: shares of an entry are facts and cannot be updated'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_shares_guard ON ledger_shares;
CREATE TRIGGER ledger_shares_guard
  BEFORE UPDATE ON ledger_shares
  FOR EACH ROW EXECUTE FUNCTION ed_ledger_shares_guard();
