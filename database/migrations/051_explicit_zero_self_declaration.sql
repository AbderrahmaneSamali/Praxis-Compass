-- A learner can explicitly report no experience without equating absent evidence to zero.
-- Only self-declarations may use L0; demonstrated mastery remains on the L1-L4 rubric.
ALTER TABLE praxis.skill_evidence DROP CONSTRAINT skill_evidence_level_check;
ALTER TABLE praxis.skill_evidence ADD CONSTRAINT skill_evidence_level_check
  CHECK (level BETWEEN 0 AND 4 AND (level > 0 OR evidence_type='self_declared'));

-- Rollback only after exporting/removing explicit zero self-declarations:
-- ALTER TABLE praxis.skill_evidence DROP CONSTRAINT skill_evidence_level_check;
-- ALTER TABLE praxis.skill_evidence ADD CONSTRAINT skill_evidence_level_check CHECK (level BETWEEN 1 AND 4);
