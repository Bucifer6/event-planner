-- B8: readiness decisions are a record of who decided what, on which evidence. Append-only;
-- rows go only when the occasion itself is purged (ed.purge, see 020_suppliers_guards.sql).
-- Idempotent.

CREATE OR REPLACE FUNCTION ed_readiness_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('ed.purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'readiness_decisions is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS readiness_decisions_append_only ON readiness_decisions;
CREATE TRIGGER readiness_decisions_append_only
  BEFORE UPDATE OR DELETE ON readiness_decisions
  FOR EACH ROW EXECUTE FUNCTION ed_readiness_append_only();
