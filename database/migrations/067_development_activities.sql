-- Versioned exercises extend the legacy title-only action registry.
CREATE TABLE praxis.development_activity (
 id text PRIMARY KEY, activity_key text NOT NULL, version integer NOT NULL CHECK(version>0),
 title_fr text NOT NULL CHECK(btrim(title_fr)<>''), purpose_fr text NOT NULL CHECK(btrim(purpose_fr)<>''),
 output_fr text NOT NULL CHECK(btrim(output_fr)<>''), limitations_fr text NOT NULL CHECK(btrim(limitations_fr)<>''),
 estimated_minutes integer NOT NULL CHECK(estimated_minutes BETWEEN 1 AND 1440),
 materials jsonb NOT NULL CHECK(jsonb_typeof(materials)='object'),
 authored_by text NOT NULL CHECK(btrim(authored_by)<>''),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pilot','reviewed','retired')),
 content_hash text, reviewed_by text, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(activity_key,version),
 CHECK(status='draft' OR content_hash ~ '^[a-f0-9]{64}$' AND content_hash IS NOT NULL),
 CHECK(status<>'reviewed' OR (reviewed_by IS NOT NULL AND btrim(reviewed_by)<>'' AND reviewed_by<>authored_by AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX development_activity_current ON praxis.development_activity(activity_key) WHERE status IN ('pilot','reviewed');
ALTER TABLE praxis.rome_development_action ADD COLUMN activity_version_id text REFERENCES praxis.development_activity(id);

CREATE TABLE praxis.development_activity_source (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id), id text NOT NULL,
 title text NOT NULL, publisher text NOT NULL, url text CHECK(url ~ '^https://'),
 reference text NOT NULL, kind text NOT NULL CHECK(kind IN ('authored_exercise','occupation_catalog','reviewed_framework')),
 limitations_fr text NOT NULL, PRIMARY KEY(activity_id,id)
);
CREATE TABLE praxis.development_activity_scope (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id),
 code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome),
 market_code text NOT NULL REFERENCES praxis.career_market(code), source_id text NOT NULL,
 PRIMARY KEY(activity_id,code_rome,market_code),
 FOREIGN KEY(activity_id,source_id) REFERENCES praxis.development_activity_source(activity_id,id)
);
CREATE TABLE praxis.development_activity_skill (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id), skill_ogr bigint NOT NULL REFERENCES praxis.rome_ogr_entities(code_ogr),
 label_fr text NOT NULL, source_id text NOT NULL, PRIMARY KEY(activity_id,skill_ogr),
 FOREIGN KEY(activity_id,source_id) REFERENCES praxis.development_activity_source(activity_id,id)
);
CREATE TABLE praxis.development_activity_step (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id), code text NOT NULL,
 position integer NOT NULL CHECK(position>0), instruction_fr text NOT NULL CHECK(btrim(instruction_fr)<>''),
 PRIMARY KEY(activity_id,code), UNIQUE(activity_id,position)
);
CREATE TABLE praxis.development_activity_prerequisite (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id), code text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('activity_passed','declared_practice')),
 required_activity_id text REFERENCES praxis.development_activity(id), skill_ogr bigint REFERENCES praxis.rome_ogr_entities(code_ogr),
 label_fr text NOT NULL, rationale_fr text NOT NULL, source_id text NOT NULL,
 PRIMARY KEY(activity_id,code), CHECK(activity_id IS DISTINCT FROM required_activity_id),
 CHECK((kind='activity_passed' AND required_activity_id IS NOT NULL AND skill_ogr IS NULL)
    OR (kind='declared_practice' AND skill_ogr IS NOT NULL AND required_activity_id IS NULL)),
 FOREIGN KEY(activity_id,source_id) REFERENCES praxis.development_activity_source(activity_id,id)
);
CREATE TABLE praxis.development_activity_criterion (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id), code text NOT NULL,
 position integer NOT NULL CHECK(position>0), label_fr text NOT NULL, prompt_fr text NOT NULL,
 expected_behavior_fr text NOT NULL, source_id text NOT NULL,
 PRIMARY KEY(activity_id,code), UNIQUE(activity_id,position),
 FOREIGN KEY(activity_id,source_id) REFERENCES praxis.development_activity_source(activity_id,id)
);
CREATE TABLE praxis.development_activity_option (
 activity_id text NOT NULL, criterion_code text NOT NULL, code text NOT NULL,
 position integer NOT NULL CHECK(position>0), label_fr text NOT NULL, is_correct boolean NOT NULL,
 feedback_fr text NOT NULL, PRIMARY KEY(activity_id,criterion_code,code), UNIQUE(activity_id,criterion_code,position),
 FOREIGN KEY(activity_id,criterion_code) REFERENCES praxis.development_activity_criterion(activity_id,code)
);
-- Explicit links can be prepared for draft frameworks, but learners only receive links to reviewed frameworks.
CREATE TABLE praxis.development_activity_level_target (
 activity_id text NOT NULL REFERENCES praxis.development_activity(id), framework_id text NOT NULL,
 requirement_id text NOT NULL, source_id text NOT NULL,
 PRIMARY KEY(activity_id,framework_id,requirement_id),
 FOREIGN KEY(framework_id,requirement_id) REFERENCES praxis.career_level_requirement(framework_id,id),
 FOREIGN KEY(activity_id,source_id) REFERENCES praxis.development_activity_source(activity_id,id)
);
CREATE TABLE praxis.development_activity_review (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id text NOT NULL REFERENCES praxis.development_activity(id),
 actor text NOT NULL CHECK(btrim(actor)<>''), decision text NOT NULL CHECK(decision IN ('enable_pilot','approve','reject')),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'), rationale text NOT NULL CHECK(btrim(rationale)<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER development_activity_review_immutable BEFORE UPDATE OR DELETE ON praxis.development_activity_review
 FOR EACH ROW EXECUTE FUNCTION praxis.prevent_source_row_change();

CREATE FUNCTION praxis.guard_activity_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE activity_state text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.activity_id<>OLD.activity_id THEN RAISE EXCEPTION 'Activity membership is immutable'; END IF;
 SELECT status INTO activity_state FROM praxis.development_activity WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.activity_id ELSE NEW.activity_id END FOR UPDATE;
 IF activity_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only draft activity content may change'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['source','scope','skill','step','prerequisite','criterion','option','level_target'] LOOP
  EXECUTE format('CREATE TRIGGER activity_content_draft_only BEFORE INSERT OR UPDATE OR DELETE ON praxis.%I FOR EACH ROW EXECUTE FUNCTION praxis.guard_activity_content()','development_activity_'||t);
 END LOOP;
END $$;

CREATE FUNCTION praxis.guard_activity_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.status<>'draft' THEN RAISE EXCEPTION 'New activities start as drafts'; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain activity versions'; END IF;
 IF NEW.id<>OLD.id OR NEW.activity_key<>OLD.activity_key OR NEW.version<>OLD.version THEN RAISE EXCEPTION 'Activity identity is immutable'; END IF;
 IF OLD.status='retired' THEN RAISE EXCEPTION 'Retired activity is immutable'; END IF;
 IF OLD.status IN ('pilot','reviewed') THEN
  IF NEW.status='retired' AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN RETURN NEW; END IF;
  IF NOT(OLD.status='pilot' AND NEW.status='reviewed' AND
    (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at'])=(to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at'])) THEN
   RAISE EXCEPTION 'Published activity content is immutable';
  END IF;
 END IF;
 IF NEW.status<>OLD.status THEN
  IF NEW.status NOT IN ('pilot','reviewed') OR NOT EXISTS(SELECT 1 FROM praxis.development_activity_review r
    WHERE r.activity_id=NEW.id AND r.content_hash=NEW.content_hash
      AND r.decision=CASE WHEN NEW.status='pilot' THEN 'enable_pilot' ELSE 'approve' END
      AND (NEW.status='pilot' OR r.actor=NEW.reviewed_by)) THEN RAISE EXCEPTION 'A matching recorded publication decision is required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM praxis.development_activity_scope WHERE activity_id=NEW.id)
    OR NOT EXISTS(SELECT 1 FROM praxis.development_activity_skill WHERE activity_id=NEW.id)
    OR NOT EXISTS(SELECT 1 FROM praxis.development_activity_step WHERE activity_id=NEW.id)
    OR NOT EXISTS(SELECT 1 FROM praxis.development_activity_criterion WHERE activity_id=NEW.id) THEN RAISE EXCEPTION 'Activity needs scope, skills, steps and assessment criteria'; END IF;
  IF EXISTS(SELECT 1 FROM praxis.development_activity_criterion c WHERE c.activity_id=NEW.id AND
    ((SELECT count(*) FROM praxis.development_activity_option o WHERE o.activity_id=c.activity_id AND o.criterion_code=c.code)<2
      OR NOT EXISTS(SELECT 1 FROM praxis.development_activity_option o WHERE o.activity_id=c.activity_id AND o.criterion_code=c.code AND o.is_correct)
      OR NOT EXISTS(SELECT 1 FROM praxis.development_activity_option o WHERE o.activity_id=c.activity_id AND o.criterion_code=c.code AND NOT o.is_correct))) THEN
   RAISE EXCEPTION 'Every criterion needs correct and incorrect choices'; END IF;
  IF EXISTS(SELECT 1 FROM praxis.development_activity_prerequisite p JOIN praxis.development_activity_scope s ON s.activity_id=p.activity_id
    WHERE p.activity_id=NEW.id AND p.kind='activity_passed' AND NOT EXISTS(
     SELECT 1 FROM praxis.development_activity a JOIN praxis.development_activity_scope ps ON ps.activity_id=a.id
      WHERE a.id=p.required_activity_id AND a.status IN ('pilot','reviewed') AND (NEW.status<>'reviewed' OR a.status='reviewed')
        AND ps.code_rome=s.code_rome AND ps.market_code=s.market_code)) THEN RAISE EXCEPTION 'Prerequisite unavailable for an activity scope'; END IF;
  IF EXISTS(WITH RECURSIVE chain(id,path,cycle) AS (
    SELECT required_activity_id,ARRAY[activity_id,required_activity_id],activity_id=required_activity_id
      FROM praxis.development_activity_prerequisite WHERE activity_id=NEW.id AND kind='activity_passed'
    UNION ALL SELECT p.required_activity_id,c.path||p.required_activity_id,p.required_activity_id=ANY(c.path)
      FROM chain c JOIN praxis.development_activity_prerequisite p ON p.activity_id=c.id AND p.kind='activity_passed' WHERE NOT c.cycle
   ) SELECT 1 FROM chain WHERE cycle) THEN RAISE EXCEPTION 'Activity prerequisites contain a cycle'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER development_activity_state BEFORE INSERT OR UPDATE OR DELETE ON praxis.development_activity
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_activity_state();

