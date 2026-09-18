-- Evidence-based release gates. Fixture rows never satisfy production gates.
CREATE OR REPLACE VIEW praxis.production_readiness AS
WITH metrics AS (
  SELECT
    (SELECT count(*) FROM praxis.occupation_launch_scope
      WHERE scope_code='digital_it_telecom_v1' AND status='active') AS launch_occupations,
    (SELECT count(*) FROM praxis.provider
      WHERE status='active' AND data_source <> 'fixture'
        AND verified_at IS NOT NULL) AS verified_real_providers,
    (SELECT count(*) FROM praxis.actionable_offers
      WHERE data_source <> 'fixture') AS actionable_real_offers,
    (SELECT count(*) FROM praxis.assessment_item
      WHERE status='published' AND calibration_status='calibrated') AS calibrated_items,
    (SELECT count(*) FROM praxis.assessment_response) AS assessment_responses,
    (SELECT count(*) FROM praxis.learning_outcome
      WHERE completion_status IS NOT NULL) AS recorded_outcomes,
    (SELECT count(*) FROM praxis.occupation
      WHERE status='published') AS published_metiers,
    (SELECT count(DISTINCT o.id) FROM praxis.occupation o
      JOIN praxis.occupation_source_anchor_review r ON r.occupation_id=o.id
      WHERE o.status='published' AND r.source='rome' AND r.decision='approved') AS rome_anchored_metiers,
    (SELECT count(DISTINCT o.id) FROM praxis.occupation o
      JOIN praxis.occupation_source_anchor_review r ON r.occupation_id=o.id
      WHERE o.status='published' AND r.source='onet' AND r.decision='approved') AS onet_anchored_metiers
)
SELECT gate, actual, required, actual >= required AS ready, explanation
FROM metrics
CROSS JOIN LATERAL (VALUES
  ('digital_launch_scope', launch_occupations, 20::bigint,
   'At least 20 stable ESCO occupations selected for first launch'),
  ('verified_real_providers', verified_real_providers, 1::bigint,
   'At least one active, verified, non-fixture provider'),
  ('actionable_real_offers', actionable_real_offers, 1::bigint,
   'At least one fully actionable, non-fixture formation'),
  ('calibrated_assessment_items', calibrated_items, 1::bigint,
   'At least one governed, calibrated assessment item'),
  ('assessment_evidence', assessment_responses, 20::bigint,
   'Minimum evidence floor before interpreting assessment behavior'),
  ('learner_outcomes', recorded_outcomes, 10::bigint,
   'Minimum outcome floor before outcome-based calibration'),
  ('rome_coverage', rome_anchored_metiers, published_metiers,
   'All published curated métiers have approved ROME anchors'),
  ('onet_coverage', onet_anchored_metiers, published_metiers,
   'All published curated métiers have approved O*NET anchors')
) AS gates(gate, actual, required, explanation);

COMMENT ON VIEW praxis.production_readiness IS
  'Release gates based on real evidence. Fixtures never count as providers, offers, assessments, or outcomes.';
