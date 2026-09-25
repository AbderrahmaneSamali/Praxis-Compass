-- ROME v61 exploration sources: the parts of RefRomeCsv.zip that 024's ingest
-- never read. Mobility links, RIASEC codes, centres d'intérêt, activity
-- sectors and job texts back career exploration (decision log 2026-09-25).
-- Rows are release-scoped source data: loaded once by
-- scripts/ingest-rome-exploration.mjs, never updated or deleted.
--
-- rollback:
--   DROP TABLE IF EXISTS praxis.rome_occupation_texts,
--     praxis.rome_occupation_activity_sectors, praxis.rome_activity_sector_versions,
--     praxis.rome_activity_sectors, praxis.rome_occupation_interest_centres,
--     praxis.rome_interest_centre_versions, praxis.rome_interest_centres,
--     praxis.rome_macro_competence_riasec, praxis.rome_occupation_riasec,
--     praxis.rome_mobility, praxis.source_release_supplements;
--   DROP FUNCTION IF EXISTS praxis.prevent_source_row_change();
--   Nothing outside these tables references them at this migration.

CREATE FUNCTION praxis.prevent_source_row_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable source data; load a new release instead', TG_TABLE_NAME;
END;
$$;

-- Files loaded into an existing release after its first ingest. The release's
-- own checksum manifest is immutable, so supplements record theirs here.
CREATE TABLE praxis.source_release_supplements (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  file_name text NOT NULL CHECK (file_name <> ''),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK (row_count >= 0),
  loader_version text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, file_name)
);

-- France Travail's own "mobilités" between ROME codes. display_order is the
-- source order and is shown as such; PRAXIS does not re-rank it.
CREATE TABLE praxis.rome_mobility (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  target_code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  display_order smallint NOT NULL CHECK (display_order > 0),
  PRIMARY KEY (release_id, code_rome, target_code_rome),
  CHECK (code_rome <> target_code_rome)
);
CREATE INDEX rome_mobility_target_idx ON praxis.rome_mobility (release_id, target_code_rome);

CREATE TABLE praxis.rome_occupation_riasec (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  riasec_major character(1) NOT NULL CHECK (riasec_major IN ('R','I','A','S','E','C')),
  riasec_minor character(1) CHECK (riasec_minor IN ('R','I','A','S','E','C')),
  PRIMARY KEY (release_id, code_rome),
  CHECK (riasec_minor IS DISTINCT FROM riasec_major)
);

CREATE TABLE praxis.rome_macro_competence_riasec (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_ogr bigint NOT NULL REFERENCES praxis.rome_items(code_ogr) ON DELETE RESTRICT,
  riasec_major character(1) NOT NULL CHECK (riasec_major IN ('R','I','A','S','E','C')),
  riasec_minor character(1) CHECK (riasec_minor IN ('R','I','A','S','E','C')),
  PRIMARY KEY (release_id, code_ogr),
  CHECK (riasec_minor IS DISTINCT FROM riasec_major)
);

-- "J'aime organiser, planifier" and the 29 other interest statements.
CREATE TABLE praxis.rome_interest_centres (
  centre_code integer PRIMARY KEY CHECK (centre_code > 0),
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_interest_centre_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  centre_code integer NOT NULL REFERENCES praxis.rome_interest_centres(centre_code) ON DELETE RESTRICT,
  label text NOT NULL CHECK (label <> ''),
  definition text NOT NULL,
  PRIMARY KEY (release_id, centre_code)
);

CREATE TABLE praxis.rome_occupation_interest_centres (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  centre_code integer NOT NULL REFERENCES praxis.rome_interest_centres(centre_code) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  is_principal boolean NOT NULL,
  PRIMARY KEY (release_id, centre_code, code_rome)
);
CREATE INDEX rome_occupation_interest_centres_rome_idx
  ON praxis.rome_occupation_interest_centres (release_id, code_rome);

-- Sectors and sub-sectors share one code space; a sub-sector names its parent.
CREATE TABLE praxis.rome_activity_sectors (
  sector_code integer PRIMARY KEY CHECK (sector_code > 0),
  first_seen_release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT
);

CREATE TABLE praxis.rome_activity_sector_versions (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  sector_code integer NOT NULL REFERENCES praxis.rome_activity_sectors(sector_code) ON DELETE RESTRICT,
  label text NOT NULL CHECK (label <> ''),
  definition text NOT NULL,
  parent_sector_code integer REFERENCES praxis.rome_activity_sectors(sector_code) ON DELETE RESTRICT,
  PRIMARY KEY (release_id, sector_code),
  CHECK (parent_sector_code IS DISTINCT FROM sector_code)
);

-- sector_code is the most specific level the source gives: the sub-sector
-- when there is one, otherwise the sector.
CREATE TABLE praxis.rome_occupation_activity_sectors (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  sector_code integer NOT NULL REFERENCES praxis.rome_activity_sectors(sector_code) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  is_principal boolean NOT NULL,
  PRIMARY KEY (release_id, sector_code, code_rome)
);
CREATE INDEX rome_occupation_activity_sectors_rome_idx
  ON praxis.rome_occupation_activity_sectors (release_id, code_rome);

-- Job definitions and "accès au métier", one sentence per row in source order.
CREATE TABLE praxis.rome_occupation_texts (
  release_id uuid NOT NULL REFERENCES praxis.source_releases(id) ON DELETE RESTRICT,
  code_rome character(5) NOT NULL REFERENCES praxis.rome_occupations(code_rome) ON DELETE RESTRICT,
  text_kind text NOT NULL CHECK (text_kind IN ('definition', 'acces_metier')),
  position smallint NOT NULL CHECK (position > 0),
  composition_bloc_code text NOT NULL,
  sentence text NOT NULL CHECK (sentence <> ''),
  PRIMARY KEY (release_id, code_rome, text_kind, position)
);

DO $$
DECLARE
  source_table text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY[
    'source_release_supplements', 'rome_mobility', 'rome_occupation_riasec',
    'rome_macro_competence_riasec', 'rome_interest_centres',
    'rome_interest_centre_versions', 'rome_occupation_interest_centres',
    'rome_activity_sectors', 'rome_activity_sector_versions',
    'rome_occupation_activity_sectors', 'rome_occupation_texts'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON praxis.%I
       FOR EACH ROW EXECUTE FUNCTION praxis.prevent_source_row_change()',
      source_table || '_immutable', source_table
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE praxis.rome_mobility IS
  'France Travail ROME mobility links. display_order is the source order; it is cited, never re-ranked by PRAXIS.';
COMMENT ON TABLE praxis.rome_occupation_texts IS
  'ROME definition and access-to-job sentences for every code (unix_texte). Corrects the 2026-08-23 premise that ROME publishes no descriptions.';
