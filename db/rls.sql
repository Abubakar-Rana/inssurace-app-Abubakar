-- CertFlow — row-level security and audit immutability.
-- Run AFTER drizzle migrations create the tables (db/migrate.ts does this).
--
-- Security L3: an agency cannot read another agency's rows even if application
-- code forgets a WHERE clause. The database refuses. This is the difference
-- between "we validate tenant access" and "cross-tenant access is impossible".
--
-- Security L4: the application role has no UPDATE or DELETE on audit_log, so
-- immutability is a database grant rather than a promise.

-- Fuzzy company-name matching for entity resolution.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Deterministic blind indexes (HMAC) for encrypted exact-match columns.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE INDEX IF NOT EXISTS clients_legal_name_trgm
  ON clients USING gin (legal_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS client_aliases_trgm
  ON client_aliases USING gin (alias gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Application role. The app connects as this role, never as the owner or
-- superuser — RLS is bypassed by table owners, which would silently defeat it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'certflow_app') THEN
    CREATE ROLE certflow_app NOLOGIN;
  END IF;
END $$;

-- Let the connecting user drop INTO the application role for each tenant
-- transaction (lib/db/client.ts withTenant, DB_ENFORCE_RLS=1). Without this the
-- connection user — BYPASSRLS on Supabase — would never be subject to the
-- policies below.
DO $$
BEGIN
  EXECUTE format('GRANT certflow_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not grant certflow_app to %: %', current_user, SQLERRM;
END $$;

GRANT USAGE ON SCHEMA public TO certflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO certflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO certflow_app;

-- Audit log is append-only: grant INSERT and SELECT, revoke the rest.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM certflow_app;

-- ---------------------------------------------------------------------------
-- Tenant isolation. Each request sets `certflow.tenant_id` on its connection
-- (see lib/db/client.ts withTenant); policies compare every row against it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_keys', 'users', 'producers', 'clients', 'client_aliases',
    'policies', 'vehicles', 'certificate_holders', 'coi_requests',
    'interpretations', 'certificates', 'deliveries', 'audit_log',
    'tenant_mail_settings', 'tenant_nowcerts_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('certflow.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('certflow.tenant_id', true)::uuid)
    $f$, t);
  END LOOP;
END $$;

-- `tenants` is filtered on its own id rather than a tenant_id column.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = current_setting('certflow.tenant_id', true)::uuid);

-- `insurers` is national reference data (NAIC codes are federal), shared by all
-- tenants and containing no customer information. Intentionally no RLS.
GRANT SELECT ON insurers TO certflow_app;
-- The NowCerts sync records carriers it has not seen before. Carrier names and
-- NAIC codes are public reference data, so writing them is not a tenant leak.
GRANT INSERT, UPDATE ON insurers TO certflow_app;

-- `platform_admins` are Nestnic staff, not members of any tenant. The tenant
-- application role has no business reading them at all — revoke rather than
-- write a policy, so there is nothing to get wrong.
REVOKE ALL ON platform_admins FROM certflow_app;

-- `access_requests` are public enquiries, not tenant data, and nobody signs
-- in from them. The tenant application role has no business reading them.
REVOKE ALL ON access_requests FROM certflow_app;
