-- B4 / B5 / B12: immutable briefing versions and final-order snapshots, post-snapshot deltas,
-- and the "paid" fact of a payment deadline. Idempotent (applied on every push/migrate/test run).
--
-- Two transaction-local settings open the guards, both set only by @ed/core:
--   ed.purge      = 'on'  the occasion is being purged (onOccasionPurge) — rows may be deleted
--   ed.correction = 'on'  a corrections row is written in this same transaction

CREATE OR REPLACE FUNCTION ed_immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('ed.purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is immutable: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS briefing_versions_immutable ON briefing_versions;
CREATE TRIGGER briefing_versions_immutable
  BEFORE UPDATE OR DELETE ON briefing_versions
  FOR EACH ROW EXECUTE FUNCTION ed_immutable_row();

DROP TRIGGER IF EXISTS order_snapshots_immutable ON order_snapshots;
CREATE TRIGGER order_snapshots_immutable
  BEFORE UPDATE OR DELETE ON order_snapshots
  FOR EACH ROW EXECUTE FUNCTION ed_immutable_row();

-- An acknowledgement is stored once and never rewritten.
DROP TRIGGER IF EXISTS briefing_acks_immutable ON briefing_acks;
CREATE TRIGGER briefing_acks_immutable
  BEFORE UPDATE OR DELETE ON briefing_acks
  FOR EACH ROW EXECUTE FUNCTION ed_immutable_row();

-- B5: a guest answer that changes AFTER a final order exists becomes a visible delta row for
-- every booking that has a snapshot — the agreed order itself is never touched.
CREATE OR REPLACE FUNCTION ed_order_delta_on_rsvp() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b_adults integer := 0;
  b_children integer := 0;
  a_adults integer := 0;
  a_children integer := 0;
  occ text;
  hh text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    occ := OLD.occasion_id; hh := OLD.household_id;
  ELSE
    occ := NEW.occasion_id; hh := NEW.household_id;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    IF OLD.attending = 'yes' THEN b_adults := OLD.adults_count; b_children := OLD.children_count; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.attending = 'yes' THEN a_adults := NEW.adults_count; a_children := NEW.children_count; END IF;
  END IF;
  IF b_adults = a_adults AND b_children = a_children THEN
    RETURN NULL;
  END IF;
  INSERT INTO order_deltas
    (id, booking_id, occasion_id, snapshot_id, household_id, before, after, created_at)
  SELECT 'od' || replace(gen_random_uuid()::text, '-', ''), s.booking_id, s.occasion_id, s.id, hh,
         jsonb_build_object('adults', b_adults, 'children', b_children),
         jsonb_build_object('adults', a_adults, 'children', a_children), now()
  FROM order_snapshots s
  JOIN bookings b ON b.id = s.booking_id
  WHERE s.occasion_id = occ
    AND b.state <> 'cancelled'
    AND s.version = (SELECT max(x.version) FROM order_snapshots x WHERE x.booking_id = s.booking_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rsvp_responses_order_delta ON rsvp_responses;
CREATE TRIGGER rsvp_responses_order_delta
  AFTER INSERT OR UPDATE OR DELETE ON rsvp_responses
  FOR EACH ROW EXECUTE FUNCTION ed_order_delta_on_rsvp();

-- A delta row is a record of what happened: only its "folded into snapshot" mark may be set.
CREATE OR REPLACE FUNCTION ed_order_delta_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('ed.purge', true), '') = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'order_deltas rows cannot be deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.before IS DISTINCT FROM OLD.before
     OR NEW.after IS DISTINCT FROM OLD.after
     OR OLD.folded_into_snapshot_id IS NOT NULL THEN
    RAISE EXCEPTION 'order_deltas rows are a record: only folding an open delta is allowed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_deltas_guard ON order_deltas;
CREATE TRIGGER order_deltas_guard
  BEFORE UPDATE OR DELETE ON order_deltas
  FOR EACH ROW EXECUTE FUNCTION ed_order_delta_guard();

-- B12 / principle 4: "paid" is a fact. Marking a deadline paid is free; changing or clearing
-- it afterwards needs a correction in the same transaction.
CREATE OR REPLACE FUNCTION ed_payment_paid_fact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.paid_at IS NOT NULL
     AND NEW.paid_at IS DISTINCT FROM OLD.paid_at
     AND coalesce(current_setting('ed.correction', true), '') <> 'on' THEN
    RAISE EXCEPTION 'payment_deadlines.paid_at is a fact: change it through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_deadlines_paid_fact ON payment_deadlines;
CREATE TRIGGER payment_deadlines_paid_fact
  BEFORE UPDATE ON payment_deadlines
  FOR EACH ROW EXECUTE FUNCTION ed_payment_paid_fact();
