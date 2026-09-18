-- The publisher includes eight valid three-digit ISCO group mappings alongside
-- four-digit ESCO/ISCO occupation codes. Preserve that source granularity.
-- rollback: remove the eight three-digit rows before restoring the 4-digit check.

ALTER TABLE praxis.esco_onet_occupation_crosswalk
  DROP CONSTRAINT esco_onet_occupation_crosswalk_esco_code_check,
  ADD CONSTRAINT esco_onet_occupation_crosswalk_esco_code_check
    CHECK (esco_code ~ '^[0-9]{3,4}(\.[0-9]+)*$');
