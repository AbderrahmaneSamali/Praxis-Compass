BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM praxis.schema_migrations
             WHERE substring(filename from 1 for 3)::integer > 63) THEN
    RAISE EXCEPTION 'Rollback 063 requires rolling back later migrations first';
  END IF;
END $$;
DROP TABLE praxis.agent_gateway_tool_call;
DROP TABLE praxis.agent_gateway_request;
DELETE FROM praxis.schema_migrations WHERE filename='063_agent_gateway_audit.sql';
COMMIT;
