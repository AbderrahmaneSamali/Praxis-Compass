CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS praxis;

CREATE OR REPLACE FUNCTION praxis.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS praxis.content_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type text NOT NULL CHECK (record_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 180),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  summary text NOT NULL DEFAULT '',
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (record_type, slug),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
);

CREATE INDEX IF NOT EXISTS content_records_public_idx
  ON praxis.content_records (record_type, updated_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS content_records_status_idx
  ON praxis.content_records (status, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS content_records_attributes_gin
  ON praxis.content_records USING gin (attributes jsonb_path_ops);
CREATE INDEX IF NOT EXISTS content_records_search_gin
  ON praxis.content_records USING gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))
  );

DROP TRIGGER IF EXISTS content_records_touch_updated_at ON praxis.content_records;
CREATE TRIGGER content_records_touch_updated_at
BEFORE UPDATE ON praxis.content_records
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

CREATE TABLE IF NOT EXISTS praxis.record_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES praxis.content_records(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES praxis.content_records(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  position integer,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, relation_type),
  CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS record_relations_source_idx
  ON praxis.record_relations (source_id, relation_type, position);
CREATE INDEX IF NOT EXISTS record_relations_target_idx
  ON praxis.record_relations (target_id, relation_type);

CREATE TABLE IF NOT EXISTS praxis.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_record_id uuid REFERENCES praxis.content_records(id) ON DELETE SET NULL,
  subject_label text NOT NULL CHECK (char_length(subject_label) BETWEEN 2 AND 180),
  consent_kind text NOT NULL CHECK (consent_kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  status text NOT NULL CHECK (status IN ('active', 'review_due', 'revoked')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS consent_records_review_idx
  ON praxis.consent_records (status, valid_until);
DROP TRIGGER IF EXISTS consent_records_touch_updated_at ON praxis.consent_records;
CREATE TRIGGER consent_records_touch_updated_at
BEFORE UPDATE ON praxis.consent_records
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

CREATE TABLE IF NOT EXISTS praxis.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference text UNIQUE,
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 2 AND 180),
  contact jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(contact) = 'object'),
  interest_record_id uuid REFERENCES praxis.content_records(id) ON DELETE SET NULL,
  interest_label text NOT NULL,
  source text NOT NULL CHECK (char_length(source) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  consent_to_contact boolean NOT NULL DEFAULT false,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_pipeline_idx ON praxis.leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_interest_idx ON praxis.leads (interest_record_id, created_at DESC);
DROP TRIGGER IF EXISTS leads_touch_updated_at ON praxis.leads;
CREATE TRIGGER leads_touch_updated_at
BEFORE UPDATE ON praxis.leads
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

CREATE TABLE IF NOT EXISTS praxis.analytics_events (
  sequence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_name text NOT NULL CHECK (event_name ~ '^[a-z][a-z0-9_.]{1,79}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  session_id text,
  object_type text,
  object_id uuid,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties) = 'object'),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0)
);
CREATE INDEX IF NOT EXISTS analytics_events_time_brin
  ON praxis.analytics_events USING brin (occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx
  ON praxis.analytics_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_object_idx
  ON praxis.analytics_events (object_type, object_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_properties_gin
  ON praxis.analytics_events USING gin (properties jsonb_path_ops);

CREATE TABLE IF NOT EXISTS praxis.outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON praxis.outbox_events (created_at)
  WHERE published_at IS NULL;

INSERT INTO praxis.content_records (record_type, slug, title, status, summary, attributes, published_at)
VALUES
  ('course', 'project-delivery-lab', 'Project Delivery Lab', 'published',
   'Turn a complex plan into a clear, coordinated week of delivery.',
   '{"sector":"Built Environment","description":"Practice work packages, coordination routines, risk signals, and concise reporting.","format":"Hybrid cohort","duration":"6 weeks","level":"L2 · Application","price":"2,400 MAD","nextSession":"14 October","language":"EN / FR","skills":["Plan work packages","Coordinate stakeholders","Report delivery risks"],"validator":"Delivery Review Panel","relation":"Site Coordinator → Project Lead","initials":"PD","tone":"orange"}'::jsonb, now()),
  ('course', 'data-storytelling-sprint', 'Data Storytelling Sprint', 'published',
   'Move from a crowded dashboard to one decision people can act on.',
   '{"sector":"Digital Operations","description":"Frame a question, select evidence, and present a decision-ready narrative.","format":"Live online","duration":"4 weeks","level":"L2 · Application","price":"1,800 MAD","nextSession":"28 October","language":"EN / FR","skills":["Frame decision questions","Select useful evidence","Present a clear recommendation"],"validator":"Data Practice Panel","relation":"Operations Analyst → Insight Lead","initials":"DS","tone":"blue"}'::jsonb, now()),
  ('course', 'operational-risk-clinic', 'Operational Risk Clinic', 'published',
   'Spot weak signals early and turn them into practical controls.',
   '{"sector":"Built Environment","description":"Link risk identification, prioritization, treatment, and evidence of control.","format":"Weekend intensive","duration":"2 weeks","level":"L3 · Mastery","price":"1,500 MAD","nextSession":"9 November","language":"FR","skills":["Identify operational risk","Prioritize exposure","Design practical controls"],"validator":"Operational Review Panel","relation":"Team Lead → Operations Manager","initials":"OR","tone":"navy"}'::jsonb, now()),
  ('course', 'quality-traceability-studio', 'Quality & Traceability Studio', 'published',
   'Build a simple evidence trail from intake to corrective action.',
   '{"sector":"Food Systems","description":"Practice process mapping, quality checkpoints, traceability, and improvement actions.","format":"In person","duration":"3 days","level":"L1 · Discovery","price":"950 MAD","nextSession":"21 November","language":"FR","skills":["Map a quality process","Maintain traceability","Document corrective action"],"validator":"Quality Review Panel","relation":"Quality Assistant → Quality Coordinator","initials":"QT","tone":"orange"}'::jsonb, now()),
  ('pathway', 'site-coordinator-pathway', 'Site Coordinator → Project Lead', 'published',
   'Build the coordination, evidence, and leadership skills for a larger delivery scope.',
   '{"sector":"Built Environment","description":"A structured pathway combining a baseline diagnostic, focused learning, and an applied work sample.","format":"Guided pathway","duration":"14 weeks","level":"L2 → L3","price":"Bundle price pending","nextSession":"Flexible start","language":"EN / FR","skills":["Coordinate delivery","Manage operational risk","Lead review conversations"],"validator":"Pathway Review Board","relation":"3 ordered steps · 1 alternative","initials":"PL","tone":"navy"}'::jsonb, now()),
  ('pathway', 'insight-lead-pathway', 'Operations Analyst → Insight Lead', 'published',
   'Connect analysis, communication, and stakeholder action into one progression route.',
   '{"sector":"Digital Operations","description":"Sequence analysis foundations, data storytelling, and a decision brief.","format":"Flexible pathway","duration":"10 weeks","level":"L2 → L3","price":"Bundle price pending","nextSession":"Flexible start","language":"EN","skills":["Analyze operational data","Explain evidence","Influence a decision"],"validator":"Pathway Review Board","relation":"3 ordered steps · 2 alternatives","initials":"IL","tone":"blue"}'::jsonb, now())
ON CONFLICT (record_type, slug) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  attributes = EXCLUDED.attributes,
  status = EXCLUDED.status,
  published_at = COALESCE(praxis.content_records.published_at, EXCLUDED.published_at);

INSERT INTO praxis.consent_records (subject_label, consent_kind, scope, status, valid_until, source_reference)
VALUES
  ('Delivery Review Panel', 'expert_profile', '{"uses":["profile","course_validation"]}'::jsonb, 'active', now() + interval '1 year', 'consent-record-001'),
  ('Data Practice Panel ↔ Learning Network', 'affiliation', '{"uses":["public_affiliation"]}'::jsonb, 'review_due', now() + interval '7 days', 'consent-record-002'),
  ('Skills Council', 'organization_mark', '{"uses":["name","validation_statement"]}'::jsonb, 'active', now() + interval '1 year', 'consent-record-003')
ON CONFLICT DO NOTHING;

INSERT INTO praxis.leads (external_reference, display_label, interest_label, source, status, consent_to_contact)
VALUES
  ('lead-001', 'Learner inquiry 014', 'Project Delivery Lab', 'Guided diagnostic', 'qualified', true),
  ('lead-002', 'Team inquiry 008', 'Operational capability review', 'Organization form', 'new', true),
  ('lead-003', 'Learner inquiry 011', 'Data Storytelling Sprint', 'Catalog', 'contacted', true)
ON CONFLICT (external_reference) DO NOTHING;
