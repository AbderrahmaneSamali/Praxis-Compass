-- Distinct denominators avoid multiplication across referrals, outcomes and skills.
CREATE VIEW praxis.online_recommendation_outcome_metrics AS
WITH real_requests AS (
  SELECT i.* FROM praxis.recommendation_impression i
  WHERE NOT i.is_example AND i.served_at >= now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM praxis.recommendation_impression_item ii
      JOIN praxis.content_records c ON c.id=ii.item_id WHERE ii.impression_id=i.id AND c.data_source='fixture')
), real_outcomes AS (
  SELECT o.* FROM praxis.learning_outcome o JOIN praxis.content_records c ON c.id=o.item_id
  JOIN praxis.provider p ON p.id=c.provider_id
  WHERE c.data_source <> 'fixture' AND p.data_source <> 'fixture'
    AND o.created_at >= now() - interval '30 days'
), real_referrals AS (
  SELECT r.id, f.contacted_provider, f.enrolled FROM praxis.provider_referral r
  JOIN praxis.content_records c ON c.id=r.content_record_id
  JOIN praxis.provider p ON p.id=r.provider_id
  LEFT JOIN praxis.provider_referral_follow_up f ON f.referral_id=r.id
  WHERE c.data_source <> 'fixture' AND p.data_source <> 'fixture'
    AND r.referred_at >= now() - interval '30 days'
)
SELECT
  (SELECT count(*) FROM real_requests) AS requests,
  (SELECT count(*) FROM real_requests r WHERE NOT EXISTS(SELECT 1 FROM praxis.recommendation_impression_item i WHERE i.impression_id=r.id)) AS no_direct_match,
  (SELECT count(*) FROM real_requests r WHERE NOT EXISTS(SELECT 1 FROM praxis.recommendation_impression_item i WHERE i.impression_id=r.id)
     AND coalesce(jsonb_array_length(r.learning_plans->'plans'),0)=0) AS no_solution,
  (SELECT count(*) FROM real_referrals) AS referrals,
  (SELECT count(*) FROM real_referrals WHERE contacted_provider) AS qualified_referrals,
  (SELECT count(*) FROM real_referrals WHERE enrolled) AS reported_enrollments,
  (SELECT count(*) FROM real_outcomes WHERE completion_status='completed') AS reported_completions,
  (SELECT count(*) FROM real_outcomes WHERE completion_status IN ('completed','dropped')) AS resolved_outcomes,
  (SELECT count(*) FROM praxis.learning_skill_progress p JOIN real_outcomes o ON o.id=p.outcome_id
    WHERE p.evidence_kind='assessed' AND p.after_level > p.before_level) AS assessed_skill_gains,
  (SELECT count(*) FROM praxis.learning_skill_progress p JOIN real_outcomes o ON o.id=p.outcome_id
    WHERE p.evidence_kind='self_report' AND p.after_level > p.before_level) AS self_reported_skill_gains;

-- Evidence-based release gates. Fixture rows never satisfy production gates.
CREATE OR REPLACE VIEW praxis.production_readiness AS
WITH metrics AS (
  SELECT
    (SELECT count(*) FROM praxis.occupation_launch_scope
      WHERE scope_code='digital_it_telecom_v1' AND status='active') AS launch_occupations,
    (SELECT count(*) FROM praxis.provider
      WHERE status='active' AND data_source <> 'fixture'
        AND verified_at IS NOT NULL) AS verified_real_providers,
    (SELECT count(*) FROM praxis.reviewed_online_offers
      WHERE data_source <> 'fixture') AS actionable_real_offers,
    (SELECT count(*) FROM praxis.assessment_item
      WHERE status='published' AND calibration_status='calibrated') AS calibrated_items,
    (SELECT count(*) FROM praxis.assessment_response) AS assessment_responses,
    (SELECT count(*) FROM praxis.learning_outcome o JOIN praxis.content_records c ON c.id=o.item_id
      WHERE o.completion_status IS NOT NULL AND c.data_source <> 'fixture') AS recorded_outcomes,
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
