-- AURELIS Multi-Tenant & Site-Scoped Row Level Security Policies
-- Supports BOTH local PostgreSQL session claims (app.current_tenant_id) AND Supabase JWT claims (auth.jwt()).

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
DECLARE
  local_val TEXT;
  jwt_val TEXT;
BEGIN
  local_val := NULLIF(current_setting('app.current_tenant_id', true), '');
  IF local_val IS NOT NULL THEN
    RETURN local_val::UUID;
  END IF;
  BEGIN
    jwt_val := NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '');
    RETURN jwt_val::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_operator_id()
RETURNS UUID AS $$
DECLARE
  local_val TEXT;
  jwt_val TEXT;
BEGIN
  local_val := NULLIF(current_setting('app.current_operator_id', true), '');
  IF local_val IS NOT NULL THEN
    RETURN local_val::UUID;
  END IF;
  BEGIN
    jwt_val := NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '');
    RETURN jwt_val::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION current_operator_role()
RETURNS TEXT AS $$
DECLARE
  local_val TEXT;
BEGIN
  local_val := NULLIF(current_setting('app.current_operator_role', true), '');
  IF local_val IS NOT NULL THEN
    RETURN local_val;
  END IF;
  RETURN COALESCE(
    (SELECT role FROM operators WHERE id = current_operator_id() AND tenant_id = current_tenant_id()),
    'viewer'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_site_read_access(target_tenant_id UUID, target_site_id UUID)
RETURNS BOOLEAN AS $$
  SELECT
    target_tenant_id = current_tenant_id()
    AND (
      current_operator_role() = 'tenant_admin'
      OR target_site_id IS NULL
      OR EXISTS (
        SELECT 1 FROM operator_site_roles r
        WHERE r.operator_id = current_operator_id()
          AND r.tenant_id = target_tenant_id
          AND r.site_id = target_site_id
      )
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_site_write_access(target_tenant_id UUID, target_site_id UUID)
RETURNS BOOLEAN AS $$
  SELECT
    target_tenant_id = current_tenant_id()
    AND (
      current_operator_role() = 'tenant_admin'
      OR (
        current_operator_role() = 'site_admin'
        AND target_site_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM operator_site_roles r
          WHERE r.operator_id = current_operator_id()
            AND r.tenant_id = target_tenant_id
            AND r.site_id = target_site_id
            AND r.site_role = 'site_admin'
        )
      )
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Enable & Force RLS across all 16 tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_site_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE collectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payload_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
ALTER TABLE operators FORCE ROW LEVEL SECURITY;
ALTER TABLE operator_site_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE collectors FORCE ROW LEVEL SECURITY;
ALTER TABLE site_enrollment_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
ALTER TABLE payload_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE metrics FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE incident_events FORCE ROW LEVEL SECURITY;
ALTER TABLE recommendations FORCE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE health_history FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE site_notification_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_threads FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_isolation ON tenants
  FOR ALL USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());

CREATE POLICY sites_read ON sites
  FOR SELECT USING (has_site_read_access(tenant_id, id));
CREATE POLICY sites_write ON sites
  FOR ALL USING (has_site_write_access(tenant_id, id)) WITH CHECK (has_site_write_access(tenant_id, id));

CREATE POLICY operators_isolation ON operators
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY operator_site_roles_isolation ON operator_site_roles
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY collectors_read ON collectors
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY collectors_write ON collectors
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY enrollment_tokens_isolation ON site_enrollment_tokens
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY assets_read ON assets
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY assets_write ON assets
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY payload_receipts_read ON payload_receipts
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY payload_receipts_insert ON payload_receipts
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY metrics_read ON metrics
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY metrics_insert ON metrics
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY events_read ON events
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY events_insert ON events
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY incidents_read ON incidents
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY incidents_write ON incidents
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY incident_events_isolation ON incident_events
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY recommendations_read ON recommendations
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY recommendations_write ON recommendations
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY jobs_read ON jobs
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY jobs_write ON jobs
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY health_history_read ON health_history
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY health_history_insert ON health_history
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY audit_logs_read ON audit_logs
  FOR SELECT USING (has_site_read_access(tenant_id, site_id));
CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY notification_channels_isolation ON site_notification_channels
  FOR ALL USING (has_site_write_access(tenant_id, site_id)) WITH CHECK (has_site_write_access(tenant_id, site_id));

CREATE POLICY notification_threads_isolation ON notification_threads
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
