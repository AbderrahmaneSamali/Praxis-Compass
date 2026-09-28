-- Frozen planning inputs and outputs. A case is analysis, never a mastery award.
CREATE TABLE praxis.development_plan_case (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
 code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome),
 market_code text REFERENCES praxis.career_market(code),
 schema_version text NOT NULL,
 algorithm_version text NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 output_hash text NOT NULL CHECK(output_hash ~ '^[a-f0-9]{64}$'),
 input_snapshot jsonb NOT NULL CHECK(jsonb_typeof(input_snapshot)='object'),
 output_snapshot jsonb NOT NULL CHECK(jsonb_typeof(output_snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(learner_id,schema_version,algorithm_version,input_hash),
 CHECK(input_snapshot->>'schemaVersion'=schema_version),
 CHECK(input_snapshot->'target'->>'codeRome'=code_rome::text),
 CHECK((input_snapshot->'target'->>'marketCode') IS NOT DISTINCT FROM market_code),
 CHECK(output_snapshot->>'readiness'='not_assessed'),
 CHECK(output_snapshot->>'masteryEstablished'='false')
);
CREATE INDEX development_case_history ON praxis.development_plan_case(learner_id,code_rome,created_at DESC,id);
CREATE FUNCTION praxis.guard_development_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM praxis.learner WHERE id=OLD.learner_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Development cases are immutable; learner erasure can cascade';
END; $$;
CREATE TRIGGER development_case_immutable BEFORE UPDATE OR DELETE ON praxis.development_plan_case
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_development_case();
