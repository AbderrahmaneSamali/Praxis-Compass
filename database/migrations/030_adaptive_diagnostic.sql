-- Adaptive branching diagnostic: sessions, full decision trace, inferred facts.
--
-- Replaces the static form. Questions are chosen at runtime by expected
-- information gain, so there is no authored question list to store — what must
-- be stored is WHY each question was chosen, so that "why did it ask me that?"
-- has an answer in the data.
--
-- Every step records the candidate count before and after and the information
-- gain that justified the choice. With the session seed, the trace replays
-- identically, the same guarantee the SPRT assessment sessions carry.
--
-- rollback:
--   DROP TABLE praxis.diagnostic_inferred_fact;
--   DROP TABLE praxis.diagnostic_step;
--   DROP TABLE praxis.diagnostic_session;
--   Session history cannot be preserved by the pre-030 schema; export first.

CREATE TABLE praxis.diagnostic_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE RESTRICT,
  -- 'target' narrows the ESCO occupation space; 'skills' profiles the chosen
  -- role's skills. Both run on the same information-gain engine.
  flow text NOT NULL CHECK (flow IN ('target', 'skills')),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'resolved', 'unresolved', 'abandoned')),
  -- Seeds the deterministic tie-break so a replay asks the same questions.
  rng_seed text NOT NULL,
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  -- The role being profiled, for the skills flow.
  role_id text REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  candidate_space_initial integer NOT NULL CHECK (candidate_space_initial >= 0),
  initial_entropy numeric(10,6) NOT NULL CHECK (initial_entropy >= 0),
  question_budget smallint NOT NULL CHECK (question_budget BETWEEN 1 AND 40),
  confidence_threshold numeric(4,3) NOT NULL
    CHECK (confidence_threshold > 0 AND confidence_threshold <= 1),
  -- Set only on a resolved session. Never written by a silent guess.
  resolved_entity_id text,
  resolved_confidence numeric(6,5)
    CHECK (resolved_confidence IS NULL
           OR (resolved_confidence >= 0 AND resolved_confidence <= 1)),
  stop_reason text CHECK (stop_reason IN (
    'confident', 'budget_exhausted', 'no_informative_question', 'user_accepted'
  )),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT diagnostic_session_resolution_consistent CHECK (
    (status <> 'resolved') OR
    (resolved_entity_id IS NOT NULL AND resolved_confidence IS NOT NULL
     AND stop_reason IS NOT NULL AND ended_at IS NOT NULL)
  ),
  CONSTRAINT diagnostic_session_role_required_for_skills CHECK (
    flow <> 'skills' OR role_id IS NOT NULL
  )
);

CREATE INDEX diagnostic_session_learner_idx
  ON praxis.diagnostic_session (learner_id, started_at DESC);

COMMENT ON TABLE praxis.diagnostic_session IS
  'One adaptive diagnostic run. Questions are computed, never authored.';

-- ---------------------------------------------------------------------------
-- The decision trace. One row per question actually put to the learner.
-- ---------------------------------------------------------------------------
CREATE TABLE praxis.diagnostic_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES praxis.diagnostic_session(id) ON DELETE RESTRICT,
  step_index smallint NOT NULL CHECK (step_index >= 0),
  question_id text NOT NULL,
  -- What the question was about: an ISCO branch, a skill uri, a ROME flag.
  question_facet text NOT NULL,
  question_prompt_fr text NOT NULL,
  -- The offered options, so the trace is readable without recomputing.
  question_options jsonb NOT NULL
    CHECK (jsonb_typeof(question_options) = 'array'),
  candidates_before integer NOT NULL CHECK (candidates_before >= 0),
  candidates_after integer CHECK (candidates_after >= 0),
  -- The expected entropy reduction, in bits, that justified asking this.
  information_gain numeric(10,6) NOT NULL CHECK (information_gain >= 0),
  entropy_before numeric(10,6) NOT NULL CHECK (entropy_before >= 0),
  entropy_after numeric(10,6) CHECK (entropy_after >= 0),
  answer text,
  -- 'unknown' and 'skip' are answers, not failures: they carry no evidence but
  -- they are recorded, because abandonment analysis needs them.
  answered_at timestamptz,
  -- Set when the learner backtracks past this step. The row is never deleted:
  -- an undone answer is part of the trace.
  undone_at timestamptz,
  asked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, step_index)
);

CREATE INDEX diagnostic_step_session_idx
  ON praxis.diagnostic_step (session_id, step_index);

COMMENT ON COLUMN praxis.diagnostic_step.information_gain IS
  'Expected entropy reduction in bits that justified choosing this question.';

-- ---------------------------------------------------------------------------
-- Facts the engine inferred rather than asked. Propagating an answer down the
-- hierarchy constrains children; those are recorded here at lower confidence
-- than a direct answer, visibly marked, one tap to correct.
-- ---------------------------------------------------------------------------
CREATE TABLE praxis.diagnostic_inferred_fact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL
    REFERENCES praxis.diagnostic_session(id) ON DELETE RESTRICT,
  -- The skill or occupation the inference is about.
  entity_id text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('occupation', 'skill')),
  inferred_value text NOT NULL,
  -- Where it came from: a broader answer, or a CV fact that pre-answered it.
  source text NOT NULL CHECK (source IN ('hierarchy_propagation', 'cv_fact')),
  source_step_index smallint,
  -- Strictly below a direct answer's confidence; enforced, not merely intended.
  confidence numeric(4,3) NOT NULL CHECK (confidence > 0 AND confidence < 1),
  corrected_at timestamptz,
  corrected_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, entity_id)
);

CREATE INDEX diagnostic_inferred_fact_session_idx
  ON praxis.diagnostic_inferred_fact (session_id);

COMMENT ON TABLE praxis.diagnostic_inferred_fact IS
  'Answers the engine derived rather than asked. Always correctable, always below direct-answer confidence.';
