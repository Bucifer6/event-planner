-- SEC10: the audit log is append-only. A trigger blocks UPDATE/DELETE for every role,
-- including PlatformAdmin; in production the app role additionally gets
-- REVOKE UPDATE, DELETE ON "AuditLog" (see 01-architecture.md).
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (SEC10)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON "AuditLog";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
