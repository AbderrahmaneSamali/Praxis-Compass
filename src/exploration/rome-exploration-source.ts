/**
 * Parsing and validation for the ROME v61 exploration files (migration 059):
 * mobility, RIASEC, centres d'intérêt, activity sectors and job texts.
 * Pure: no I/O, so it is unit-tested against the real archive and fixtures.
 * database/ingest-rome-exploration.ts does the loading.
 */

const RIASEC_CODES = new Set(['R', 'I', 'A', 'S', 'E', 'C']);
const ROME_CODE = /^[A-Z][0-9]{4}$/;

/** Each source file with the exact header the loader was written against. */
export const EXPLORATION_FILES = Object.freeze({
  mobility: {
    file: 'unix_rubrique_mobilite_v461_utf8.csv',
    header: ['code_rome', 'code_rome_cible', 'numero_ordre'],
  },
  occupationRiasec: {
    file: 'unix_referentiel_code_rome_riasec_v461_utf8.csv',
    header: ['code_rome', 'riasec_majeur', 'riasec_mineur'],
  },
  macroRiasec: {
    file: 'unix_referentiel_macro_competence_riasec_v461_utf8.csv',
    header: ['code_ogr', 'riasec_majeur', 'riasec_mineur'],
  },
  centres: {
    file: 'unix_centre_interet_v461_utf8.csv',
    header: ['code_centre_interet', 'libelle_centre_interet', 'definition_centre_interet'],
  },
  centreLinks: {
    file: 'unix_arborescence_centre_interet_v461_utf8.csv',
    header: [
      'code_centre_interet',
      'libelle_centre_interet',
      'code_ogr_rome',
      'code_rome',
      'libelle_rome',
      'principal',
    ],
  },
  sectors: {
    file: 'unix_secteur_activite_v461_utf8.csv',
    header: ['code_sect_activite', 'libelle_sect_activite', 'definition_sect_activite'],
  },
  subSectors: {
    file: 'unix_sous_secteur_activite_v461_utf8.csv',
    header: [
      'code_ss_sect_activite',
      'libelle_ss_sect_activite',
      'definition_ss_sect_activite',
      'code_sect_activite',
    ],
  },
  sectorLinks: {
    file: 'unix_arborescence_secteur_activite_v461_utf8.csv',
    header: [
      'code_sect_activite',
      'libelle_sect_activite',
      'code_ss_sect_activite',
      'libelle_ss_sect_activite',
      'code_ogr_rome',
      'code_rome',
      'libelle_rome',
      'principal',
    ],
  },
  texts: {
    file: 'unix_texte_v461_utf8.csv',
    header: ['code_rome', 'code_compo_bloc', 'libelle_type_texte', 'position_phrase', 'libelle_texte'],
  },
} as const);

export type ExplorationFileKind = keyof typeof EXPLORATION_FILES;
export type ExplorationTexts = Readonly<Record<ExplorationFileKind, string>>;

type Riasec = Readonly<{ major: string; minor: string | null }>;

export type ExplorationRows = Readonly<{
  mobility: readonly Readonly<{ source: string; target: string; order: number }>[];
  occupationRiasec: readonly (Riasec & Readonly<{ code: string }>)[];
  macroRiasec: readonly (Riasec & Readonly<{ ogr: string }>)[];
  centres: readonly Readonly<{ code: number; label: string; definition: string }>[];
  centreLinks: readonly Readonly<{ centre: number; code: string; principal: boolean }>[];
  sectors: readonly Readonly<{
    code: number;
    label: string;
    definition: string;
    parent: number | null;
  }>[];
  sectorLinks: readonly Readonly<{ sector: number; code: string; principal: boolean }>[];
  texts: readonly Readonly<{
    code: string;
    kind: 'definition' | 'acces_metier';
    position: number;
    bloc: string;
    sentence: string;
  }>[];
}>;

