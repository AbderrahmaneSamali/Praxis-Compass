-- Register generated ROME starting actions before a learner selects one.
-- The registry preserves the action that was actually offered at selection time.
CREATE TABLE praxis.rome_development_action (
  action_id text NOT NULL,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('project','practice','reflection','conversation','evidence_check')),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (action_id, code_rome)
);

ALTER TABLE praxis.exploration_selected_rome_action
  ADD CONSTRAINT exploration_selected_rome_action_registry_fk
  FOREIGN KEY (action_id, code_rome)
  REFERENCES praxis.rome_development_action(action_id, code_rome) ON DELETE RESTRICT;
