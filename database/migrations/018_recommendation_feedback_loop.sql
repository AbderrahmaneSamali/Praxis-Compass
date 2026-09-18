-- Phase 3: immutable recommendation impressions, learner/client feedback,
-- outcomes, and monthly-partitioned behavioural event streams.
--
-- The canonical content-record UUID is used for every item_id. This is the
-- FK-safe equivalent of the diagnostic's pre-consolidation text placeholder.
-- analytics_events is copied into a range-partitioned replacement in this
-- transaction; event_id deduplication moves to analytics_event_registry.
--
-- paired down-migration note:
--   Stop event writers and take a backup before rollback. Recreate an
--   unpartitioned analytics_events table from all analytics_events_* partitions,
--   restore its global event_id UNIQUE constraint, then drop the partition
--   helper/registry. Drop the six Phase 3 tables, client_organization, and the
--   two learner preference columns. Restore the prior mapping_kind CHECK.
--   Impression/event history written after cutover cannot be represented by
--   the old schema and must be exported before rollback.

CREATE TABLE praxis.client_organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 180),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE praxis.client_organization IS
  'Minimal FK target for employer/client feedback; organization enrichment belongs in a later bounded context.';

ALTER TABLE praxis.learner
  ADD COLUMN recommendation_constraints jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(recommendation_constraints) = 'object'),
  ADD COLUMN recommendation_level_prior numeric(4,2) NOT NULL DEFAULT 0
    CHECK (recommendation_level_prior BETWEEN -2 AND 2);

CREATE TABLE praxis.recommendation_impression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface ~ '^[a-z][a-z0-9_]{1,79}$'),
  weights_version text NOT NULL
    REFERENCES praxis.recommendation_weights(version) ON DELETE RESTRICT,
  candidate_count smallint NOT NULL CHECK (candidate_count >= 0),
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  target_occupation_id text
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  learner_segment text NOT NULL CHECK (char_length(learner_segment) BETWEEN 1 AND 240),
  is_exploration boolean NOT NULL DEFAULT false,
  exploration_probability numeric(5,4) NOT NULL DEFAULT 0.0500
    CHECK (exploration_probability BETWEEN 0 AND 1),
  served_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recommendation_impression_learner_time_idx
  ON praxis.recommendation_impression (learner_id, served_at DESC);
CREATE INDEX recommendation_impression_segment_time_idx
  ON praxis.recommendation_impression (learner_segment, served_at DESC);

