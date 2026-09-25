-- Metadata-only trace for the read-only career comparison gateway.
-- No prompts, profile text, work examples, or model output are stored here.
CREATE TABLE praxis.agent_gateway_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation = 'compare_directions'),
  policy_version text NOT NULL CHECK (policy_version = 'praxis-agent-gateway-v1'),
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('succeeded','rejected','failed')),
  tool_count smallint NOT NULL CHECK (tool_count BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, learner_id)
);

CREATE INDEX agent_gateway_request_learner_idx
  ON praxis.agent_gateway_request (learner_id, created_at DESC);

CREATE TABLE praxis.agent_gateway_tool_call (
  request_id uuid NOT NULL,
  learner_id uuid NOT NULL,
  sequence smallint NOT NULL CHECK (sequence BETWEEN 1 AND 5),
  tool_name text NOT NULL CHECK (tool_name IN
    ('get_candidate_directions','get_requirement_states','get_reviewed_sources','get_career_context')),
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed')),
  elapsed_ms integer NOT NULL CHECK (elapsed_ms >= 0),
  PRIMARY KEY (request_id, sequence),
  FOREIGN KEY (request_id, learner_id) REFERENCES praxis.agent_gateway_request (id, learner_id) ON DELETE CASCADE
);
