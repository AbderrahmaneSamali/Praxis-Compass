-- Additive schema: old catalog data remains stored but must pass review before serving.
ALTER TABLE praxis.content_records
  ADD COLUMN next_end_date date,
  ADD COLUMN required_weekly_hours numeric(6,2) CHECK (required_weekly_hours > 0 AND required_weekly_hours <= 168),
  ADD COLUMN review_source_url text CHECK (review_source_url ~ '^https?://'),
  ADD COLUMN reviewed_by text,
  ADD COLUMN prerequisites_reviewed boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT course_session_dates CHECK (next_end_date IS NULL OR
    (next_start_date IS NOT NULL AND next_end_date >= next_start_date));

CREATE TABLE praxis.course_prerequisite (
  content_record_id uuid NOT NULL REFERENCES praxis.content_records(id) ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES praxis.skill(id),
  minimum_level smallint NOT NULL CHECK (minimum_level BETWEEN 1 AND 4),
  source_url text NOT NULL CHECK (source_url ~ '^https?://'),
  reviewed_by text NOT NULL CHECK (length(trim(reviewed_by)) > 0),
  reviewed_at timestamptz NOT NULL,
  PRIMARY KEY (content_record_id, skill_id)
);
CREATE INDEX course_prerequisite_skill_idx ON praxis.course_prerequisite(skill_id, minimum_level);

CREATE VIEW praxis.reviewed_online_offers AS
SELECT c.* FROM praxis.content_records c
JOIN praxis.provider p ON p.id = c.provider_id
WHERE c.deleted_at IS NULL AND c.status = 'published' AND c.actionable_offer
  AND c.is_online IS TRUE AND c.delivery_format IN ('online_live','online_self_paced')
  AND p.status = 'active' AND p.verified_at IS NOT NULL
  AND c.review_source_url IS NOT NULL AND nullif(trim(c.reviewed_by),'') IS NOT NULL
  AND c.prerequisites_reviewed
  AND (c.delivery_format = 'online_self_paced' OR c.required_weekly_hours IS NOT NULL)
  AND (c.admission_status = 'rolling_admission' OR
    (c.next_start_date >= CURRENT_DATE AND c.next_end_date IS NOT NULL))
  AND c.last_verified_at >= now() - interval '180 days'
  AND c.last_verified_at <= now()
  AND (c.application_url IS NOT NULL OR
    (c.contact_route = 'provider_email' AND p.contact_email IS NOT NULL) OR
    (c.contact_route = 'provider_phone' AND p.contact_phone IS NOT NULL) OR
    (c.contact_route = 'provider_website' AND p.website_url IS NOT NULL))
  AND EXISTS (SELECT 1 FROM praxis.course_skill_outcome o WHERE o.content_record_id=c.id AND o.weight>0)
  AND NOT EXISTS (SELECT 1 FROM praxis.course_skill_outcome o WHERE o.content_record_id=c.id
    AND (o.evidence_type <> 'validated' OR o.validated_at IS NULL OR nullif(trim(o.validated_by),'') IS NULL));

ALTER TABLE praxis.learner_context
  ADD COLUMN goal_kind text CHECK (goal_kind IN ('role','task')),
  ADD COLUMN goal_text text CHECK (length(goal_text) <= 1000),
  ADD COLUMN recent_work_example text CHECK (length(recent_work_example) <= 2000),
  ADD COLUMN budget_flexibility text NOT NULL DEFAULT 'mandatory' CHECK (budget_flexibility IN ('mandatory','flexible')),
  ADD COLUMN language_flexibility text NOT NULL DEFAULT 'mandatory' CHECK (language_flexibility IN ('mandatory','flexible')),
  ADD COLUMN format_flexibility text NOT NULL DEFAULT 'flexible' CHECK (format_flexibility IN ('mandatory','flexible')),
  ADD COLUMN online_format text CHECK (online_format IN ('online_live','online_self_paced'));

CREATE TABLE praxis.learner_prerequisite_declaration (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES praxis.skill(id),
  declared_level smallint NOT NULL CHECK (declared_level BETWEEN 0 AND 4),
  work_example text NOT NULL CHECK (length(trim(work_example)) BETWEEN 5 AND 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, skill_id)
);
ALTER TABLE praxis.recommendation_impression ADD COLUMN learning_plans jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE praxis.recommendation_impression ADD COLUMN is_example boolean NOT NULL DEFAULT false;

-- No assertion that a self-report is demonstrated improvement.
CREATE TABLE praxis.learning_skill_progress (
  outcome_id uuid NOT NULL REFERENCES praxis.learning_outcome(id) ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES praxis.skill(id),
  before_level smallint NOT NULL CHECK (before_level BETWEEN 0 AND 4),
  after_level smallint NOT NULL CHECK (after_level BETWEEN 0 AND 4),
  evidence_kind text NOT NULL DEFAULT 'self_report' CHECK (evidence_kind IN ('self_report','assessed')),
  assessment_session_id uuid REFERENCES praxis.assessment_session(id),
  baseline_assessment_session_id uuid REFERENCES praxis.assessment_session(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (evidence_kind <> 'assessed' OR (assessment_session_id IS NOT NULL AND baseline_assessment_session_id IS NOT NULL)),
  PRIMARY KEY (outcome_id, skill_id)
);

WITH retired AS (
  UPDATE praxis.recommendation_weights SET status='retired' WHERE status='active' RETURNING weights
)
INSERT INTO praxis.recommendation_weights(version,weights,status,activated_at)
SELECT 'praxis-rank-online-paths-v3',weights,'active',now() FROM retired;

-- Rollback: revert application/kernel together and reactivate v2 weights.
-- Keep evidence, declarations and historical impressions; export before dropping new tables.
