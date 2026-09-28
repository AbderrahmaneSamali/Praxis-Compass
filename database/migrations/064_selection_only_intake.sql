-- Controlled vocabularies for the learner screen. Codes, not labels, are saved.
CREATE TABLE praxis.learner_choice (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  code text NOT NULL,
  label_fr text NOT NULL,
  display_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(group_id,code),
  CHECK (id = group_id || ':' || code)
);
INSERT INTO praxis.learner_choice(id,group_id,code,label_fr,display_order)
SELECT group_id || ':' || code, group_id, code, label_fr, display_order FROM (VALUES
 ('motivation','career_change','Changer de métier',1),
 ('motivation','promotion','Évoluer dans mon poste',2),
 ('motivation','employer_required','Mon employeur me le demande',3),
 ('motivation','job_seeking','Trouver un emploi',4),
 ('motivation','exploration','Explorer, sans urgence',5),
 ('situation','employed','En poste',1),
 ('situation','seeking','En recherche d’emploi',2),
 ('situation','studying','En études',3),
 ('situation','between_contracts','Entre deux missions',4),
 ('hours_per_week','1','1 h',1),
 ('hours_per_week','2','2 h',2),
 ('hours_per_week','4','4 h',3),
 ('hours_per_week','6','6 h',4),
 ('hours_per_week','8','8 h',5),
 ('hours_per_week','12','12 h',6),
 ('hours_per_week','unknown','Je ne sais pas encore',7),
 ('deadline','months_1','Dans 1 mois',1),
 ('deadline','months_3','Dans 3 mois',2),
 ('deadline','months_6','Dans 6 mois',3),
 ('deadline','months_12','Dans 12 mois',4),
 ('deadline','none','Pas d’échéance',5),
 ('practice_level','never','Jamais, je débute',1),
 ('practice_level','occasionally','Un peu',2),
 ('practice_level','regularly','Régulièrement',3),
 ('practice_context','work','Dans un emploi ou une mission',1),
 ('practice_context','study','Pendant mes études ou une formation',2),
 ('practice_context','personal_project','Dans un projet personnel',3),
 ('practice_context','volunteering','Dans une activité bénévole',4),
 ('practice_context','other','Dans un autre contexte',5),
 ('practice_context','undisclosed','Je préfère ne pas préciser',6),
 ('requirement_response','unsure','Je ne sais pas encore',1),
 ('requirement_response','practiced','Je l’ai déjà pratiquée',2),
 ('requirement_response','not_yet','Je ne l’ai pas encore pratiquée',3),
 ('skill_level','0','Pas encore pratiqué',1),
 ('skill_level','1','Avec guidage',2),
 ('skill_level','2','En autonomie',3),
 ('skill_level','3','Situations variées',4),
 ('skill_level','4','Expertise et transmission',5),
 ('feedback_reason','clear','Les pistes sont claires',1),
 ('feedback_reason','more_choices','Je souhaite plus de choix de métiers',2),
 ('feedback_reason','more_relevant','Les pistes correspondent peu à mes choix',3),
 ('feedback_reason','clearer_steps','Je souhaite des actions plus précises',4),
 ('feedback_reason','missing_choice','Un choix manque dans les listes',5),
 ('feedback_reason','other','Une autre raison',6)
) AS choices(group_id,code,label_fr,display_order);

ALTER TABLE praxis.rome_requirement_confirmation
  ADD COLUMN practice_context_id text REFERENCES praxis.learner_choice(id),
  ADD CHECK (practice_context_id IS NULL OR practice_context_id LIKE 'practice_context:%');
-- Keep historical examples intact; new declarations use a controlled context.
ALTER TABLE praxis.rome_requirement_confirmation DROP CONSTRAINT rome_requirement_confirmation_check;
ALTER TABLE praxis.rome_requirement_confirmation ADD CHECK
 (response <> 'practiced' OR length(trim(work_example)) >= 5 OR practice_context_id IS NOT NULL);
ALTER TABLE praxis.exploration_rome_feedback
  ADD COLUMN reason_id text REFERENCES praxis.learner_choice(id),
  ADD CHECK (reason_id IS NULL OR reason_id LIKE 'feedback_reason:%');
ALTER TABLE praxis.exploration_feedback
  ADD COLUMN reason_id text REFERENCES praxis.learner_choice(id),
  ADD CHECK (reason_id IS NULL OR reason_id LIKE 'feedback_reason:%');
ALTER TABLE praxis.learner_context
  ADD COLUMN practice_context_id text REFERENCES praxis.learner_choice(id),
  ADD CHECK (practice_context_id IS NULL OR practice_context_id LIKE 'practice_context:%');

INSERT INTO praxis.context_survey_version(version) VALUES ('praxis-context-survey-v3');
INSERT INTO praxis.context_survey_question(survey_version,question_id,section,context_field) VALUES
 ('praxis-context-survey-v3', 'motivation', 'project', 'motivation'),
 ('praxis-context-survey-v3', 'situation', 'project', 'situation'),
 ('praxis-context-survey-v3', 'hours_per_week', 'time', 'time'),
 ('praxis-context-survey-v3', 'deadline', 'time', 'deadline'),
 ('praxis-context-survey-v3', 'practice_level', 'practice', NULL),
 ('praxis-context-survey-v3', 'practice_context', 'practice', NULL);
ALTER TABLE praxis.context_survey_session ADD COLUMN choice_catalog jsonb;
ALTER TABLE praxis.context_survey_answer
  ADD COLUMN option_id text REFERENCES praxis.learner_choice(id),
  ADD CHECK (survey_version <> 'praxis-context-survey-v3' OR declined OR option_id IS NOT NULL);
COMMENT ON COLUMN praxis.context_survey_answer.option_id IS
 'Stable choice ID for analysis; value holds the normalized answer, and the session snapshots the labels.';
