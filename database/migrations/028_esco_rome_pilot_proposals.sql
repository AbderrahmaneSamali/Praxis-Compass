-- ESCO<->ROME pilot: proposal store, sealed negative-control register, and the
-- blinded review surface.
--
-- Every row this schema holds is a PROPOSAL. Nothing here writes
-- praxis.occupation.rome_code_rome, and no ranker-readable surface reads these
-- tables. Approval remains a separate, human, reviewed act.
--
-- The negative-control seal is keyed on the proposal's inputs_hash, which is a
-- pure function of (ESCO occupation, ESCO release, ROME fiche, ROME release,
-- algorithm version). That determinism is what lets the seal be written BEFORE
-- generation; a trigger enforces the ordering so blinding cannot silently
-- degrade into post-hoc labelling.
--
-- rollback:
--   DROP VIEW praxis.pilot_negative_control_outcome;
--   DROP VIEW praxis.esco_rome_review_queue;
--   DROP TRIGGER esco_rome_proposal_seal_precedence ON praxis.esco_rome_occupation_proposal;
--   DROP FUNCTION praxis.enforce_negative_control_seal_precedence();
--   DROP TABLE praxis.esco_rome_occupation_proposal;
--   DROP TABLE praxis.pilot_negative_control_seal;
--   ALTER TABLE praxis.praxis_mapping_review_events
--     DROP CONSTRAINT praxis_mapping_review_events_mapping_kind_check,
--     ADD CONSTRAINT praxis_mapping_review_events_mapping_kind_check CHECK (
--       mapping_kind IN ('occupation_sector','skill_sector','skill_cross_domain',
--         'occupation_skill_target','navigator_role_skill_target',
--         'course_skill_outcome','source_cross_domain','occupation_seniority'));
--   Review history for kind 'source_occupation_mapping' must be exported first;
--   the pre-028 constraint cannot hold it.

-- ---------------------------------------------------------------------------
-- Sealed negative-control register. Written before generation, read only after
-- the first 50 decisions are recorded.
-- ---------------------------------------------------------------------------
CREATE TABLE praxis.pilot_negative_control_seal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The join key to a proposal. Deterministic from pair + algorithm version.
  proposal_inputs_hash text NOT NULL UNIQUE
    CHECK (proposal_inputs_hash ~ '^[a-f0-9]{64}$'),
  failure_mode text NOT NULL CHECK (failure_mode IN (
    'seniority_collapse_same_domain',
    'seniority_collapse_near_identical_string',
    'shared_head_noun_different_domain',
    'polysemous_role_prefix',
    'adjacent_distinct_specialism'
  )),
  -- A negative control is only ever expected to be rejected. Recorded
  -- explicitly so the comparison is never inferred from the failure mode.
  expected_verdict text NOT NULL CHECK (expected_verdict = 'reject'),
  -- Separates the two experiments. Controls the matcher actually generates
  -- measure MATCHER precision. A control injected without the matcher
  -- proposing it would measure REVIEWER vigilance instead, and must never be
  -- mixed into a matcher-precision figure.
  experiment text NOT NULL DEFAULT 'matcher_precision'
    CHECK (experiment IN ('matcher_precision', 'reviewer_vigilance')),
  esco_occupation_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  rome_code_rome character(5) NOT NULL
    REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  -- The objective, pre-registered reason this pair is not an identity match.
  rationale text NOT NULL CHECK (rationale <> ''),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the seal is opened for comparison; never before 50 decisions.
  unsealed_at timestamptz,
  UNIQUE (esco_occupation_uri, rome_code_rome)
);

COMMENT ON TABLE praxis.pilot_negative_control_seal IS
  'Pre-registered negative controls. Reviewers must never join this table to the review queue.';

-- ---------------------------------------------------------------------------
-- Proposal store.
-- ---------------------------------------------------------------------------
CREATE TABLE praxis.esco_rome_occupation_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  esco_release_id uuid NOT NULL
    REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  esco_occupation_uri text NOT NULL
    REFERENCES praxis.esco_occupations(concept_uri) ON DELETE RESTRICT,
  rome_release_id uuid NOT NULL
    REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  rome_code_rome character(5) NOT NULL
    REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  -- At most two candidates per curated ESCO occupation.
  candidate_rank smallint NOT NULL CHECK (candidate_rank IN (1, 2)),
  mapping_method text NOT NULL DEFAULT 'automatic'
    CHECK (mapping_method = 'automatic'),
  validation_status text NOT NULL DEFAULT 'proposed'
    CHECK (validation_status IN ('proposed', 'under_review', 'validated', 'rejected')),
  total_score numeric(6,5) NOT NULL CHECK (total_score >= 0 AND total_score <= 1),
  -- Per-component contributions, including the explicitly unavailable ones.
  component_scores jsonb NOT NULL CHECK (jsonb_typeof(component_scores) = 'object'),
  -- Which fields matched, and on which normalised tokens.
  matched_fields jsonb NOT NULL CHECK (jsonb_typeof(matched_fields) = 'object'),
  -- The candidate that lost, retained so a reviewer can see the alternative.
  runner_up jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(runner_up) = 'object'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (esco_release_id, esco_occupation_uri, rome_release_id, rome_code_rome),
  -- The seal join key must identify exactly one proposal.
  UNIQUE (inputs_hash)
);

