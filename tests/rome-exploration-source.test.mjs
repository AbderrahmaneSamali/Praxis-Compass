// @ts-nocheck -- ported from the main app's plain-JS suite; exercised at runtime.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { unzipSync } from 'fflate';

import {
  EXPLORATION_FILES,
  buildExplorationRows,
  parseCsv,
} from '../dist/exploration/rome-exploration-source.js';

const ZIP = process.env.ROME_SOURCE_ZIP ?? new URL('../ROME/RefRomeCsv.zip', import.meta.url);

/** The smallest valid set of files; tests override one file at a time. */
function minimalTexts(overrides = {}) {
  const csv = (kind, ...rows) =>
    [EXPLORATION_FILES[kind].header, ...rows]
      .map((row) => row.map((value) => `"${value}"`).join(','))
      .join('\n');
  return {
    mobility: csv('mobility', ['A1101', 'A1102', '1']),
    occupationRiasec: csv('occupationRiasec', ['A1101', 'R', 'C']),
    macroRiasec: csv('macroRiasec', ['104292', 'C', '']),
    centres: csv('centres', ['1', 'J’aime organiser, planifier', 'Définition']),
    centreLinks: csv('centreLinks', [
      '1',
      'J’aime organiser, planifier',
      '8',
      'A1101',
      'Libellé',
      'oui',
    ]),
    sectors: csv('sectors', ['110', 'Activités juridiques et comptables', '']),
    subSectors: csv('subSectors', ['145', 'Activités juridiques', '', '110']),
    sectorLinks: csv(
      'sectorLinks',
      [
        '110',
        'Activités juridiques et comptables',
        '145',
        'Activités juridiques',
        '1',
        'A1101',
        'Libellé',
        'non',
      ],
      [
        '110',
        'Activités juridiques et comptables',
        '',
        '',
        '2',
        'A1102',
        'Libellé',
        'oui',
      ],
    ),
    texts: csv('texts', [
      'A1101',
      '3',
      'definition',
      '1',
      'Réalise des travaux.',
    ]),
    ...overrides,
  };
}

test('CSV parsing keeps quoted commas and newlines and drops blank separator lines', () => {
  const rows = parseCsv(
    '﻿"a","b"\r\n"1","x, y\nz"\r\n\r\n"2","say ""hi"""\r\n',
  );
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', 'x, y\nz'],
    ['2', 'say "hi"'],
  ]);
  assert.throws(() => parseCsv('"open'), /Unterminated/);
});


test('a sector link without a sub-sector points at the sector itself', () => {
  const { rows, fileRecords } = buildExplorationRows(minimalTexts());
  assert.deepEqual(
    rows.sectorLinks.map((row) => [row.sector, row.code, row.principal]),
    [
      [145, 'A1101', false],
      [110, 'A1102', true],
    ],
  );
  assert.deepEqual(
    rows.sectors.map((row) => [row.code, row.parent]),
    [
      [110, null],
      [145, 110],
    ],
  );
  assert.equal(fileRecords.sectors, 1);
  assert.equal(fileRecords.subSectors, 1);
  assert.equal(rows.macroRiasec[0].minor, null);
});

test('invalid source rows are rejected, never silently loaded', () => {
  const cases = [
    [
      { mobility: '"code_rome","cible","numero_ordre"\n"A1101","A1102","1"' },
      /unexpected header/,
    ],
    [{ mobility: `${minimalTexts().mobility}\n"A1101","A1101","2"` }, /itself/],
    [
      { mobility: `${minimalTexts().mobility}\n"A1101","A1102","2"` },
      /duplicate key/,
    ],
    [
      {
        occupationRiasec:
          '"code_rome","riasec_majeur","riasec_mineur"\n"A1101","X",""',
      },
      /RIASEC major/,
    ],
    [
      {
        occupationRiasec:
          '"code_rome","riasec_majeur","riasec_mineur"\n"A1101","R","R"',
      },
      /repeats/,
    ],
    [
      {
        macroRiasec:
          '"code_ogr","riasec_majeur","riasec_mineur"\n"104292","","S"',
      },
      /RIASEC major/,
    ],
    [
      { centreLinks: minimalTexts().centreLinks.replace('"1","J', '"9","J') },
      /unknown centre/,
    ],
    [
      {
        centreLinks: minimalTexts().centreLinks.replace('"oui"', '"peut-être"'),
      },
      /oui\/non/,
    ],
    [
      { texts: minimalTexts().texts.replace('definition', 'resume') },
      /unknown text kind/,
    ],
    [
      { subSectors: minimalTexts().subSectors.replace('"110"', '"999"') },
      /unknown parent/,
    ],
  ];
  for (const [override, message] of cases) {
    assert.throws(() => buildExplorationRows(minimalTexts(override)), message);
  }
});

test(
  'the real v61 archive validates with the expected record counts',
  {
    skip: existsSync(ZIP)
      ? false
      : 'ROME/RefRomeCsv.zip is not present (git-ignored source data)',
  },
  () => {
    const archive = unzipSync(new Uint8Array(readFileSync(ZIP)));
    const texts = Object.fromEntries(
      Object.entries(EXPLORATION_FILES).map(([kind, { file }]) => [
        kind,
        new TextDecoder('utf-8', { fatal: true }).decode(archive[file]),
      ]),
    );
    const { rows, fileRecords } = buildExplorationRows(texts);
    // 149 macro-competences carry no RIASEC code in the source.
    assert.equal(rows.macroRiasec.length, 357);
    assert.deepEqual(fileRecords, {
      mobility: 18458,
      occupationRiasec: 1911,
      macroRiasec: 506,
      centres: 30,
      centreLinks: 5663,
      sectors: 35,
      subSectors: 40,
      sectorLinks: 4306,
      texts: 14946,
    });
  },
);

test('migration 059 guards every new source table against update and delete', () => {
  const sql = readFileSync(
    new URL(
      '../database/migrations/059_rome_exploration_sources.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const tables = [...sql.matchAll(/CREATE TABLE praxis\.(\w+)/g)].map(
    (match) => match[1],
  );
  const guarded = sql.match(
    /FOREACH source_table IN ARRAY ARRAY\[([^\]]+)\]/,
  )[1];
  for (const table of tables) {
    assert.match(
      guarded,
      new RegExp(`'${table}'`),
      `${table} has no immutability trigger`,
    );
  }
  assert.match(sql, /-- rollback:/);
});
