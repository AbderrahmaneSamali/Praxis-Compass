-- Target-profile calibration provenance and an index for compact ESCO profiles.
--
-- ESCO tells us whether a skill is essential or optional; it does not publish
-- a pedagogical L1-L4 target for that skill. The level shown to learners must
-- therefore disclose whether it is a PRAXIS calibration, a conservative ESCO
-- default, or an externally sourced prior awaiting PRAXIS validation.
--
-- rollback:
--   ALTER TABLE praxis.navigator_role_skill_targets
--     DROP CONSTRAINT IF EXISTS navigator_role_skill_targets_level_basis_source_check,
--     DROP CONSTRAINT IF EXISTS navigator_role_skill_targets_target_level_basis_check,
--     DROP COLUMN IF EXISTS target_level_basis;
--   DROP INDEX IF EXISTS praxis.esco_occupation_skill_essential_frequency_idx;
--   This loses the explanation of how historic target levels were set.

ALTER TABLE praxis.navigator_role_skill_targets
  ADD COLUMN target_level_basis text NOT NULL DEFAULT 'praxis_authored'
    CHECK (target_level_basis IN (
      'praxis_authored',
      'esco_relation_default',
      'external_prior'
    ));

UPDATE praxis.navigator_role_skill_targets
SET target_level_basis = 'esco_relation_default'
WHERE profile_source = 'derived_from_esco';

ALTER TABLE praxis.navigator_role_skill_targets
  ADD CONSTRAINT navigator_role_skill_targets_level_basis_source_check
  CHECK (
    profile_source <> 'derived_from_esco'
    OR target_level_basis IN ('esco_relation_default', 'external_prior')
  );

CREATE INDEX esco_occupation_skill_essential_frequency_idx
  ON praxis.esco_occupation_skill_relations (release_id, skill_uri)
  WHERE relationship_type = 'essential';

COMMENT ON COLUMN praxis.navigator_role_skill_targets.target_level_basis IS
  'praxis_authored is a reviewed PRAXIS calibration; esco_relation_default is a transparent L3/L2 default inferred only from essential/optional; external_prior is supporting evidence pending PRAXIS validation. O*NET generic Skill ratings must not be presented as a role-specific PRAXIS proficiency requirement.';