CREATE TABLE praxis.recommendation_impression_item (
  impression_id uuid NOT NULL
    REFERENCES praxis.recommendation_impression(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('course', 'pathway')),
  item_id uuid NOT NULL
    REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  rank smallint NOT NULL CHECK (rank > 0),
  score numeric(6,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  features jsonb NOT NULL CHECK (jsonb_typeof(features) = 'object'),
  reasons jsonb NOT NULL CHECK (
    jsonb_typeof(reasons) = 'array'
    AND NOT jsonb_path_exists(reasons, '$[*] ? (@.type() != "object")')
  ),
  PRIMARY KEY (impression_id, item_type, item_id),
  UNIQUE (impression_id, rank)
);

COMMENT ON COLUMN praxis.recommendation_impression_item.features IS
  'Complete served-time feature vector. Mandatory for unbiased offline replay; never reconstruct from current data.';

CREATE TABLE praxis.recommendation_event (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY,
  impression_id uuid
    REFERENCES praxis.recommendation_impression(id) ON DELETE SET NULL,
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('course', 'pathway')),
  item_id uuid NOT NULL
    REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN
    ('view', 'expand', 'save', 'dismiss', 'lead_submit', 'enroll')),
  dwell_ms integer CHECK (dwell_ms >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sequence_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX recommendation_event_learner_idx
  ON praxis.recommendation_event (learner_id, occurred_at DESC);
CREATE INDEX recommendation_event_impression_idx
  ON praxis.recommendation_event (impression_id, occurred_at DESC);

CREATE TABLE praxis.recommendation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impression_id uuid NOT NULL
    REFERENCES praxis.recommendation_impression(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('course', 'pathway')),
  item_id uuid NOT NULL
    REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  relevance smallint CHECK (relevance BETWEEN 1 AND 5),
  reason_code text CHECK (reason_code IN
    ('too_basic', 'too_advanced', 'wrong_domain', 'too_expensive',
     'bad_timing', 'wrong_format', 'already_have_skill', 'other')),
  comment text CHECK (comment IS NULL OR length(comment) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (impression_id, item_type, item_id),
  CHECK (relevance IS NOT NULL OR reason_code IS NOT NULL)
);

CREATE TABLE praxis.learning_outcome (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL
    REFERENCES praxis.learner(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('course', 'pathway')),
  item_id uuid NOT NULL
    REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  source_impression uuid
    REFERENCES praxis.recommendation_impression(id) ON DELETE SET NULL,
  enrolled_at timestamptz,
  completed_at timestamptz,
  completion_status text CHECK (
    completion_status IN ('completed', 'dropped', 'in_progress')
  ),
  satisfaction smallint CHECK (satisfaction BETWEEN 1 AND 5),
  post_skill_level smallint CHECK (post_skill_level BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learner_id, item_type, item_id),
  CHECK (completed_at IS NULL OR enrolled_at IS NULL OR completed_at >= enrolled_at),
  CHECK (completion_status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE TRIGGER learning_outcome_touch_updated_at
BEFORE UPDATE ON praxis.learning_outcome
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

CREATE INDEX learning_outcome_item_status_idx
  ON praxis.learning_outcome (item_id, completion_status);

CREATE TABLE praxis.client_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES praxis.client_organization(id) ON DELETE RESTRICT,
  learner_id uuid
    REFERENCES praxis.learner(id) ON DELETE SET NULL,
  occupation_id text
    REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  skill_id text
    REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  item_id uuid
    REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  feedback_kind text NOT NULL CHECK (feedback_kind IN
    ('skill_demand', 'skill_gap_observed', 'post_training_performance',
     'target_level_correction', 'course_quality')),
  observed_level smallint CHECK (observed_level BETWEEN 1 AND 4),
  expected_level smallint CHECK (expected_level BETWEEN 1 AND 4),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR length(comment) <= 4000),
  consent_id uuid NOT NULL
    REFERENCES praxis.consent_records(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    feedback_kind <> 'post_training_performance'
    OR (item_id IS NOT NULL AND skill_id IS NOT NULL)
  ),
  CHECK (
    feedback_kind NOT IN ('skill_demand', 'target_level_correction')
    OR (occupation_id IS NOT NULL AND skill_id IS NOT NULL)
  )
);

CREATE INDEX client_feedback_demand_idx
  ON praxis.client_feedback (occupation_id, skill_id, occurred_at DESC);

ALTER TABLE praxis.praxis_mapping_review_events
  DROP CONSTRAINT praxis_mapping_review_events_mapping_kind_check,
  ADD CONSTRAINT praxis_mapping_review_events_mapping_kind_check CHECK (
    mapping_kind IN (
      'occupation_sector', 'skill_sector', 'skill_cross_domain',
      'occupation_skill_target', 'navigator_role_skill_target',
      'course_skill_outcome'
    )
  );

-- PostgreSQL requires a partition key in every unique constraint. This small
-- registry preserves the original global event_id idempotency guarantee while
-- the event payload itself is partitioned by occurred_at.
CREATE TABLE praxis.analytics_event_registry (
  event_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL
);

INSERT INTO praxis.analytics_event_registry (event_id, occurred_at)
SELECT event_id, occurred_at FROM praxis.analytics_events;

ALTER TABLE praxis.analytics_events RENAME TO analytics_events_unpartitioned_018;
ALTER INDEX praxis.analytics_events_pkey
  RENAME TO analytics_events_unpartitioned_018_pkey;
ALTER INDEX praxis.analytics_events_event_id_key
  RENAME TO analytics_events_unpartitioned_018_event_id_key;
ALTER INDEX praxis.analytics_events_time_brin
  RENAME TO analytics_events_unpartitioned_018_time_brin;
ALTER INDEX praxis.analytics_events_name_time_idx
  RENAME TO analytics_events_unpartitioned_018_name_time_idx;
ALTER INDEX praxis.analytics_events_object_idx
  RENAME TO analytics_events_unpartitioned_018_object_idx;

CREATE TABLE praxis.analytics_events (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name ~ '^[a-z][a-z0-9_.]{1,79}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  session_id text,
  object_type text,
  object_id uuid,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(properties) = 'object'),
  context jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(context) = 'object'),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  PRIMARY KEY (sequence_id, occurred_at),
  UNIQUE (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX analytics_events_time_brin
  ON praxis.analytics_events USING brin (occurred_at);
CREATE INDEX analytics_events_name_time_idx
  ON praxis.analytics_events (event_name, occurred_at DESC);
CREATE INDEX analytics_events_object_idx
  ON praxis.analytics_events (object_type, object_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION praxis.ensure_monthly_event_partitions(
  event_time timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, praxis
AS $$
DECLARE
  month_start timestamptz := date_trunc('month', event_time);
  month_end timestamptz := date_trunc('month', event_time) + interval '1 month';
  suffix text := to_char(event_time AT TIME ZONE 'UTC', 'YYYY_MM');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('praxis-event-partition-' || suffix));
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS praxis.%I PARTITION OF praxis.recommendation_event FOR VALUES FROM (%L) TO (%L)',
    'recommendation_event_' || suffix, month_start, month_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS praxis.%I PARTITION OF praxis.analytics_events FOR VALUES FROM (%L) TO (%L)',
    'analytics_events_' || suffix, month_start, month_end
  );
END
$$;

DO $$
DECLARE
  cursor_month timestamptz;
  first_month timestamptz;
  last_month timestamptz := date_trunc('month', now()) + interval '12 months';
BEGIN
  SELECT least(
    coalesce(date_trunc('month', min(occurred_at)), date_trunc('month', now())),
    date_trunc('month', now()) - interval '24 months'
  ) INTO first_month
  FROM praxis.analytics_events_unpartitioned_018;

  cursor_month := first_month;
  WHILE cursor_month <= last_month LOOP
    PERFORM praxis.ensure_monthly_event_partitions(cursor_month);
    cursor_month := cursor_month + interval '1 month';
  END LOOP;
END
$$;

INSERT INTO praxis.analytics_events
  (sequence_id, event_id, event_name, occurred_at, received_at, actor_id,
   session_id, object_type, object_id, properties, context, schema_version)
OVERRIDING SYSTEM VALUE
SELECT sequence_id, event_id, event_name, occurred_at, received_at, actor_id,
       session_id, object_type, object_id, properties, context, schema_version
FROM praxis.analytics_events_unpartitioned_018;

SELECT setval(
  pg_get_serial_sequence('praxis.analytics_events', 'sequence_id'),
  greatest(coalesce((SELECT max(sequence_id) FROM praxis.analytics_events), 0), 1),
  coalesce((SELECT max(sequence_id) FROM praxis.analytics_events), 0) > 0
);

DO $$
DECLARE
  old_count bigint;
  new_count bigint;
BEGIN
  SELECT count(*) INTO old_count
  FROM praxis.analytics_events_unpartitioned_018;
  SELECT count(*) INTO new_count
  FROM praxis.analytics_events;
  IF old_count <> new_count THEN
    RAISE EXCEPTION 'analytics_events partition copy mismatch: old %, new %',
      old_count, new_count;
  END IF;
END
$$;

DROP TABLE praxis.analytics_events_unpartitioned_018;

COMMENT ON TABLE praxis.recommendation_event IS
  'Monthly partitions; retain raw recommendation events for 24 months per docs/RECOMMENDATION_DATA_RETENTION.md.';
COMMENT ON TABLE praxis.analytics_events IS
  'Monthly partitions; retain raw product analytics for 24 months per docs/RECOMMENDATION_DATA_RETENTION.md.';
