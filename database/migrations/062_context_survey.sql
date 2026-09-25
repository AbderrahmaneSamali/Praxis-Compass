-- Branching career-context survey.
-- The survey rules live in src/survey; this
-- migration registers the question ids of survey version
-- praxis-context-survey-v2 so every stored answer references a real question.
-- Answers are append-only: a changed answer inserts a new row, and "back"
-- only stamps undone_at. The learner_context snapshot a survey produces is
-- written by the standalone service and linked here.
--
-- rollback:
--   DROP TRIGGER IF EXISTS context_survey_answer_immutable_update ON praxis.context_survey_answer;
--   DROP FUNCTION IF EXISTS praxis.guard_context_survey_answer_update();
--   DROP TABLE IF EXISTS praxis.context_survey_answer;
--   DROP TABLE IF EXISTS praxis.context_survey_session;
--   DROP TABLE IF EXISTS praxis.context_survey_question;
--   DROP TABLE IF EXISTS praxis.context_survey_version;
--   learner_context rows written by completed surveys are ordinary snapshots
--   and stay valid after rollback. Export survey answers first if they must be kept.

CREATE TABLE praxis.context_survey_version (
  version text PRIMARY KEY CHECK (version ~ '^praxis-context-survey-v[0-9]+$'),
  registered_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO praxis.context_survey_version (version) VALUES ('praxis-context-survey-v2');

CREATE TABLE praxis.context_survey_question (
  survey_version text NOT NULL REFERENCES praxis.context_survey_version(version),
  question_id text NOT NULL CHECK (question_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  section text NOT NULL CHECK (section IN (
    'project', 'time', 'practice'
  )),
  context_field text CHECK (context_field IN (
    'motivation', 'situation', 'deadline', 'time'
  )),
  PRIMARY KEY (survey_version, question_id)
);

INSERT INTO praxis.context_survey_question (survey_version, question_id, section, context_field)
VALUES
  ('praxis-context-survey-v2', 'motivation', 'project', 'motivation'),
  ('praxis-context-survey-v2', 'situation', 'project', 'situation'),
  ('praxis-context-survey-v2', 'hours_per_week', 'time', 'time'),
  ('praxis-context-survey-v2', 'deadline', 'time', 'deadline'),
  ('praxis-context-survey-v2', 'practice_level', 'practice', NULL),
  ('praxis-context-survey-v2', 'recent_work_example', 'practice', NULL);

CREATE TABLE praxis.context_survey_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  survey_version text NOT NULL REFERENCES praxis.context_survey_version(version),
  algorithm_version text NOT NULL,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[a-f0-9]{64}$'),
  -- The target the survey wording refers to, when the learner chose a role.
  role_id text REFERENCES praxis.occupation(id) ON DELETE RESTRICT,
  rome_code character(5) REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  role_label text CHECK (length(role_label) <= 500),
  goal_kind text NOT NULL CHECK (goal_kind IN ('role', 'task')),
  goal_text text CHECK (length(goal_text) <= 1000),
  -- The date every relative option (in 3 months...) is computed from.
  survey_date date NOT NULL,
  prior_context_id uuid REFERENCES praxis.learner_context(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  resulting_context_id uuid REFERENCES praxis.learner_context(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id, survey_version),
  CHECK (role_id IS NULL OR rome_code IS NULL),
  CHECK (goal_kind <> 'task' OR length(trim(goal_text)) > 0),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX context_survey_session_learner_idx
  ON praxis.context_survey_session (learner_id, started_at DESC);
CREATE UNIQUE INDEX context_survey_session_one_active_idx
  ON praxis.context_survey_session (learner_id) WHERE status='in_progress';

CREATE TABLE praxis.context_survey_answer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  survey_version text NOT NULL,
  question_id text NOT NULL,
  sequence smallint NOT NULL CHECK (sequence >= 0),
  value jsonb,
  declined boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('learner', 'prior_context')),
  -- Exactly what the learner saw, so the trace is readable without replay.
  prompt_fr text NOT NULL,
  -- [{questionId, answerLabelFr, source}] that made this question appear.
  triggered_by jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(triggered_by) = 'array'),
  answered_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  FOREIGN KEY (session_id, survey_version)
    REFERENCES praxis.context_survey_session (id, survey_version) ON DELETE CASCADE,
  FOREIGN KEY (survey_version, question_id)
    REFERENCES praxis.context_survey_question (survey_version, question_id),
  UNIQUE (session_id, sequence),
  CHECK (declined = (value IS NULL)),
  CHECK (value IS NULL OR jsonb_typeof(value) IN ('string', 'number', 'array'))
);

CREATE INDEX context_survey_answer_active_idx
  ON praxis.context_survey_answer (session_id, sequence)
  WHERE undone_at IS NULL;

CREATE OR REPLACE FUNCTION praxis.guard_context_survey_answer_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.undone_at IS NOT NULL OR NEW.undone_at IS NULL
     OR to_jsonb(NEW) - 'undone_at' IS DISTINCT FROM to_jsonb(OLD) - 'undone_at' THEN
    RAISE EXCEPTION 'context_survey_answer is immutable except for first undone_at assignment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_survey_answer_immutable_update
BEFORE UPDATE ON praxis.context_survey_answer
FOR EACH ROW EXECUTE FUNCTION praxis.guard_context_survey_answer_update();

COMMENT ON TABLE praxis.context_survey_session IS
  'One run of the branching context survey. Completion writes a learner_context snapshot through the validated context endpoint.';
COMMENT ON TABLE praxis.context_survey_answer IS
  'Append-only survey answers. The latest non-undone row per question wins; inferred answers are recomputed, never stored.';
