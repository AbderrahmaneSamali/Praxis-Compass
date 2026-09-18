-- O*NET products may be classified under more than one UNSPSC Element ID.
-- Preserve that source many-to-many instead of choosing an arbitrary family.
-- No 30.3 ingest can have committed under the narrower 024 constraint because
-- the loader rejects the inconsistency before inserting source rows.
--
-- rollback:
--   Only restore the one-family-per-product schema if a later source audit
--   proves every product has exactly one Element ID; O*NET 30.3 does not.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM praxis.onet_occupation_software LIMIT 1) THEN
    RAISE EXCEPTION '026 requires an empty pre-ingest O*NET association table';
  END IF;
END
$$;

DROP VIEW praxis.onet_in_demand_software;
DROP TABLE praxis.onet_occupation_software;
DROP TABLE praxis.onet_software_product_versions;

CREATE TABLE praxis.onet_software_product_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES praxis.onet_software_products(id) ON DELETE RESTRICT,
  element_id text NOT NULL,
  element_name text NOT NULL,
  hot_technology boolean NOT NULL,
  PRIMARY KEY (release_id, product_id, element_id)
);

CREATE TABLE praxis.onet_occupation_software (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  onet_soc_code text NOT NULL REFERENCES praxis.onet_occupations(onet_soc_code) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES praxis.onet_software_products(id) ON DELETE RESTRICT,
  element_id text NOT NULL,
  hot_technology boolean NOT NULL,
  in_demand boolean NOT NULL,
  PRIMARY KEY (release_id, onet_soc_code, product_id, element_id),
  FOREIGN KEY (release_id, product_id, element_id)
    REFERENCES praxis.onet_software_product_versions(release_id, product_id, element_id)
    ON DELETE RESTRICT
);

CREATE VIEW praxis.onet_in_demand_software
WITH (security_barrier = true) AS
SELECT association.release_id, association.onet_soc_code,
       association.product_id, product.canonical_name,
       association.element_id, version.element_name
FROM praxis.onet_occupation_software AS association
JOIN praxis.onet_software_products AS product ON product.id = association.product_id
JOIN praxis.onet_software_product_versions AS version
  ON version.release_id = association.release_id
 AND version.product_id = association.product_id
 AND version.element_id = association.element_id
WHERE association.in_demand;

COMMENT ON VIEW praxis.onet_in_demand_software IS
  'Mandatory downstream O*NET occupation-software surface. Only pair-specific In Demand=Y is an occupation signal. Products retain every source UNSPSC Element assignment.';
