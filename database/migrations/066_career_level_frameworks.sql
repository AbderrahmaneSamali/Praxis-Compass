-- Career levels are reviewed overlays, separate from source occupation classifications.
CREATE TABLE praxis.career_market (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  label_fr text NOT NULL CHECK (btrim(label_fr) <> '')
);
INSERT INTO praxis.career_market VALUES ('FR','France'),('MA','Maroc');

CREATE TABLE praxis.career_track (
  code text PRIMARY KEY,
  label_fr text NOT NULL,
  description_fr text NOT NULL,
  display_order integer NOT NULL UNIQUE
);
INSERT INTO praxis.career_track VALUES
 ('expertise','Expertise métier','Approfondir sa pratique et devenir une référence dans son métier.',1),
 ('project_leadership','Pilotage de projets','Coordonner un projet et des contributeurs sans supposer un rôle de manager hiérarchique.',2),
 ('management','Management','Encadrer des personnes et assumer les responsabilités d’une équipe.',3);

CREATE TABLE praxis.career_family (
  id text PRIMARY KEY,
  domain_code text NOT NULL UNIQUE REFERENCES praxis.rome_professional_domains(domain_code),
  label_fr text NOT NULL
);
-- Migrations also run before source ingestion. The draft importer adds these families after ingestion.
INSERT INTO praxis.career_family
 SELECT v.id,v.domain_code,v.label_fr FROM (VALUES ('banking','C12','Banque'),('finance','C13','Finance')) AS v(id,domain_code,label_fr)
 WHERE EXISTS (SELECT 1 FROM praxis.rome_professional_domains d WHERE d.domain_code=v.domain_code);

CREATE TABLE praxis.career_framework (
  id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES praxis.career_family(id),
  market_code text NOT NULL REFERENCES praxis.career_market(code),
  version integer NOT NULL CHECK (version > 0),
  title_fr text NOT NULL CHECK (btrim(title_fr) <> ''),
  scope_fr text NOT NULL CHECK (btrim(scope_fr) <> ''),
  limitations_fr text NOT NULL CHECK (btrim(limitations_fr) <> ''),
  authored_by text NOT NULL CHECK (btrim(authored_by) <> ''),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','retired')),
  reviewed_by text, reviewed_at timestamptz, content_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (market_code,family_id,version), UNIQUE (id,market_code),
  CHECK ((status='draft' AND reviewed_by IS NULL AND reviewed_at IS NULL AND content_hash IS NULL)
    OR (status IN ('reviewed','retired') AND reviewed_by IS NOT NULL AND btrim(reviewed_by) <> '' AND reviewed_by <> authored_by
        AND reviewed_at IS NOT NULL AND content_hash IS NOT NULL AND content_hash ~ '^[a-f0-9]{64}$'))
);
CREATE UNIQUE INDEX career_framework_one_reviewed ON praxis.career_framework(market_code,family_id) WHERE status='reviewed';

CREATE TABLE praxis.career_framework_source (
  framework_id text NOT NULL REFERENCES praxis.career_framework(id) ON DELETE CASCADE,
  id text NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  publisher text NOT NULL CHECK (btrim(publisher) <> ''),
  url text CHECK (url ~ '^https://'),
  accessed_on date NOT NULL,
  locator text NOT NULL,
  support_kind text NOT NULL CHECK (support_kind IN ('level_descriptors','occupation_context','career_policy','authored_proposal')),
  reuse_note text NOT NULL,
  limitations_fr text NOT NULL,
  CHECK (url IS NOT NULL OR support_kind='authored_proposal'),
  PRIMARY KEY (framework_id,id)
);

CREATE TABLE praxis.career_level (
  framework_id text NOT NULL REFERENCES praxis.career_framework(id) ON DELETE CASCADE,
  code text NOT NULL,
  track_code text NOT NULL REFERENCES praxis.career_track(code),
  label_fr text NOT NULL CHECK (btrim(label_fr) <> ''),
  display_order integer NOT NULL CHECK (display_order > 0),
  autonomy_fr text NOT NULL CHECK (btrim(autonomy_fr) <> ''),
  scope_fr text NOT NULL CHECK (btrim(scope_fr) <> ''),
  influence_fr text NOT NULL CHECK (btrim(influence_fr) <> ''),
  manages_people boolean NOT NULL,
  basis text NOT NULL CHECK (basis IN ('source_description','editorial_proposal')),
  source_id text NOT NULL,
  PRIMARY KEY (framework_id,code), UNIQUE (framework_id,code,track_code),
  UNIQUE (framework_id,track_code,display_order),
  FOREIGN KEY (framework_id,source_id) REFERENCES praxis.career_framework_source(framework_id,id)
);

