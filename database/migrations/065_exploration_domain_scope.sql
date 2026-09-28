-- A selected exploration domain is a saved constraint, not a dropdown filter.
ALTER TABLE praxis.exploration_profile
  ADD COLUMN preferred_domain_code text
    REFERENCES praxis.rome_professional_domains(domain_code) ON DELETE RESTRICT;
