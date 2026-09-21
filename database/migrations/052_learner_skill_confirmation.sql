-- Learner decisions over CV-extracted skill proposals. Request/result snapshots
-- deliberately exclude raw CV snippets; those are shown only in the ephemeral
-- confirmation request assembled by the application.

CREATE TABLE praxis.cv_skill_confirmation_request (
  request_id text PRIMARY KEY CHECK (request_id ~ '^cv-confirm-[a-f0-9]{24}$'),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  catalog_version text NOT NULL,
  algorithm_version text NOT NULL,
  submitted_at timestamptz NOT NULL,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot)='object'),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (learner_id, request_digest)
);

CREATE TABLE praxis.cv_skill_confirmation_decision (
  request_id text NOT NULL REFERENCES praxis.cv_skill_confirmation_request(request_id) ON DELETE CASCADE,
  card_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('confirm','reject','correct','unsure')),
  suggested_catalog_skill_id text NOT NULL,
  selected_catalog_skill_id text,
  selected_skill_id text REFERENCES praxis.skill(id) ON DELETE RESTRICT,
  declared_level smallint CHECK (declared_level BETWEEN 1 AND 4),
  evidence_status text NOT NULL CHECK (evidence_status IN ('created','needs_level','none')),
  source_proposal_ids text[] NOT NULL CHECK (cardinality(source_proposal_ids)>0),
  source_evidence_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_id uuid REFERENCES praxis.skill_evidence(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (request_id,card_id),
  CHECK ((action IN ('confirm','correct'))=(selected_catalog_skill_id IS NOT NULL)),
  CHECK (action<>'confirm' OR selected_catalog_skill_id=suggested_catalog_skill_id),
  CHECK (action<>'correct' OR selected_catalog_skill_id<>suggested_catalog_skill_id),
  CHECK ((selected_catalog_skill_id IS NULL)=(selected_skill_id IS NULL)),
  CHECK ((evidence_status='none')=(selected_skill_id IS NULL)),
  CHECK ((evidence_status='created')=(declared_level IS NOT NULL)),
  CHECK ((evidence_status='created')=(evidence_id IS NOT NULL))
);

CREATE INDEX cv_skill_confirmation_learner_idx
  ON praxis.cv_skill_confirmation_request (learner_id,submitted_at DESC);

CREATE UNIQUE INDEX skill_evidence_confirmation_idempotency_idx
  ON praxis.skill_evidence (learner_id,(provenance->>'confirmationIdempotencyKey'))
  WHERE evidence_type='cv_extracted_confirmed' AND provenance ? 'confirmationIdempotencyKey';

CREATE OR REPLACE FUNCTION praxis.guard_cv_skill_confirmation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CV skill confirmation records are append-only';
END;
$$;

CREATE TRIGGER cv_skill_confirmation_request_immutable
BEFORE UPDATE ON praxis.cv_skill_confirmation_request
FOR EACH ROW EXECUTE FUNCTION praxis.guard_cv_skill_confirmation_update();

CREATE TRIGGER cv_skill_confirmation_decision_immutable
BEFORE UPDATE ON praxis.cv_skill_confirmation_decision
FOR EACH ROW EXECUTE FUNCTION praxis.guard_cv_skill_confirmation_update();

COMMENT ON TABLE praxis.cv_skill_confirmation_request IS
  'Authenticated learner response to a hashed CV-skill confirmation request; raw mention text is not retained here.';
COMMENT ON TABLE praxis.cv_skill_confirmation_decision IS
  'Per-skill confirm, reject, correct or unsure decision. Presence without an attested level creates no mastery evidence.';
