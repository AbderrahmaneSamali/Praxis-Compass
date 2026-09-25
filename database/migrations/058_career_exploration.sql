-- Career exploration demo catalog and learner-owned journey state.
-- The direction narratives below are editorial demonstration data, not reviewed
-- labor-market facts. Existing authored role-skill targets retain their provenance.
CREATE TABLE praxis.exploration_direction (
  id text PRIMARY KEY,
  role_id text NOT NULL REFERENCES praxis.occupation(id),
  kind text NOT NULL CHECK (kind IN ('adjacent_role','specialization','current_role_growth')),
  title_fr text NOT NULL,
  description_fr text NOT NULL,
  responsibilities_fr text[] NOT NULL,
  interest_tags_fr text[] NOT NULL,
  source_label text NOT NULL,
  source_reference text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('demo_unreviewed','reviewed')),
  active boolean NOT NULL DEFAULT true
);
INSERT INTO praxis.exploration_direction
  (id,role_id,kind,title_fr,description_fr,responsibilities_fr,interest_tags_fr,source_label,source_reference,review_status)
VALUES
  ('data-analyst','occupation_esco_d3edb8f83a0647a08fb99b212c006aa2','adjacent_role','Analyste de données',
   'Explorer des données et rendre des résultats compréhensibles pour aider une décision.',
   ARRAY['Formuler une question à étudier','Préparer et examiner des données','Présenter des constats et leurs limites'],
   ARRAY['données','analyse','tableau de bord'], 'Profil éditorial PRAXIS · démonstration','praxis-catalog-roles-v1','demo_unreviewed'),
  ('financial-analyst','metier_analyste_financier','specialization','Analyse financière',
   'Examiner des informations financières et expliciter des hypothèses pour soutenir une décision.',
   ARRAY['Lire des états financiers','Analyser les écarts','Présenter des hypothèses et des risques'],
   ARRAY['finance','analyse','chiffres'], 'Profil éditorial PRAXIS · démonstration','praxis-catalog-roles-v1','demo_unreviewed'),
  ('data-analyst-growth','occupation_esco_d3edb8f83a0647a08fb99b212c006aa2','current_role_growth','Approfondir l’analyse de données',
   'Développer des responsabilités plus larges dans votre métier actuel d’analyste de données.',
   ARRAY['Cadrer une demande d’analyse','Vérifier la qualité des résultats','Communiquer des conclusions nuancées'],
   ARRAY['données','analyse','qualité'], 'Profil éditorial PRAXIS · démonstration','praxis-catalog-roles-v1','demo_unreviewed');

CREATE TABLE praxis.exploration_profile (
  learner_id uuid PRIMARY KEY REFERENCES praxis.learner(id) ON DELETE CASCADE,
  current_role_id text REFERENCES praxis.occupation(id),
  experience text NOT NULL DEFAULT '',
  interests text NOT NULL DEFAULT '',
  constraints_text text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE praxis.exploration_saved_direction (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  direction_id text NOT NULL REFERENCES praxis.exploration_direction(id),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (learner_id,direction_id)
);
CREATE TABLE praxis.exploration_selected_action (
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  direction_id text NOT NULL REFERENCES praxis.exploration_direction(id),
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (learner_id,action_id)
);
CREATE TABLE praxis.exploration_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  direction_id text REFERENCES praxis.exploration_direction(id),
  useful boolean NOT NULL,
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
