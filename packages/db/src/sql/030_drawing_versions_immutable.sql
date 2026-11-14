-- P-06 / V4: an approved drawing version never changes — a planner's space model points at
-- exactly one version. Rows may only disappear with their space/listing (cascade).
-- Idempotent (applied on every db:push / migrate / test database).

CREATE OR REPLACE FUNCTION ed_drawing_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'drawing_versions: an approved drawing version cannot be changed'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DO $$
BEGIN
  IF to_regclass('drawing_versions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS drawing_versions_immutable ON drawing_versions;
    CREATE TRIGGER drawing_versions_immutable
      BEFORE UPDATE ON drawing_versions
      FOR EACH ROW EXECUTE FUNCTION ed_drawing_versions_immutable();
  END IF;
END;
$$;