-- Applicability is explicit per occupation/level. A family does not confer all levels on all occupations.
CREATE TABLE praxis.career_level_occupation (
  framework_id text NOT NULL, level_code text NOT NULL,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome),
  rationale_fr text NOT NULL CHECK (btrim(rationale_fr) <> ''), source_id text NOT NULL,
  PRIMARY KEY (framework_id,level_code,code_rome),
  FOREIGN KEY (framework_id,level_code) REFERENCES praxis.career_level(framework_id,code) ON DELETE CASCADE,
  FOREIGN KEY (framework_id,source_id) REFERENCES praxis.career_framework_source(framework_id,id)
);

CREATE TABLE praxis.career_level_requirement (
  framework_id text NOT NULL, id text NOT NULL, level_code text NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('skill','autonomy','scope','influence','management')),
  label_fr text NOT NULL CHECK (btrim(label_fr) <> ''),
  expected_behavior_fr text NOT NULL CHECK (btrim(expected_behavior_fr) <> ''),
  skill_ogr bigint REFERENCES praxis.rome_ogr_entities(code_ogr),
  skill_id text REFERENCES praxis.skill(id),
  source_id text NOT NULL,
  PRIMARY KEY (framework_id,id),
  CHECK (NOT (skill_ogr IS NOT NULL AND skill_id IS NOT NULL)),
  CHECK (dimension <> 'skill' OR skill_ogr IS NOT NULL OR skill_id IS NOT NULL),
  FOREIGN KEY (framework_id,level_code) REFERENCES praxis.career_level(framework_id,code) ON DELETE CASCADE,
  FOREIGN KEY (framework_id,source_id) REFERENCES praxis.career_framework_source(framework_id,id)
);

CREATE TABLE praxis.career_level_evidence_criterion (
  framework_id text NOT NULL, requirement_id text NOT NULL, code text NOT NULL,
  label_fr text NOT NULL CHECK (btrim(label_fr) <> ''),
  assessment_mode text NOT NULL CHECK (assessment_mode IN ('structured_scenario','observed_practice','reviewed_work')),
  source_id text NOT NULL,
  PRIMARY KEY (framework_id,requirement_id,code),
  FOREIGN KEY (framework_id,requirement_id) REFERENCES praxis.career_level_requirement(framework_id,id) ON DELETE CASCADE,
  FOREIGN KEY (framework_id,source_id) REFERENCES praxis.career_framework_source(framework_id,id)
);

CREATE TABLE praxis.career_level_transition (
  framework_id text NOT NULL, from_code text NOT NULL, to_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('progression','track_change')),
  rationale_fr text NOT NULL CHECK (btrim(rationale_fr) <> ''), source_id text NOT NULL,
  PRIMARY KEY (framework_id,from_code,to_code), CHECK (from_code <> to_code),
  FOREIGN KEY (framework_id,from_code) REFERENCES praxis.career_level(framework_id,code) ON DELETE CASCADE,
  FOREIGN KEY (framework_id,to_code) REFERENCES praxis.career_level(framework_id,code) ON DELETE CASCADE,
  FOREIGN KEY (framework_id,source_id) REFERENCES praxis.career_framework_source(framework_id,id)
);

