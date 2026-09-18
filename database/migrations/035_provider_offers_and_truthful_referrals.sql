-- Provider-owned actionable offers and truthful referral handoff.
--
-- A published catalog record may be useful context without being actionable.
-- `content_records.actionable_offer` is the database-enforced projection used
-- by ranking and presentation: it is never a UI-only judgment.
--
-- Historical recommendation_event values `enroll` and `lead_submit` remain
-- readable. New writes use `saved_to_plan`, `referral_out`, and
-- `lead_submitted`; an enrollment is recorded only when the learner later
-- reports it through a referral follow-up or outcome endpoint.
--
-- rollback:
--   Stop provider/referral writers. Export fixture referrals and check-ins.
--   Revert callers to the pre-035 event contract, then drop the referral
--   tables, actionable index/columns, content provider FK and provider table.
--   The historical `enroll` values were retained and require no conversion.

CREATE TABLE praxis.provider (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 180),
  legal_name text CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 2 AND 240),
  website_url text CHECK (website_url IS NULL OR website_url ~ '^https?://'),
  contact_email text CHECK (contact_email IS NULL OR position('@' IN contact_email) > 1),
  contact_phone text,
  city text,
  country text,
  languages text[] NOT NULL DEFAULT ARRAY[]::text[]
    CHECK (cardinality(languages) > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  data_source text NOT NULL CHECK (char_length(data_source) BETWEEN 2 AND 80),
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verified_at IS NULL OR verified_by IS NOT NULL)
);

CREATE TRIGGER provider_touch_updated_at
BEFORE UPDATE ON praxis.provider
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

COMMENT ON TABLE praxis.provider IS
  'Training provider identity. Fixture providers are explicitly data_source=fixture and are never real organisations.';

ALTER TABLE praxis.content_records
  ADD COLUMN provider_id uuid REFERENCES praxis.provider(id) ON DELETE SET NULL,
  ADD COLUMN application_url text CHECK (application_url IS NULL OR application_url ~ '^https?://'),
  ADD COLUMN contact_route text CHECK (contact_route IS NULL OR contact_route IN ('provider_email', 'provider_phone', 'provider_website')),
  ADD COLUMN delivery_format text,
  ADD COLUMN is_online boolean,
  ADD COLUMN location_city text,
  ADD COLUMN location_country text,
  ADD COLUMN price_status text NOT NULL DEFAULT 'unspecified'
    CHECK (price_status IN ('unspecified', 'priced', 'price_on_request')),
  ADD COLUMN admission_status text NOT NULL DEFAULT 'unspecified'
    CHECK (admission_status IN ('unspecified', 'scheduled', 'rolling_admission')),
  ADD COLUMN next_start_date date,
  ADD COLUMN last_verified_at timestamptz,
  ADD COLUMN data_source text NOT NULL DEFAULT 'catalog'
    CHECK (char_length(data_source) BETWEEN 2 AND 80),
  ADD COLUMN actionable_offer boolean GENERATED ALWAYS AS (
    provider_id IS NOT NULL
    AND (application_url IS NOT NULL OR contact_route IS NOT NULL)
    AND duration_hours IS NOT NULL
    AND delivery_format IS NOT NULL
    AND cardinality(languages) > 0
    AND (is_online IS TRUE OR (location_city IS NOT NULL AND location_country IS NOT NULL))
    AND (price_mad IS NOT NULL OR price_status = 'price_on_request')
    AND (next_start_date IS NOT NULL OR admission_status = 'rolling_admission')
    AND last_verified_at IS NOT NULL
  ) STORED;

-- Existing ranker projections predate offer-status columns. Preserve their
-- known numeric price as priced before enforcing the new truth constraint.
UPDATE praxis.content_records
SET price_status = CASE WHEN price_mad IS NULL THEN 'unspecified' ELSE 'priced' END;

ALTER TABLE praxis.content_records
  ADD CONSTRAINT content_records_offer_price_truth_check CHECK (
    (price_mad IS NOT NULL AND price_status = 'priced')
    OR (price_mad IS NULL AND price_status IN ('unspecified', 'price_on_request'))
  ),
  ADD CONSTRAINT content_records_offer_admission_truth_check CHECK (
    (next_start_date IS NOT NULL AND admission_status = 'scheduled')
    OR (next_start_date IS NULL AND admission_status IN ('unspecified', 'rolling_admission'))
  );

CREATE INDEX content_records_actionable_offer_idx
  ON praxis.content_records (record_type, product_family, updated_at DESC)
  WHERE actionable_offer AND status = 'published' AND deleted_at IS NULL;
CREATE INDEX content_records_provider_idx ON praxis.content_records (provider_id)
  WHERE provider_id IS NOT NULL;

