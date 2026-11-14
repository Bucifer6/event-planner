-- Principle 4: corrections are the history of changed facts; the history itself is append-only.
-- Idempotent (applied on every push/migrate/test run).

CREATE OR REPLACE FUNCTION ed_corrections_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'corrections is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS corrections_append_only ON corrections;
CREATE TRIGGER corrections_append_only
  BEFORE UPDATE OR DELETE ON corrections
  FOR EACH ROW EXECUTE FUNCTION ed_corrections_append_only();

DROP TRIGGER IF EXISTS corrections_no_truncate ON corrections;
CREATE TRIGGER corrections_no_truncate
  BEFORE TRUNCATE ON corrections
  FOR EACH STATEMENT EXECUTE FUNCTION ed_corrections_append_only();