CREATE TABLE praxis.learner_activity_start (
 learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
 activity_id text NOT NULL, code_rome character(5) NOT NULL, market_code text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(learner_id,activity_id,code_rome,market_code),
 FOREIGN KEY(activity_id,code_rome,market_code) REFERENCES praxis.development_activity_scope(activity_id,code_rome,market_code)
);
CREATE TABLE praxis.development_activity_attempt (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
 activity_id text NOT NULL, code_rome character(5) NOT NULL, market_code text NOT NULL,
 request_key uuid NOT NULL, input_hash text NOT NULL, content_hash text NOT NULL,
 prerequisite_snapshot jsonb NOT NULL, outcome text NOT NULL CHECK(outcome IN ('passed','needs_practice')),
 met_count integer NOT NULL CHECK(met_count>=0), total_count integer NOT NULL CHECK(total_count>0 AND met_count<=total_count),
 submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(learner_id,request_key), UNIQUE(id,activity_id),
 CHECK((outcome='passed')=(met_count=total_count)),
 FOREIGN KEY(learner_id,activity_id,code_rome,market_code) REFERENCES praxis.learner_activity_start(learner_id,activity_id,code_rome,market_code) ON DELETE CASCADE
);
CREATE INDEX activity_attempt_progress ON praxis.development_activity_attempt(learner_id,code_rome,market_code,activity_id,submitted_at DESC);
CREATE TABLE praxis.development_activity_answer (
 attempt_id uuid NOT NULL, activity_id text NOT NULL, criterion_code text NOT NULL, option_code text NOT NULL, criterion_met boolean NOT NULL,
 PRIMARY KEY(attempt_id,criterion_code),
 FOREIGN KEY(attempt_id,activity_id) REFERENCES praxis.development_activity_attempt(id,activity_id) ON DELETE CASCADE,
 FOREIGN KEY(activity_id,criterion_code,option_code) REFERENCES praxis.development_activity_option(activity_id,criterion_code,code)
);
CREATE FUNCTION praxis.guard_activity_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM praxis.learner WHERE id=OLD.learner_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Activity attempts are append-only; learner erasure can cascade';
END; $$;
CREATE TRIGGER activity_attempt_immutable BEFORE UPDATE OR DELETE ON praxis.development_activity_attempt
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_activity_attempt();
CREATE FUNCTION praxis.guard_activity_answer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM praxis.development_activity_attempt WHERE id=OLD.attempt_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Activity answers are append-only';
END; $$;
CREATE TRIGGER activity_answer_immutable BEFORE UPDATE OR DELETE ON praxis.development_activity_answer
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_activity_answer();
