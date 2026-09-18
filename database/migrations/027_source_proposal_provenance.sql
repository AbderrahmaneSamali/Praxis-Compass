-- Pin the deterministic ROME transition-flag proposal policy for replay.
--
-- rollback:
--   Drop algorithm_version and inputs_hash only after exporting review history;
--   removing them makes existing automatic proposals non-replayable.

ALTER TABLE praxis.source_cross_domain_proposal
  ADD COLUMN algorithm_version text,
  ADD COLUMN inputs_hash text;

UPDATE praxis.source_cross_domain_proposal
SET algorithm_version = 'praxis-rome-transition-cross-domain-v1',
    inputs_hash = encode(digest(concat_ws('|',
      source_release_id::text, source_entity_kind, source_entity_id,
      cross_domain_id::text, evidence::text), 'sha256'), 'hex');

ALTER TABLE praxis.source_cross_domain_proposal
  ALTER COLUMN algorithm_version SET NOT NULL,
  ALTER COLUMN inputs_hash SET NOT NULL,
  ADD CONSTRAINT source_cross_domain_proposal_inputs_hash_check
    CHECK (inputs_hash ~ '^[a-f0-9]{64}$');

COMMENT ON COLUMN praxis.source_cross_domain_proposal.algorithm_version IS
  'Registered ALGORITHM_VERSIONS key value used to derive this proposal.';
