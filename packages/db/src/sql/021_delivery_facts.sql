-- B6 / principle 4: received and returned quantities (and a recovered deposit) are facts.
-- The first recording is free; any later change is refused unless the transaction declared a
-- correction (SELECT set_config('ed.correction', 'on', true)) — which @ed/core/deliveries does
-- only together with a corrections row. Idempotent.

CREATE OR REPLACE FUNCTION ed_delivery_item_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('ed.correction', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.received_qty IS NOT NULL AND NEW.received_qty IS DISTINCT FROM OLD.received_qty THEN
    RAISE EXCEPTION 'delivery_items.received_qty is a fact: change it through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.returned_qty IS NOT NULL AND NEW.returned_qty IS DISTINCT FROM OLD.returned_qty THEN
    RAISE EXCEPTION 'delivery_items.returned_qty is a fact: change it through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.deposit_recovered_at IS NOT NULL AND NEW.deposit_recovered_at IS DISTINCT FROM OLD.deposit_recovered_at THEN
    RAISE EXCEPTION 'delivery_items.deposit_recovered_at is a fact: change it through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_items_facts ON delivery_items;
CREATE TRIGGER delivery_items_facts
  BEFORE UPDATE ON delivery_items
  FOR EACH ROW EXECUTE FUNCTION ed_delivery_item_facts();
