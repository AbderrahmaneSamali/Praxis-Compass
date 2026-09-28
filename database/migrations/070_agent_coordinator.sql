-- Bounded assistant runs over immutable report snapshots. No prompt or free-form model text is retained.
ALTER TABLE praxis.career_report ADD CONSTRAINT career_report_owner_key UNIQUE(id,learner_id);
CREATE TABLE praxis.career_agent_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
 report_id uuid NOT NULL,
 report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
 policy_version text NOT NULL,
 model text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
 model_calls smallint NOT NULL DEFAULT 0 CHECK(model_calls BETWEEN 0 AND 4),
 tool_calls smallint NOT NULL DEFAULT 0 CHECK(tool_calls BETWEEN 0 AND 3),
 result jsonb,
 error_code text,
 deadline_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 finished_at timestamptz,
 FOREIGN KEY(report_id,learner_id) REFERENCES praxis.career_report(id,learner_id) ON DELETE CASCADE,
 CHECK((status='completed')=(result IS NOT NULL)),
 CHECK(status NOT IN ('completed','failed','cancelled') OR finished_at IS NOT NULL),
 UNIQUE(id,learner_id)
);
CREATE UNIQUE INDEX career_agent_one_active_per_learner ON praxis.career_agent_run(learner_id)
 WHERE status IN ('queued','running');
CREATE INDEX career_agent_history ON praxis.career_agent_run(learner_id,created_at DESC,id DESC);

CREATE TABLE praxis.career_agent_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 run_id uuid NOT NULL,
 learner_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('queued','started','model_call','tool_call','completed','failed','cancelled')),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(run_id,learner_id) REFERENCES praxis.career_agent_run(id,learner_id) ON DELETE CASCADE
);
CREATE INDEX career_agent_event_run ON praxis.career_agent_event(run_id,id);