/**
 * RFC 4180 CSV with quoted multi-line fields. Blank lines, which some ROME
 * files place between records, are dropped rather than read as empty rows.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value !== ''));
}

function records(kind: ExplorationFileKind, text: string): Record<string, string>[] {
  const { file, header } = EXPLORATION_FILES[kind];
  const [actual, ...body] = parseCsv(text);
  if (JSON.stringify(actual) !== JSON.stringify(header)) {
    throw new Error(`${file}: unexpected header ${JSON.stringify(actual)}`);
  }
  return body.map((values, line) => {
    if (values.length !== header.length) {
      throw new Error(`${file} record ${line + 2}: ${values.length} fields, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((name, column) => [name, (values[column] ?? '').trim()]));
  });
}

function romeCode(value: string | undefined, where: string): string {
  if (!value || !ROME_CODE.test(value)) {
    throw new Error(`${where}: invalid ROME code ${JSON.stringify(value)}`);
  }
  return value;
}

function positiveInteger(value: string | undefined, where: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${where}: expected a positive integer, got ${JSON.stringify(value)}`);
  }
  return number;
}

function riasec(major: string | undefined, minor: string | undefined, where: string): Riasec {
  if (!major || !RIASEC_CODES.has(major)) {
    throw new Error(`${where}: invalid RIASEC major ${JSON.stringify(major)}`);
  }
  if (minor && !RIASEC_CODES.has(minor)) {
    throw new Error(`${where}: invalid RIASEC minor ${JSON.stringify(minor)}`);
  }
  if (minor === major) throw new Error(`${where}: RIASEC minor repeats the major`);
  return { major, minor: minor || null };
}

function principal(value: string | undefined, where: string): boolean {
  if (value !== 'oui' && value !== 'non') {
    throw new Error(`${where}: principal must be oui/non, got ${JSON.stringify(value)}`);
  }
  return value === 'oui';
}

function assertUnique<T>(rows: readonly T[], key: (row: T) => string, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`${label}: duplicate key ${value}`);
    seen.add(value);
  }
}

/**
 * Validates every file and returns rows ready to insert, plus the record count
 * of each source file. A file count can exceed its loaded rows where the
 * source leaves a record unclassified.
 */
