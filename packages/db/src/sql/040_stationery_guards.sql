-- Release C: stationery, print pack and arrangement designer guards.
-- Idempotent (applied on every db:push / migrate / test database).

-- C-09: the printed-QR identifier of an invitation is unique (and looked up on every scan).
DO $$
BEGIN
  IF to_regclass('invitations') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS invitations_qr_id_uq ON invitations (qr_id) WHERE qr_id IS NOT NULL;
  END IF;
END;
$$;

-- C-04: a saved stationery version never changes; the only write allowed is the proof mark,
-- set once ("Am verificat proba"). Anything else is a new version.
CREATE OR REPLACE FUNCTION ed_stationery_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.occasion_id IS DISTINCT FROM OLD.occasion_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.design_key IS DISTINCT FROM OLD.design_key
     OR NEW.colourway_key IS DISTINCT FROM OLD.colourway_key
     OR NEW.locale IS DISTINCT FROM OLD.locale
     OR NEW.texts IS DISTINCT FROM OLD.texts
     OR NEW.qr_on_invitation IS DISTINCT FROM OLD.qr_on_invitation
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'stationery_versions: a saved version cannot be changed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.proofed_at IS NOT NULL AND NEW.proofed_at IS DISTINCT FROM OLD.proofed_at THEN
    RAISE EXCEPTION 'stationery_versions: a proof mark cannot be changed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('stationery_versions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS stationery_versions_guard ON stationery_versions;
    CREATE TRIGGER stationery_versions_guard
      BEFORE UPDATE ON stationery_versions
      FOR EACH ROW EXECUTE FUNCTION ed_stationery_versions_guard();
  END IF;
END;
$$;

-- C-13: a saved arrangement version never changes (account removal may only clear its author).
CREATE OR REPLACE FUNCTION ed_arrangement_versions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.design_id IS DISTINCT FROM OLD.design_id
     OR NEW.occasion_id IS DISTINCT FROM OLD.occasion_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.form IS DISTINCT FROM OLD.form
     OR NEW.lines IS DISTINCT FROM OLD.lines
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'arrangement_versions: a saved design version cannot be changed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('arrangement_versions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS arrangement_versions_immutable ON arrangement_versions;
    CREATE TRIGGER arrangement_versions_immutable
      BEFORE UPDATE ON arrangement_versions
      FOR EACH ROW EXECUTE FUNCTION ed_arrangement_versions_immutable();
  END IF;
END;
$$;
