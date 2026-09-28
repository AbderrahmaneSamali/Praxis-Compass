-- Reports retain their complete scope and facts; exports do not join mutable live data.
CREATE TABLE praxis.career_report (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
 schema_version text NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(learner_id,schema_version,content_hash),
 CHECK(COALESCE(snapshot->>'schemaVersion'=schema_version,false)),
 CHECK(COALESCE(jsonb_typeof(snapshot->'candidates')='array',false)),
 CHECK(COALESCE(jsonb_array_length(snapshot->'candidates')>0,false)),
 CHECK(COALESCE(jsonb_typeof(snapshot->'targets')='array',false)),
 CHECK(COALESCE(jsonb_array_length(snapshot->'targets') BETWEEN 1 AND 3,false))
);
CREATE INDEX career_report_history ON praxis.career_report(learner_id,created_at DESC,id DESC);
CREATE FUNCTION praxis.guard_career_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM praxis.learner WHERE id=OLD.learner_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Career reports are immutable; learner erasure can cascade';
END; $$;
CREATE TRIGGER career_report_immutable BEFORE UPDATE OR DELETE ON praxis.career_report
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_career_report();
