-- Release-scoped, proposal-only task-network crosswalks.
-- Algorithmic scores and direction suggestions are immutable evidence. Only an
-- independent expert review can create an adjudicated relation, and no trigger
-- copies that relation into any canonical taxonomy or recommendation table.

CREATE TABLE praxis.source_task_network_node (
  id uuid PRIMARY KEY,
  source_release_id uuid NOT NULL,
  source_system text NOT NULL CHECK (source_system IN ('esco','rome','onet')),
  entity_kind text NOT NULL CHECK (entity_kind IN ('esco_skill','rome_competence','onet_task')),
  source_entity_id text NOT NULL,
  primary_label text NOT NULL CHECK (primary_label <> ''),
  texts jsonb NOT NULL CHECK (jsonb_typeof(texts) = 'array' AND jsonb_array_length(texts) > 0),
  occupation_anchor_ids text[] NOT NULL,
  skill_anchor_ids text[] NOT NULL,
  network_context_ids text[] NOT NULL,
  node_hash text NOT NULL CHECK (node_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (source_release_id,source_system)
    REFERENCES praxis.source_releases(id,source) ON DELETE RESTRICT,
  UNIQUE (source_release_id,entity_kind,source_entity_id),
  CHECK ((source_system='esco' AND entity_kind='esco_skill')
      OR (source_system='rome' AND entity_kind='rome_competence')
      OR (source_system='onet' AND entity_kind='onet_task'))
);

CREATE TABLE praxis.task_network_crosswalk_run (
  id uuid PRIMARY KEY,
  source_system text NOT NULL CHECK (source_system IN ('esco','rome','onet')),
  target_system text NOT NULL CHECK (target_system IN ('esco','rome','onet')),
  source_release_id uuid NOT NULL,
  target_release_id uuid NOT NULL,
  algorithm_version text NOT NULL,
  policy_version text NOT NULL,
  generated_by_principal text NOT NULL,
  inputs_hash text NOT NULL UNIQUE CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  result_hash text NOT NULL UNIQUE CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (source_release_id,source_system)
    REFERENCES praxis.source_releases(id,source) ON DELETE RESTRICT,
  FOREIGN KEY (target_release_id,target_system)
    REFERENCES praxis.source_releases(id,source) ON DELETE RESTRICT,
  CHECK (source_system <> target_system),
  CHECK (source_release_id <> target_release_id)
);

CREATE TABLE praxis.task_network_crosswalk_candidate (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES praxis.task_network_crosswalk_run(id) ON DELETE RESTRICT,
  source_node_id uuid NOT NULL REFERENCES praxis.source_task_network_node(id) ON DELETE RESTRICT,
  target_node_id uuid NOT NULL REFERENCES praxis.source_task_network_node(id) ON DELETE RESTRICT,
  candidate_rank integer NOT NULL CHECK (candidate_rank > 0),
  score numeric(12,10) NOT NULL CHECK (score BETWEEN 0 AND 1),
  score_components jsonb NOT NULL CHECK (jsonb_typeof(score_components) = 'object'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  suggested_relation text NOT NULL CHECK (suggested_relation IN (
    'equivalent','source_narrower','source_broader','related'
  )),
  quality_flags text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id,source_node_id,candidate_rank),
  UNIQUE (run_id,source_node_id,target_node_id),
  UNIQUE (id,run_id,source_node_id),
  CHECK (source_node_id <> target_node_id)
);

CREATE TABLE praxis.task_network_crosswalk_outcome (
  run_id uuid NOT NULL REFERENCES praxis.task_network_crosswalk_run(id) ON DELETE RESTRICT,
  source_node_id uuid NOT NULL REFERENCES praxis.source_task_network_node(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('proposed','nil','abstained')),
  reason text NOT NULL CHECK (reason IN (
    'candidate_clear','no_plausible_candidate','score_below_proposal_threshold','ambiguous_margin'
  )),
  selected_candidate_id uuid,
  top_score numeric(12,10) CHECK (top_score BETWEEN 0 AND 1),
  runner_up_score numeric(12,10) CHECK (runner_up_score BETWEEN 0 AND 1),
  score_margin numeric(12,10) CHECK (score_margin BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id,source_node_id),
  FOREIGN KEY (selected_candidate_id,run_id,source_node_id)
    REFERENCES praxis.task_network_crosswalk_candidate(id,run_id,source_node_id) ON DELETE RESTRICT,
  CHECK ((decision='proposed') = (selected_candidate_id IS NOT NULL)),
  CHECK ((decision='nil') = (top_score IS NULL)),
  CHECK ((decision='proposed' AND reason='candidate_clear')
      OR (decision='nil' AND reason='no_plausible_candidate')
      OR (decision='abstained' AND reason IN ('score_below_proposal_threshold','ambiguous_margin')))
);

CREATE TABLE praxis.task_network_crosswalk_review (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES praxis.task_network_crosswalk_candidate(id) ON DELETE RESTRICT,
  reviewer_principal text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','needs_revision')),
  reviewed_relation text CHECK (reviewed_relation IN (
    'equivalent','source_narrower','source_broader','related'
  )),
  rationale text NOT NULL CHECK (rationale <> ''),
  review_checklist jsonb NOT NULL CHECK (jsonb_typeof(review_checklist) = 'object'),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((decision='approved') = (reviewed_relation IS NOT NULL)),
  CHECK (decision <> 'approved' OR (
    coalesce((review_checklist->>'semanticScopeChecked')::boolean,false)
    AND coalesce((review_checklist->>'occupationContextChecked')::boolean,false)
    AND coalesce((review_checklist->>'directionChecked')::boolean,false)
    AND coalesce((review_checklist->>'sourceReleaseChecked')::boolean,false)
  ))
);

CREATE OR REPLACE FUNCTION praxis.guard_task_crosswalk_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Task-network nodes, proposals, outcomes, and reviews are append-only';
END;
$$;

CREATE TRIGGER source_task_network_node_immutable
BEFORE UPDATE OR DELETE ON praxis.source_task_network_node
FOR EACH ROW EXECUTE FUNCTION praxis.guard_task_crosswalk_history();
CREATE TRIGGER task_network_crosswalk_run_immutable
BEFORE UPDATE OR DELETE ON praxis.task_network_crosswalk_run
FOR EACH ROW EXECUTE FUNCTION praxis.guard_task_crosswalk_history();
CREATE TRIGGER task_network_crosswalk_candidate_immutable
BEFORE UPDATE OR DELETE ON praxis.task_network_crosswalk_candidate
FOR EACH ROW EXECUTE FUNCTION praxis.guard_task_crosswalk_history();
CREATE TRIGGER task_network_crosswalk_outcome_immutable
BEFORE UPDATE OR DELETE ON praxis.task_network_crosswalk_outcome
FOR EACH ROW EXECUTE FUNCTION praxis.guard_task_crosswalk_history();
CREATE TRIGGER task_network_crosswalk_review_immutable
BEFORE UPDATE OR DELETE ON praxis.task_network_crosswalk_review
FOR EACH ROW EXECUTE FUNCTION praxis.guard_task_crosswalk_history();

CREATE OR REPLACE FUNCTION praxis.enforce_independent_task_crosswalk_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generator text;
BEGIN
  SELECT run.generated_by_principal INTO generator
  FROM praxis.task_network_crosswalk_candidate candidate
  JOIN praxis.task_network_crosswalk_run run ON run.id=candidate.run_id
  WHERE candidate.id=NEW.candidate_id;
  IF generator=NEW.reviewer_principal THEN
    RAISE EXCEPTION 'Task crosswalk review must be independent of proposal generation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_network_crosswalk_review_independent
BEFORE INSERT ON praxis.task_network_crosswalk_review
FOR EACH ROW EXECUTE FUNCTION praxis.enforce_independent_task_crosswalk_review();

-- Deliberately hides rank, score, score components, and the model-suggested
-- relation so reviewers classify the pair rather than rubber-stamp the model.
CREATE VIEW praxis.task_network_crosswalk_blinded_review_queue
WITH (security_barrier = true) AS
SELECT candidate.id AS candidate_id,
       source.source_system AS source_system,
       source.source_release_id AS source_release_id,
       source.entity_kind AS source_entity_kind,
       source.source_entity_id AS source_entity_id,
       source.primary_label AS source_label,
       source.texts AS source_texts,
       source.occupation_anchor_ids AS source_occupation_anchor_ids,
       source.skill_anchor_ids AS source_skill_anchor_ids,
       source.network_context_ids AS source_network_context_ids,
       target.source_system AS target_system,
       target.source_release_id AS target_release_id,
       target.entity_kind AS target_entity_kind,
       target.source_entity_id AS target_entity_id,
       target.primary_label AS target_label,
       target.texts AS target_texts,
       target.occupation_anchor_ids AS target_occupation_anchor_ids,
       target.skill_anchor_ids AS target_skill_anchor_ids,
       target.network_context_ids AS target_network_context_ids,
       latest.decision AS latest_review_decision
FROM praxis.task_network_crosswalk_candidate candidate
JOIN praxis.source_task_network_node source ON source.id=candidate.source_node_id
JOIN praxis.source_task_network_node target ON target.id=candidate.target_node_id
LEFT JOIN LATERAL (
  SELECT review.decision
  FROM praxis.task_network_crosswalk_review review
  WHERE review.candidate_id=candidate.id
  ORDER BY review.created_at DESC,review.id DESC
  LIMIT 1
) latest ON true;

CREATE VIEW praxis.reviewed_task_network_crosswalk
WITH (security_barrier = true) AS
SELECT candidate.id AS candidate_id,
       candidate.source_node_id,candidate.target_node_id,
       latest.reviewed_relation,latest.reviewer_principal,latest.reviewed_at
FROM praxis.task_network_crosswalk_candidate candidate
JOIN LATERAL (
  SELECT review.decision,review.reviewed_relation,review.reviewer_principal,review.reviewed_at
  FROM praxis.task_network_crosswalk_review review
  WHERE review.candidate_id=candidate.id
  ORDER BY review.created_at DESC,review.id DESC
  LIMIT 1
) latest ON latest.decision='approved';

COMMENT ON TABLE praxis.task_network_crosswalk_candidate IS
  'Algorithmic task-pair candidates only. Scores and suggested direction are evidence, never authoritative mappings.';
COMMENT ON VIEW praxis.task_network_crosswalk_blinded_review_queue IS
  'Human review surface that suppresses model rank, score, and relation suggestion to reduce automation bias.';
COMMENT ON VIEW praxis.reviewed_task_network_crosswalk IS
  'Latest independently approved task-pair judgments. Many-to-many and directional; never a proficiency claim or recommendation edge.';
