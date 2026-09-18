CREATE TABLE IF NOT EXISTS praxis.diagnostic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_actor_id text,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('started', 'completed', 'abandoned', 'archived')),
  question_version text NOT NULL DEFAULT 'navigator-v1',
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(constraints) = 'object'),
  consent_to_contact boolean NOT NULL DEFAULT false,
  rules_version text NOT NULL DEFAULT 'matching-v1',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostic_sessions_status_time_idx
  ON praxis.diagnostic_sessions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_sessions_profile_gin
  ON praxis.diagnostic_sessions USING gin (profile jsonb_path_ops);
DROP TRIGGER IF EXISTS diagnostic_sessions_touch_updated_at ON praxis.diagnostic_sessions;
CREATE TRIGGER diagnostic_sessions_touch_updated_at
BEFORE UPDATE ON praxis.diagnostic_sessions
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

CREATE TABLE IF NOT EXISTS praxis.diagnostic_answers (
  diagnostic_id uuid NOT NULL REFERENCES praxis.diagnostic_sessions(id) ON DELETE CASCADE,
  question_key text NOT NULL CHECK (question_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  answer jsonb NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagnostic_id, question_key)
);

CREATE TABLE IF NOT EXISTS praxis.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostic_id uuid NOT NULL REFERENCES praxis.diagnostic_sessions(id) ON DELETE CASCADE,
  record_id uuid NOT NULL REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  score numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  rank smallint NOT NULL CHECK (rank > 0),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  rules_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (diagnostic_id, record_id),
  UNIQUE (diagnostic_id, rank)
);
CREATE INDEX IF NOT EXISTS recommendations_diagnostic_rank_idx
  ON praxis.recommendations (diagnostic_id, rank);

CREATE TABLE IF NOT EXISTS praxis.learner_activity (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anonymous_actor_id text NOT NULL,
  content_record_id uuid REFERENCES praxis.content_records(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (activity_type ~ '^[a-z][a-z0-9_.]{1,79}$'),
  progress numeric(5,2) CHECK (progress >= 0 AND progress <= 100),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learner_activity_actor_time_idx
  ON praxis.learner_activity (anonymous_actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learner_activity_record_time_idx
  ON praxis.learner_activity (content_record_id, occurred_at DESC);

UPDATE praxis.content_records
SET attributes = jsonb_set(
  attributes,
  '{imageUrl}',
  to_jsonb(CASE slug
    WHEN 'project-delivery-lab' THEN 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200&q=82'
    WHEN 'data-storytelling-sprint' THEN 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=82'
    WHEN 'operational-risk-clinic' THEN 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&q=82'
    WHEN 'quality-traceability-studio' THEN 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&q=82'
    WHEN 'site-coordinator-pathway' THEN 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1200&q=82'
    WHEN 'insight-lead-pathway' THEN 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=82'
  END),
  true
)
WHERE slug IN (
  'project-delivery-lab',
  'data-storytelling-sprint',
  'operational-risk-clinic',
  'quality-traceability-studio',
  'site-coordinator-pathway',
  'insight-lead-pathway'
);
