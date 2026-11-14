-- RELEASE E.
-- (1) E-02 / principle 4: an arrival is a fact. The first recording is free; any later change
--     of the counts, the time or the "un-check" mark is refused unless the transaction declared
--     a correction (set_config('ed.correction','on',true)) — which @ed/core/checkin does only
--     together with a corrections row. Rows are deleted only while an occasion is purged
--     (ed.purge) or by the household/occasion cascade of such a purge.
-- (2) E-03: every insert / change of a checklist item bumps its revision, so an offline tick
--     can tell whether the item changed on the server after the device captured it.
-- Idempotent.
CREATE OR REPLACE FUNCTION ed_check_in_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('ed.purge', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    -- the household itself was removed (guest list change): its arrival row follows it
    IF NOT EXISTS (SELECT 1 FROM households h WHERE h.id = OLD.household_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'check_ins rows are facts: un-check through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF coalesce(current_setting('ed.correction', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.adults_arrived IS DISTINCT FROM OLD.adults_arrived
     OR NEW.children_arrived IS DISTINCT FROM OLD.children_arrived
     OR NEW.arrived_at IS DISTINCT FROM OLD.arrived_at
     OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.occasion_id IS DISTINCT FROM OLD.occasion_id THEN
    RAISE EXCEPTION 'check_ins is a fact table: change it through a correction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_ins_facts ON check_ins;
CREATE TRIGGER check_ins_facts
  BEFORE UPDATE OR DELETE ON check_ins
  FOR EACH ROW EXECUTE FUNCTION ed_check_in_facts();

CREATE OR REPLACE FUNCTION ed_check_item_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.done IS NOT DISTINCT FROM OLD.done AND NEW.label IS NOT DISTINCT FROM OLD.label THEN
    RETURN NEW;
  END IF;
  INSERT INTO check_item_revisions (item_id, revision, changed_at)
  VALUES (NEW.id, 1, now())
  ON CONFLICT (item_id) DO UPDATE SET revision = check_item_revisions.revision + 1, changed_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_check_items_revision ON task_check_items;
CREATE TRIGGER task_check_items_revision
  AFTER INSERT OR UPDATE ON task_check_items
  FOR EACH ROW EXECUTE FUNCTION ed_check_item_revision();