CREATE TABLE praxis.career_framework_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id text NOT NULL REFERENCES praxis.career_framework(id),
  reviewer text NOT NULL CHECK (btrim(reviewer) <> ''),
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  rationale text NOT NULL CHECK (btrim(rationale) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER career_framework_review_immutable BEFORE UPDATE OR DELETE ON praxis.career_framework_review
 FOR EACH ROW EXECUTE FUNCTION praxis.prevent_source_row_change();

CREATE FUNCTION praxis.guard_career_framework_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE framework_state text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.framework_id <> OLD.framework_id THEN RAISE EXCEPTION 'Framework membership is immutable'; END IF;
  SELECT status INTO framework_state FROM praxis.career_framework
    WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.framework_id ELSE NEW.framework_id END FOR UPDATE;
  IF framework_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only draft framework content may change'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['career_framework_source','career_level','career_level_occupation','career_level_requirement','career_level_evidence_criterion','career_level_transition'] LOOP
  EXECUTE format('CREATE TRIGGER career_content_draft_only BEFORE INSERT OR UPDATE OR DELETE ON praxis.%I FOR EACH ROW EXECUTE FUNCTION praxis.guard_career_framework_child()',t);
 END LOOP;
END $$;

CREATE FUNCTION praxis.guard_career_framework_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'draft' THEN RAISE EXCEPTION 'New frameworks start as drafts'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain framework versions; retire published versions instead'; END IF;
 IF NEW.id<>OLD.id OR NEW.family_id<>OLD.family_id OR NEW.market_code<>OLD.market_code OR NEW.version<>OLD.version THEN
   RAISE EXCEPTION 'Framework identity, market and family are immutable';
 END IF;
 IF OLD.status<>'draft' THEN
   IF NOT (OLD.status='reviewed' AND NEW.status='retired' AND (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status')) THEN
     RAISE EXCEPTION 'Reviewed framework content is immutable';
   END IF;
 ELSIF NEW.status<>'draft' THEN
   IF NEW.status<>'reviewed' OR NOT EXISTS (SELECT 1 FROM praxis.career_framework_review r
     WHERE r.framework_id=NEW.id AND r.decision='approve' AND r.reviewer=NEW.reviewed_by AND r.content_hash=NEW.content_hash) THEN
     RAISE EXCEPTION 'A matching recorded review is required';
   END IF;
   IF NOT EXISTS (SELECT 1 FROM praxis.career_level WHERE framework_id=NEW.id) OR
     EXISTS (SELECT 1 FROM praxis.career_level l WHERE l.framework_id=NEW.id AND
       (NOT EXISTS (SELECT 1 FROM praxis.career_level_occupation o WHERE o.framework_id=l.framework_id AND o.level_code=l.code)
        OR NOT EXISTS (SELECT 1 FROM praxis.career_level_requirement q WHERE q.framework_id=l.framework_id AND q.level_code=l.code))) OR
     EXISTS (SELECT 1 FROM praxis.career_level_requirement q WHERE q.framework_id=NEW.id AND
       NOT EXISTS (SELECT 1 FROM praxis.career_level_evidence_criterion e WHERE e.framework_id=q.framework_id AND e.requirement_id=q.id)) THEN
     RAISE EXCEPTION 'Every level needs occupation applicability, requirements and evidence criteria';
   END IF;
   IF EXISTS (SELECT 1 FROM praxis.career_level_occupation o WHERE o.framework_id=NEW.id AND NOT EXISTS (
     SELECT 1 FROM praxis.career_family f JOIN praxis.rome_occupation_professional_domains d ON d.domain_code=f.domain_code
       JOIN praxis.source_releases r ON r.id=d.release_id AND r.source='rome' AND r.is_active
     WHERE f.id=NEW.family_id AND d.code_rome=o.code_rome)) THEN
     RAISE EXCEPTION 'An occupation is outside the framework family';
   END IF;
   IF EXISTS (SELECT 1 FROM praxis.career_level_transition t
     JOIN praxis.career_level a ON a.framework_id=t.framework_id AND a.code=t.from_code
     JOIN praxis.career_level b ON b.framework_id=t.framework_id AND b.code=t.to_code
     WHERE t.framework_id=NEW.id AND ((a.track_code=b.track_code)<>(t.kind='progression'))) THEN
     RAISE EXCEPTION 'Transition kind does not match tracks';
   END IF;
   IF EXISTS (WITH RECURSIVE walk(node,path,cycle) AS (
     SELECT to_code,ARRAY[from_code,to_code],from_code=to_code FROM praxis.career_level_transition WHERE framework_id=NEW.id
     UNION ALL SELECT t.to_code,w.path || t.to_code,t.to_code=ANY(w.path) FROM walk w
       JOIN praxis.career_level_transition t ON t.framework_id=NEW.id AND t.from_code=w.node WHERE NOT w.cycle
     ) SELECT 1 FROM walk WHERE cycle) THEN RAISE EXCEPTION 'Career transitions contain a cycle'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER career_framework_state_guard BEFORE INSERT OR UPDATE OR DELETE ON praxis.career_framework
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_career_framework_state();

CREATE TABLE praxis.learner_career_preference (
  learner_id uuid PRIMARY KEY REFERENCES praxis.learner(id) ON DELETE CASCADE,
  market_code text REFERENCES praxis.career_market(code),
  track_code text REFERENCES praxis.career_track(code),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE praxis.learner_career_level_goal (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome),
  market_code text NOT NULL REFERENCES praxis.career_market(code),
  framework_id text NOT NULL, track_code text NOT NULL,
  target_level_code text NOT NULL, current_level_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (learner_id,code_rome,market_code),
  FOREIGN KEY (framework_id,market_code) REFERENCES praxis.career_framework(id,market_code),
  FOREIGN KEY (framework_id,target_level_code,track_code) REFERENCES praxis.career_level(framework_id,code,track_code),
  FOREIGN KEY (framework_id,target_level_code,code_rome) REFERENCES praxis.career_level_occupation(framework_id,level_code,code_rome),
  FOREIGN KEY (framework_id,current_level_code,code_rome) REFERENCES praxis.career_level_occupation(framework_id,level_code,code_rome)
);
CREATE FUNCTION praxis.guard_career_level_goal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE framework_state text;
BEGIN
 SELECT status INTO framework_state FROM praxis.career_framework WHERE id=NEW.framework_id FOR SHARE;
 IF framework_state IS DISTINCT FROM 'reviewed' THEN RAISE EXCEPTION 'Only reviewed levels may be selected'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER career_level_goal_reviewed BEFORE INSERT OR UPDATE ON praxis.learner_career_level_goal
 FOR EACH ROW EXECUTE FUNCTION praxis.guard_career_level_goal();