export function buildExplorationRows(texts: ExplorationTexts): Readonly<{
  rows: ExplorationRows;
  fileRecords: Readonly<Record<ExplorationFileKind, number>>;
}> {
  const mobility = records('mobility', texts.mobility).map((row, index) => {
    const where = `mobility record ${index + 2}`;
    const source = romeCode(row.code_rome, where);
    const target = romeCode(row.code_rome_cible, where);
    if (source === target) throw new Error(`${where}: links ${source} to itself`);
    return { source, target, order: positiveInteger(row.numero_ordre, where) };
  });
  assertUnique(mobility, (row) => `${row.source}>${row.target}`, 'mobility');

  const occupationRiasec = records('occupationRiasec', texts.occupationRiasec).map((row, index) => {
    const where = `occupation RIASEC record ${index + 2}`;
    return { code: romeCode(row.code_rome, where), ...riasec(row.riasec_majeur, row.riasec_mineur, where) };
  });
  assertUnique(occupationRiasec, (row) => row.code, 'occupation RIASEC');

  const macroRecords = records('macroRiasec', texts.macroRiasec);
  // France Travail leaves some macro-competences unclassified (both codes
  // empty). Absence of a row means "not classified"; nothing is invented.
  const macroRiasec = macroRecords.flatMap((row, index) => {
    const where = `macro-competence RIASEC record ${index + 2}`;
    const ogr = String(positiveInteger(row.code_ogr, where));
    if (!row.riasec_majeur && !row.riasec_mineur) return [];
    return [{ ogr, ...riasec(row.riasec_majeur, row.riasec_mineur, where) }];
  });
  assertUnique(macroRiasec, (row) => row.ogr, 'macro-competence RIASEC');

  const centres = records('centres', texts.centres).map((row, index) => {
    const where = `centre record ${index + 2}`;
    if (!row.libelle_centre_interet) throw new Error(`${where}: empty label`);
    return {
      code: positiveInteger(row.code_centre_interet, where),
      label: row.libelle_centre_interet,
      definition: row.definition_centre_interet ?? '',
    };
  });
  assertUnique(centres, (row) => String(row.code), 'centres');
  const centreCodes = new Set(centres.map((row) => row.code));

  const centreLinks = records('centreLinks', texts.centreLinks).map((row, index) => {
    const where = `centre link record ${index + 2}`;
    const centre = positiveInteger(row.code_centre_interet, where);
    if (!centreCodes.has(centre)) throw new Error(`${where}: unknown centre ${centre}`);
    return { centre, code: romeCode(row.code_rome, where), principal: principal(row.principal, where) };
  });
  assertUnique(centreLinks, (row) => `${row.centre}|${row.code}`, 'centre links');

  const sectorRecords = records('sectors', texts.sectors);
  const subSectorRecords = records('subSectors', texts.subSectors);
  const sectors = [
    ...sectorRecords.map((row, index) => {
      const where = `sector record ${index + 2}`;
      if (!row.libelle_sect_activite) throw new Error(`${where}: empty label`);
      return {
        code: positiveInteger(row.code_sect_activite, where),
        label: row.libelle_sect_activite,
        definition: row.definition_sect_activite ?? '',
        parent: null,
      };
    }),
    ...subSectorRecords.map((row, index) => {
      const where = `sub-sector record ${index + 2}`;
      if (!row.libelle_ss_sect_activite) throw new Error(`${where}: empty label`);
      return {
        code: positiveInteger(row.code_ss_sect_activite, where),
        label: row.libelle_ss_sect_activite,
        definition: row.definition_ss_sect_activite ?? '',
        parent: positiveInteger(row.code_sect_activite, where),
      };
    }),
  ];
  assertUnique(sectors, (row) => String(row.code), 'sectors and sub-sectors');
  const sectorCodes = new Set(sectors.map((row) => row.code));
  for (const sector of sectors) {
    if (sector.parent !== null && !sectorCodes.has(sector.parent)) {
      throw new Error(`sub-sector ${sector.code}: unknown parent ${sector.parent}`);
    }
  }

  const sectorLinks = records('sectorLinks', texts.sectorLinks).map((row, index) => {
    const where = `sector link record ${index + 2}`;
    // The most specific level the source gives.
    const sector = positiveInteger(row.code_ss_sect_activite || row.code_sect_activite, where);
    if (!sectorCodes.has(sector)) throw new Error(`${where}: unknown sector ${sector}`);
    return { sector, code: romeCode(row.code_rome, where), principal: principal(row.principal, where) };
  });
  assertUnique(sectorLinks, (row) => `${row.sector}|${row.code}`, 'sector links');

  const jobTexts = records('texts', texts.texts).map((row, index) => {
    const where = `text record ${index + 2}`;
    const kind = row.libelle_type_texte;
    if (kind !== 'definition' && kind !== 'acces_metier') {
      throw new Error(`${where}: unknown text kind ${JSON.stringify(kind)}`);
    }
    if (!row.libelle_texte) throw new Error(`${where}: empty sentence`);
    return {
      code: romeCode(row.code_rome, where),
      kind,
      position: positiveInteger(row.position_phrase, where),
      bloc: row.code_compo_bloc ?? '',
      sentence: row.libelle_texte,
    } as const;
  });
  assertUnique(jobTexts, (row) => `${row.code}|${row.kind}|${row.position}`, 'texts');

  return {
    rows: {
      mobility,
      occupationRiasec,
      macroRiasec,
      centres,
      centreLinks,
      sectors,
      sectorLinks,
      texts: jobTexts,
    },
    fileRecords: {
      mobility: mobility.length,
      occupationRiasec: occupationRiasec.length,
      macroRiasec: macroRecords.length,
      centres: centres.length,
      centreLinks: centreLinks.length,
      sectors: sectorRecords.length,
      subSectors: subSectorRecords.length,
      sectorLinks: sectorLinks.length,
      texts: jobTexts.length,
    },
  };
}