COMMENT ON COLUMN praxis.content_records.actionable_offer IS
  'Generated offer standard: provider, route, duration, format, language, location/online, price state, start/admission state and verification are all required.';

-- Actionable top-three ordering is ranker behaviour, so it receives its own
-- immutable weights/version row rather than mutating the prior active version.
WITH retired AS (
  UPDATE praxis.recommendation_weights
  SET status = 'retired'
  WHERE status = 'active'
  RETURNING weights
)
INSERT INTO praxis.recommendation_weights (version, weights, status, activated_at)
SELECT 'praxis-rank-actionable-offers-v1', weights, 'active', now()
FROM retired;

ALTER TABLE praxis.recommendation_event
  DROP CONSTRAINT recommendation_event_event_type_check,
  ADD CONSTRAINT recommendation_event_event_type_check CHECK (event_type IN (
    'view', 'expand', 'save', 'dismiss',
    'lead_submit', 'enroll',
    'saved_to_plan', 'referral_out', 'lead_submitted'
  ));

CREATE TABLE praxis.provider_referral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_event_sequence bigint NOT NULL,
  referral_event_occurred_at timestamptz NOT NULL,
  learner_id uuid NOT NULL REFERENCES praxis.learner(id) ON DELETE CASCADE,
  content_record_id uuid NOT NULL REFERENCES praxis.content_records(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES praxis.provider(id) ON DELETE RESTRICT,
  consent_id uuid NOT NULL REFERENCES praxis.consent_records(id) ON DELETE RESTRICT,
  consent_captured_at timestamptz NOT NULL,
  referral_url text NOT NULL CHECK (referral_url ~ '^https?://'),
  referred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (referral_event_sequence, referral_event_occurred_at)
    REFERENCES praxis.recommendation_event(sequence_id, occurred_at) ON DELETE RESTRICT,
  UNIQUE (referral_event_sequence, referral_event_occurred_at)
);

CREATE INDEX provider_referral_learner_time_idx
  ON praxis.provider_referral (learner_id, referred_at DESC);

CREATE TABLE praxis.provider_referral_follow_up (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL UNIQUE
    REFERENCES praxis.provider_referral(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'responded', 'non_response')),
  contacted_provider boolean,
  enrolled boolean,
  responded_at timestamptz,
  non_response_recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'pending' AND contacted_provider IS NULL AND enrolled IS NULL
      AND responded_at IS NULL AND non_response_recorded_at IS NULL)
    OR (status = 'responded' AND contacted_provider IS NOT NULL AND enrolled IS NOT NULL
      AND responded_at IS NOT NULL AND non_response_recorded_at IS NULL)
    OR (status = 'non_response' AND contacted_provider IS NULL AND enrolled IS NULL
      AND responded_at IS NULL AND non_response_recorded_at IS NOT NULL)
  )
);

CREATE TRIGGER provider_referral_follow_up_touch_updated_at
BEFORE UPDATE ON praxis.provider_referral_follow_up
FOR EACH ROW EXECUTE FUNCTION praxis.touch_updated_at();

CREATE INDEX provider_referral_follow_up_due_idx
  ON praxis.provider_referral_follow_up (due_at)
  WHERE status = 'pending';

CREATE OR REPLACE VIEW praxis.actionable_offers AS
SELECT content.*, provider.name AS provider_name, provider.website_url AS provider_website_url,
       provider.contact_email AS provider_contact_email,
       provider.contact_phone AS provider_contact_phone
FROM praxis.content_records AS content
JOIN praxis.provider AS provider ON provider.id = content.provider_id
WHERE content.actionable_offer
  AND content.status = 'published'
  AND content.deleted_at IS NULL
  AND provider.status = 'active';

-- The names below were searched as exact phrases before seeding and are
-- intentionally marked PRAXIS Démo plus an impossible fixture-style suffix.
INSERT INTO praxis.provider
  (name, legal_name, website_url, contact_email, contact_phone, city, country,
   languages, status, data_source, verified_at, verified_by)
VALUES
  ('PRAXIS Démo Aster-9', 'PRAXIS Démo Aster-9 — organisme fictif',
   'https://provider-aster-9.example', 'contact@provider-aster-9.example',
   '+212 000 000 001', 'Casablanca', 'MA', ARRAY['fr'], 'active', 'fixture', now(), 'fixture-seed'),
  ('PRAXIS Démo Lumen-7', 'PRAXIS Démo Lumen-7 — organisme fictif',
   'https://provider-lumen-7.example', 'contact@provider-lumen-7.example',
   '+212 000 000 002', 'Casablanca', 'MA', ARRAY['fr', 'en'], 'active', 'fixture', now(), 'fixture-seed'),
  ('PRAXIS Démo Nébuleuse-3', 'PRAXIS Démo Nébuleuse-3 — organisme fictif',
   'https://provider-nebuleuse-3.example', 'contact@provider-nebuleuse-3.example',
   '+212 000 000 003', 'Casablanca', 'MA', ARRAY['fr'], 'active', 'fixture', now(), 'fixture-seed')