CREATE INDEX esco_rome_occupation_proposal_occupation_idx
  ON praxis.esco_rome_occupation_proposal (esco_occupation_uri, candidate_rank);

COMMENT ON COLUMN praxis.esco_rome_occupation_proposal.component_scores IS
  'Includes description_fr with availability "unavailable_rome_side": ROME publishes no fiche description in the CSV build.';

-- ---------------------------------------------------------------------------
-- Blinding guard: a control seal must predate the proposal it labels.
-- ---------------------------------------------------------------------------
CREATE FUNCTION praxis.enforce_negative_control_seal_precedence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sealed timestamptz;
BEGIN
  SELECT seal.sealed_at INTO sealed
  FROM praxis.pilot_negative_control_seal AS seal
  WHERE seal.proposal_inputs_hash = NEW.inputs_hash;

  IF sealed IS NOT NULL AND sealed > NEW.created_at THEN
    RAISE EXCEPTION
      'Negative control seal for % was written after the proposal; blinding is void',
      NEW.inputs_hash;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER esco_rome_proposal_seal_precedence
  BEFORE INSERT ON praxis.esco_rome_occupation_proposal
  FOR EACH ROW EXECUTE FUNCTION praxis.enforce_negative_control_seal_precedence();

-- ---------------------------------------------------------------------------
-- Review surface. Blinded: no seal join, no control flag, no ordering tell.
-- Ordered by inputs_hash, which is uncorrelated with control status and with
-- generation order.
-- ---------------------------------------------------------------------------
CREATE VIEW praxis.esco_rome_review_queue AS
SELECT
  proposal.id AS proposal_id,
  -- The reviewer's question is identity, never relatedness. The pilot
  -- populates the single-valued praxis.occupation.rome_code_rome, so "are
  -- these related?" is not the question being asked.
  'Is this THE ROME fiche for this ESCO occupation?'::text AS review_question,
  esco_version.preferred_label AS esco_label_fr,
  esco_version.description AS esco_description_fr,
  esco_version.esco_notation AS esco_isco_notation,
  proposal.esco_occupation_uri,
  rome_version.preferred_label AS rome_label,
  rome_version.code_rome AS rome_code_rome,
  rome_version.emploi_cadre AS rome_emploi_cadre,
  proposal.candidate_rank,
  proposal.total_score,
  proposal.component_scores,
  proposal.matched_fields,
  proposal.runner_up,
  proposal.evidence,
  proposal.validation_status
FROM praxis.esco_rome_occupation_proposal AS proposal
JOIN praxis.esco_occupation_versions AS esco_version
  ON esco_version.occupation_uri = proposal.esco_occupation_uri
JOIN praxis.esco_releases AS esco_release
  ON esco_release.source_release_id = proposal.esco_release_id
 AND esco_release.id = esco_version.release_id
JOIN praxis.rome_occupation_versions AS rome_version
  ON rome_version.code_rome = proposal.rome_code_rome
 AND rome_version.release_id = proposal.rome_release_id
ORDER BY proposal.inputs_hash;

COMMENT ON VIEW praxis.esco_rome_review_queue IS
  'Blinded review surface. Never join praxis.pilot_negative_control_seal to this view.';

-- ---------------------------------------------------------------------------
-- Outcome reporting. Keeps the three control outcomes separate; a control the
-- matcher never proposed is a matcher WIN, not a reviewer catch, and is
-- excluded from reviewer-catch-rate.
-- ---------------------------------------------------------------------------
CREATE VIEW praxis.pilot_negative_control_outcome AS
SELECT
  seal.failure_mode,
  seal.experiment,
  seal.esco_occupation_uri,
  seal.rome_code_rome,
  seal.expected_verdict,
  seal.rationale,
  CASE
    WHEN proposal.id IS NULL THEN 'not_surfaced'
    WHEN latest.decision = 'approved' THEN 'surfaced_approved'
    WHEN latest.decision = 'rejected' THEN 'surfaced_rejected'
    ELSE 'surfaced_undecided'
  END AS outcome
FROM praxis.pilot_negative_control_seal AS seal
LEFT JOIN praxis.esco_rome_occupation_proposal AS proposal
  ON proposal.inputs_hash = seal.proposal_inputs_hash
LEFT JOIN LATERAL (
  SELECT event.decision
  FROM praxis.praxis_mapping_review_events AS event
  WHERE event.mapping_kind = 'source_occupation_mapping'
    AND event.mapping_id = proposal.id
    AND event.decision IN ('approved', 'rejected')
  ORDER BY event.occurred_at DESC
  LIMIT 1
) AS latest ON true;

ALTER TABLE praxis.praxis_mapping_review_events
  DROP CONSTRAINT praxis_mapping_review_events_mapping_kind_check,
  ADD CONSTRAINT praxis_mapping_review_events_mapping_kind_check CHECK (
    mapping_kind IN (
      'occupation_sector', 'skill_sector', 'skill_cross_domain',
      'occupation_skill_target', 'navigator_role_skill_target',
      'course_skill_outcome', 'source_cross_domain', 'occupation_seniority',
      'source_occupation_mapping'
    )
  );
