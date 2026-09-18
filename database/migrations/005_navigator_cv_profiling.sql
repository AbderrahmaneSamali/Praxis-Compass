CREATE TABLE IF NOT EXISTS praxis.navigator_cv_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key text NOT NULL CHECK (length(session_key) BETWEEN 16 AND 128),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'extracted'
    CHECK (status IN ('extracted', 'validated', 'failed')),
  parser_version text NOT NULL,
  retention_policy text NOT NULL DEFAULT 'delete_after_extraction'
    CHECK (retention_policy = 'delete_after_extraction'),
  consented_at timestamptz NOT NULL,
  raw_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_key, sha256)
);

CREATE INDEX IF NOT EXISTS navigator_cv_documents_session_idx
  ON praxis.navigator_cv_documents (session_key, created_at DESC);

CREATE TABLE IF NOT EXISTS praxis.navigator_cv_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_document_id uuid NOT NULL
    REFERENCES praxis.navigator_cv_documents(id) ON DELETE CASCADE,
  fact_type text NOT NULL CHECK (fact_type IN (
    'education', 'experience_duration', 'role_experience',
    'project_experience', 'tool_experience', 'skill_experience'
  )),
  raw_text text NOT NULL CHECK (length(raw_text) BETWEEN 1 AND 1000),
  normalized_object_id text,
  extraction_confidence text NOT NULL
    CHECK (extraction_confidence IN ('high', 'medium', 'low')),
  user_action text NOT NULL DEFAULT 'pending'
    CHECK (user_action IN ('pending', 'confirm', 'correct', 'ignore')),
  corrected_text text,
  evidence_type text NOT NULL DEFAULT 'cv_extracted'
    CHECK (evidence_type IN ('cv_extracted', 'cv_confirmed', 'cv_corrected', 'cv_ignored')),
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS navigator_cv_facts_document_idx
  ON praxis.navigator_cv_facts (cv_document_id, user_action, fact_type);

COMMENT ON TABLE praxis.navigator_cv_documents IS
  'Navigator CV intake metadata. Raw files are processed in memory and are not persisted.';
COMMENT ON TABLE praxis.navigator_cv_facts IS
  'Structured CV facts requiring explicit confirm, correct, or ignore action before diagnostic use.';

DROP TRIGGER IF EXISTS navigator_cv_documents_touch_updated_at
  ON praxis.navigator_cv_documents;
CREATE TRIGGER navigator_cv_documents_touch_updated_at
BEFORE UPDATE ON praxis.navigator_cv_documents
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

DROP TRIGGER IF EXISTS navigator_cv_facts_touch_updated_at
  ON praxis.navigator_cv_facts;
CREATE TRIGGER navigator_cv_facts_touch_updated_at
BEFORE UPDATE ON praxis.navigator_cv_facts
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();