ON CONFLICT (name) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  website_url = EXCLUDED.website_url,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  city = EXCLUDED.city,
  country = EXCLUDED.country,
  languages = EXCLUDED.languages,
  status = EXCLUDED.status,
  data_source = EXCLUDED.data_source,
  verified_at = EXCLUDED.verified_at,
  verified_by = EXCLUDED.verified_by;

INSERT INTO praxis.content_records
  (record_type, slug, title, status, summary, attributes, published_at,
   provider_id, application_url, delivery_format, is_online, location_city,
   location_country, price_mad, price_status, duration_hours, languages,
   admission_status, next_start_date, last_verified_at, data_source,
   sector_code, level, product_family, featured, cold_start_rank,
   cold_start_source_version)
SELECT
  'course', fixture.slug, fixture.title, 'published', fixture.summary,
  jsonb_build_object(
    'description', fixture.description,
    'format', fixture.delivery_format,
    'nextSession', fixture.next_start_date::text,
    'dataSource', 'fixture',
    'demo', true,
    'badge', 'Données de démonstration'
  ), now(), provider.id, fixture.application_url, fixture.delivery_format,
  fixture.is_online, fixture.location_city, fixture.location_country,
  fixture.price_mad, 'priced', fixture.duration_hours, fixture.languages,
  'scheduled', fixture.next_start_date, now(), 'fixture', 'digital_data',
  'L1 → L2', 'Professional', true, fixture.cold_start_rank,
  'fixture-actionable-offers-v1'
FROM (VALUES
  ('demo-analyse-donnees-casablanca', 'Fondations de l’analyse de données — Démo',
   'Atelier pratique en français : préparer un jeu de données, poser une question utile et produire une première analyse vérifiable.',
   'Formation fictive complète pour tester le parcours PRAXIS de bout en bout.',
   'PRAXIS Démo Aster-9', 'https://provider-aster-9.example/offres/analyse-donnees',
   'Présentiel — Casablanca', false, 'Casablanca', 'MA', 3600.00::numeric,
   36.00::numeric, ARRAY['fr']::text[], DATE '2026-10-12', 1),
  ('demo-tableaux-bord-power-bi', 'Tableaux de bord décisionnels — Démo',
   'Formation hybride en français et anglais : contrôler la qualité des données, construire un tableau de bord et expliquer un résultat.',
   'Formation fictive complète pour tester la recommandation d’une offre exploitable.',
   'PRAXIS Démo Lumen-7', 'https://provider-lumen-7.example/offres/tableaux-bord',
   'Hybride — Casablanca et en ligne', true, 'Casablanca', 'MA', 4800.00::numeric,
   42.00::numeric, ARRAY['fr','en']::text[], DATE '2026-10-26', 2),
  ('demo-methodes-analytiques-ligne', 'Méthodes et exploration de données — Démo',
   'Parcours en ligne en français : cadrer une question analytique, choisir une méthode et explorer des données sans surinterpréter.',
   'Formation fictive complète pour tester le suivi après orientation.',
   'PRAXIS Démo Nébuleuse-3', 'https://provider-nebuleuse-3.example/offres/methodes-analytiques',
   'En ligne', true, NULL, NULL, 2900.00::numeric,
   24.00::numeric, ARRAY['fr']::text[], DATE '2026-11-09', 3)
) AS fixture(slug, title, summary, description, provider_name, application_url,
             delivery_format, is_online, location_city, location_country,
             price_mad, duration_hours, languages, next_start_date, cold_start_rank)
JOIN praxis.provider AS provider ON provider.name = fixture.provider_name
ON CONFLICT (record_type, slug) DO UPDATE SET
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  summary = EXCLUDED.summary,
  attributes = EXCLUDED.attributes,
  published_at = coalesce(praxis.content_records.published_at, EXCLUDED.published_at),
  provider_id = EXCLUDED.provider_id,
  application_url = EXCLUDED.application_url,
  contact_route = NULL,
  delivery_format = EXCLUDED.delivery_format,
  is_online = EXCLUDED.is_online,
  location_city = EXCLUDED.location_city,
  location_country = EXCLUDED.location_country,
  price_mad = EXCLUDED.price_mad,
  price_status = EXCLUDED.price_status,
  duration_hours = EXCLUDED.duration_hours,
  languages = EXCLUDED.languages,
  admission_status = EXCLUDED.admission_status,
  next_start_date = EXCLUDED.next_start_date,
  last_verified_at = EXCLUDED.last_verified_at,
  data_source = EXCLUDED.data_source,
  sector_code = EXCLUDED.sector_code,
  level = EXCLUDED.level,
  product_family = EXCLUDED.product_family,
  featured = EXCLUDED.featured,
  cold_start_rank = EXCLUDED.cold_start_rank,
  cold_start_source_version = EXCLUDED.cold_start_source_version;

