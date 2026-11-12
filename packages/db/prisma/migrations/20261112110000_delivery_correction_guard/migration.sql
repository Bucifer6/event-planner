-- Principle 4 at the DB level (B6): Delivery.receivedQty changes only via a
-- Correction record. The correction path sets app.correction=true inside its
-- transaction; any other UPDATE of receivedQty is rejected.
CREATE OR REPLACE FUNCTION delivery_receivedqty_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."receivedQty" IS DISTINCT FROM NEW."receivedQty"
     AND coalesce(current_setting('app.correction', true), '') <> 'true' THEN
    RAISE EXCEPTION 'receivedQty changes only via a Correction record (principle 4)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS delivery_received_guard ON "Delivery";
CREATE TRIGGER delivery_received_guard
  BEFORE UPDATE ON "Delivery"
  FOR EACH ROW EXECUTE FUNCTION delivery_receivedqty_guard();
