-- P3 / W2: a decided moderation revision (approved or rejected) is immutable.
-- Idempotent (applied on every db:push / migrate / test database).

CREATE OR REPLACE FUNCTION ed_listing_revisions_decided_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'listing_revisions: a decided revision cannot be changed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listing_revisions_decided_immutable ON listing_revisions;
CREATE TRIGGER listing_revisions_decided_immutable
  BEFORE UPDATE ON listing_revisions
  FOR EACH ROW EXECUTE FUNCTION ed_listing_revisions_decided_immutable();