INSERT INTO praxis.course_skill_outcome
  (content_record_id, skill_id, entry_level, outcome_level, weight,
   evidence_type, source_version)
SELECT content.id, mapping.skill_id, mapping.entry_level, mapping.outcome_level,
       mapping.weight, 'editorial', 'fixture-actionable-offers-v1'
FROM (VALUES
  ('demo-analyse-donnees-casablanca', 'skill_prepare_data', 0, 2, 1.0::numeric),
  ('demo-analyse-donnees-casablanca', 'skill_analyze_dataset', 0, 2, 1.0::numeric),
  ('demo-analyse-donnees-casablanca', 'skill_frame_analytical_question', 0, 2, 0.8::numeric),
  ('demo-tableaux-bord-power-bi', 'skill_build_dashboard', 0, 2, 1.0::numeric),
  ('demo-tableaux-bord-power-bi', 'skill_communicate_finding', 0, 2, 0.8::numeric),
  ('demo-tableaux-bord-power-bi', 'skill_check_data_integrity', 0, 2, 0.8::numeric),
  ('demo-methodes-analytiques-ligne', 'skill_frame_analytical_question', 0, 2, 1.0::numeric),
  ('demo-methodes-analytiques-ligne', 'skill_choose_analytical_method', 0, 2, 1.0::numeric),
  ('demo-methodes-analytiques-ligne', 'skill_explore_data', 0, 2, 1.0::numeric)
) AS mapping(slug, skill_id, entry_level, outcome_level, weight)
JOIN praxis.content_records AS content
  ON content.record_type = 'course' AND content.slug = mapping.slug
ON CONFLICT (content_record_id, skill_id) DO UPDATE SET
  entry_level = EXCLUDED.entry_level,
  outcome_level = EXCLUDED.outcome_level,
  weight = EXCLUDED.weight,
  evidence_type = EXCLUDED.evidence_type,
  source_version = EXCLUDED.source_version;

CREATE OR REPLACE FUNCTION praxis.purge_fixture_offers()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  fixture_ids uuid[];
  deleted_referrals integer := 0;
  deleted_events integer := 0;
  deleted_outcomes integer := 0;
  deleted_snapshots integer := 0;
  deleted_offers integer := 0;
  deleted_providers integer := 0;
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO fixture_ids
  FROM praxis.content_records WHERE data_source = 'fixture';

  DELETE FROM praxis.provider_referral_follow_up
  WHERE referral_id IN (
    SELECT id FROM praxis.provider_referral WHERE content_record_id = ANY(fixture_ids)
  );
  DELETE FROM praxis.provider_referral WHERE content_record_id = ANY(fixture_ids);
  GET DIAGNOSTICS deleted_referrals = ROW_COUNT;

  DELETE FROM praxis.recommendation_event WHERE item_id = ANY(fixture_ids);
  GET DIAGNOSTICS deleted_events = ROW_COUNT;
  DELETE FROM praxis.learning_outcome WHERE item_id = ANY(fixture_ids);
  GET DIAGNOSTICS deleted_outcomes = ROW_COUNT;
  DELETE FROM praxis.recommendations WHERE record_id = ANY(fixture_ids);
  GET DIAGNOSTICS deleted_snapshots = ROW_COUNT;
  DELETE FROM praxis.recommendation_impression
  WHERE id IN (
    SELECT DISTINCT impression_id FROM praxis.recommendation_impression_item
    WHERE item_id = ANY(fixture_ids)
  );
  DELETE FROM praxis.content_records WHERE id = ANY(fixture_ids);
  GET DIAGNOSTICS deleted_offers = ROW_COUNT;
  DELETE FROM praxis.provider WHERE data_source = 'fixture';
  GET DIAGNOSTICS deleted_providers = ROW_COUNT;

  RETURN jsonb_build_object(
    'offers', deleted_offers, 'providers', deleted_providers,
    'referrals', deleted_referrals, 'events', deleted_events,
    'outcomes', deleted_outcomes, 'snapshots', deleted_snapshots
  );
END
$$;

COMMENT ON FUNCTION praxis.purge_fixture_offers() IS
  'Fixture-only cleanup. Invoke with SELECT praxis.purge_fixture_offers(); never use this for real provider data.';
