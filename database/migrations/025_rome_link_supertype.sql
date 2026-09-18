-- ROME liens_rome_referentiels targets the polymorphic OGR registry, not only
-- competence/savoir items. Preserve the real FK through the governed supertype.
--
-- rollback:
--   Only restore the narrower rome_items FK after proving every imported link
--   targets an item row; current v61 source data does not satisfy that claim.

ALTER TABLE praxis.rome_fiche_item_links
  DROP CONSTRAINT rome_fiche_item_links_code_ogr_fkey,
  ADD CONSTRAINT rome_fiche_item_links_code_ogr_fkey
    FOREIGN KEY (code_ogr)
    REFERENCES praxis.rome_ogr_entities(code_ogr)
    ON DELETE RESTRICT;

COMMENT ON COLUMN praxis.rome_fiche_item_links.code_ogr IS
  'Polymorphic ROME OGR reference constrained through rome_ogr_entities; the source file includes more than competence/savoir items.';
