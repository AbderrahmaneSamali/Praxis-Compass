import type { Pool } from 'pg';

import { assemblePossibilities, type SourcedDirection } from './possibilities.js';
import {
  compareRequirements,
  groupRequirements,
  sharedSkillsThreshold,
  type JobRequirements,
  type RequirementComparison,
  type RequirementKind,
  type RequirementRow,
} from './requirements.js';
import type {
  Riasec,
  RomeDirection,
  RomeInterestCentre,
  RomeOccupationProfile,
  RomeOrigin,
  RomePossibilities,
} from './rome-explorer.types.js';

const ROME_CODE = /^[A-Z][0-9]{4}$/;

/**
 * France Travail's v61 `texte` export doubles apostrophes ("d''apprentissage")
 * in about 6,500 of its 14,946 sentences, an escaping artifact absent from
 * every other ROME file. Stored rows stay byte-faithful to the source; the
 * artifact is undone only when a sentence is read for display.
 */
export function displayRomeSentence(sentence: string): string {
  return sentence.replace(/''/g, "'");
}

/** The active ROME release every query reads from. */
const ACTIVE_RELEASE = `
  SELECT id FROM praxis.source_releases
  WHERE source = 'rome' AND is_active
  ORDER BY imported_at DESC LIMIT 1`;

/**
 * Read access to the ROME exploration data (migrations 024 and 059).
 * Returns source facts only, each direction with the record that produced it;
 * nothing here scores or ranks a destination.
 */
export class StandaloneRomeExplorer {
  constructor(private readonly pool: Pool) {}

  /** Search the 14k French ROME job titles; one hit per ROME code. */
  async searchOrigins(query: string, limit = 8): Promise<readonly RomeOrigin[]> {
    const text = query.trim();
    if (text.length < 2) return [];
    const result = await this.pool.query<{
      code_rome: string;
      job_label: string;
      matched_title: string;
      matched_ogr: string;
    }>(
      `WITH release AS (${ACTIVE_RELEASE}),
       hits AS (
         SELECT DISTINCT ON (a.code_rome)
                a.code_rome, a.long_label AS matched_title, a.code_ogr::text AS matched_ogr,
                position(lower($1) IN lower(a.long_label)) AS at
         FROM praxis.rome_appellation_versions a JOIN release r ON a.release_id = r.id
         WHERE a.long_label ILIKE '%' || $1 || '%'
         ORDER BY a.code_rome, position(lower($1) IN lower(a.long_label)), length(a.long_label)
       )
       SELECT h.code_rome, v.preferred_label AS job_label, h.matched_title, h.matched_ogr
       FROM hits h
       JOIN release r ON true
       JOIN praxis.rome_occupation_versions v ON v.code_rome = h.code_rome AND v.release_id = r.id
       ORDER BY h.at, length(h.matched_title), h.code_rome
       LIMIT $2`,
      [text, limit],
    );
    return result.rows.map((row) => ({
      codeRome: row.code_rome,
      jobLabel: row.job_label,
      matchedTitle: row.matched_title,
      matchedTitleOgr: row.matched_ogr,
    }));
  }

  async interestCentres(): Promise<readonly RomeInterestCentre[]> {
    const result = await this.pool.query<RomeInterestCentre>(
      `WITH release AS (${ACTIVE_RELEASE})
       SELECT c.centre_code AS code, c.label, c.definition
       FROM praxis.rome_interest_centre_versions c JOIN release r ON c.release_id = r.id
       ORDER BY c.label`,
    );
    return result.rows;
  }

  /** Everything a card or detail page needs about one ROME job. */
  async occupation(codeRome: string): Promise<RomeOccupationProfile | null> {
    if (!ROME_CODE.test(codeRome)) return null;
    return (await this.occupations([codeRome]))[0] ?? null;
  }

  /** Batch projection used by the complete explorer; avoids per-occupation queries. */
  async occupations(codes: readonly string[]): Promise<RomeOccupationProfile[]> {
    if (!codes.length) return [];
    if (codes.some(code => !ROME_CODE.test(code))) throw new Error('Invalid occupation code');
    const result = await this.pool.query<{
      code_rome: string;
      label: string;
      regulated: boolean;
      release_id: string;
      definition: string[] | null;
      access: string[] | null;
      riasec_major: string | null;
      riasec_minor: string | null;
      centres: RomeOccupationProfile['interestCentres'];
      sectors: RomeOccupationProfile['sectors'];
      domains: RomeOccupationProfile['professionalDomains'];
    }>(
      `WITH release AS (${ACTIVE_RELEASE})
       SELECT v.code_rome, v.preferred_label AS label, v.emploi_reglemente AS regulated,
              r.id AS release_id,
              (SELECT array_agg(t.sentence ORDER BY t.position) FROM praxis.rome_occupation_texts t
               WHERE t.release_id = r.id AND t.code_rome = v.code_rome AND t.text_kind = 'definition') AS definition,
              (SELECT array_agg(t.sentence ORDER BY t.position) FROM praxis.rome_occupation_texts t
               WHERE t.release_id = r.id AND t.code_rome = v.code_rome AND t.text_kind = 'acces_metier') AS access,
              x.riasec_major, x.riasec_minor,
              coalesce((SELECT jsonb_agg(jsonb_build_object('code', c.centre_code, 'label', cv.label,
                          'definition', cv.definition, 'principal', c.is_principal)
                        ORDER BY c.is_principal DESC, cv.label)
                        FROM praxis.rome_occupation_interest_centres c
                        JOIN praxis.rome_interest_centre_versions cv
                          ON cv.release_id = c.release_id AND cv.centre_code = c.centre_code
                        WHERE c.release_id = r.id AND c.code_rome = v.code_rome), '[]') AS centres,
              coalesce((SELECT jsonb_agg(jsonb_build_object('code', s.sector_code, 'label', sv.label,
                          'parentLabel', pv.label, 'principal', s.is_principal)
                        ORDER BY s.is_principal DESC, sv.label)
                        FROM praxis.rome_occupation_activity_sectors s
                        JOIN praxis.rome_activity_sector_versions sv
                          ON sv.release_id = s.release_id AND sv.sector_code = s.sector_code
                        LEFT JOIN praxis.rome_activity_sector_versions pv
                          ON pv.release_id = sv.release_id AND pv.sector_code = sv.parent_sector_code
                        WHERE s.release_id = r.id AND s.code_rome = v.code_rome), '[]') AS sectors,
              coalesce((SELECT jsonb_agg(jsonb_build_object('code', d.domain_code, 'label', dv.domain_label,
                          'grandDomain', dv.grand_domain_label) ORDER BY dv.domain_label)
                        FROM praxis.rome_occupation_professional_domains d
                        JOIN praxis.rome_professional_domain_versions dv
                          ON dv.release_id = d.release_id AND dv.domain_code = d.domain_code
                        WHERE d.release_id = r.id AND d.code_rome = v.code_rome), '[]') AS domains
       FROM release r
       JOIN praxis.rome_occupation_versions v ON v.release_id = r.id AND v.code_rome = ANY($1::text[])
       LEFT JOIN praxis.rome_occupation_riasec x ON x.release_id = r.id AND x.code_rome = v.code_rome`,
      [codes],
    );
    return result.rows.map(row => ({
      codeRome: row.code_rome,
      label: row.label,
      definition: (row.definition ?? []).map(displayRomeSentence),
      access: (row.access ?? []).map(displayRomeSentence),
      riasec: row.riasec_major ? { major: row.riasec_major, minor: row.riasec_minor } : null,
      interestCentres: row.centres,
      sectors: row.sectors,
      professionalDomains: row.domains,
      regulated: row.regulated,
      releaseId: row.release_id,
    }));
  }

  /** France Travail's mobility links from a job, in their own order. */
  async mobility(codeRome: string): Promise<readonly RomeDirection[]> {
    if (!ROME_CODE.test(codeRome)) return [];
    const result = await this.pool.query<{
      code_rome: string;
      label: string;
      display_order: number;
      riasec_major: string | null;
      riasec_minor: string | null;
      release_id: string;
    }>(
      `WITH release AS (${ACTIVE_RELEASE})
       SELECT m.target_code_rome AS code_rome, v.preferred_label AS label, m.display_order,
              x.riasec_major, x.riasec_minor, r.id AS release_id
       FROM release r
       JOIN praxis.rome_mobility m ON m.release_id = r.id AND m.code_rome = $1
       JOIN praxis.rome_occupation_versions v ON v.release_id = r.id AND v.code_rome = m.target_code_rome
       LEFT JOIN praxis.rome_occupation_riasec x ON x.release_id = r.id AND x.code_rome = m.target_code_rome
       ORDER BY m.display_order, m.target_code_rome`,
      [codeRome],
    );
    return result.rows.map((row) => ({
      codeRome: row.code_rome,
      label: row.label,
      riasec: row.riasec_major ? { major: row.riasec_major, minor: row.riasec_minor } : null,
      reasons: [
        {
          kind: 'rome_mobility',
          fromCodeRome: codeRome,
          toCodeRome: row.code_rome,
          sourceOrder: row.display_order,
          releaseId: row.release_id,
        },
      ],
    }));
  }

  /** Jobs linked to one interest statement, in neutral (alphabetical) order. */
  async occupationsForInterest(centreCode: number): Promise<readonly RomeDirection[]> {
    if (!Number.isInteger(centreCode) || centreCode <= 0) return [];
    const result = await this.pool.query<{
      code_rome: string;
      label: string;
      principal: boolean;
      centre_label: string;
      riasec_major: string | null;
      riasec_minor: string | null;
      release_id: string;
    }>(
      `WITH release AS (${ACTIVE_RELEASE})
       SELECT c.code_rome, v.preferred_label AS label, c.is_principal AS principal,
              cv.label AS centre_label, x.riasec_major, x.riasec_minor, r.id AS release_id
       FROM release r
       JOIN praxis.rome_occupation_interest_centres c ON c.release_id = r.id AND c.centre_code = $1
       JOIN praxis.rome_interest_centre_versions cv ON cv.release_id = r.id AND cv.centre_code = c.centre_code
       JOIN praxis.rome_occupation_versions v ON v.release_id = r.id AND v.code_rome = c.code_rome
       LEFT JOIN praxis.rome_occupation_riasec x ON x.release_id = r.id AND x.code_rome = c.code_rome
       ORDER BY v.preferred_label, c.code_rome`,
      [centreCode],
    );
    return result.rows.map((row) => ({
      codeRome: row.code_rome,
      label: row.label,
      riasec: row.riasec_major ? { major: row.riasec_major, minor: row.riasec_minor } : null,
      reasons: [
        {
          kind: 'rome_interest_centre',
          centreCode,
          centreLabel: row.centre_label,
          principal: row.principal,
          releaseId: row.release_id,
        },
      ],
    }));
  }

  /**
   * What a job requires: savoir-faire grouped by domain › stake, savoir-être,
   * savoirs grouped by category, and work contexts.
   */
  async requirements(
    codeRome: string,
  ): Promise<(JobRequirements & Readonly<{ codeRome: string; label: string; releaseId: string }>) | null> {
    if (!ROME_CODE.test(codeRome)) return null;
    const found = (await this.jobLabels([codeRome])).get(codeRome);
    if (!found) return null;
    const rows = await this.requirementRows([codeRome]);
    return { codeRome, label: found.label, releaseId: found.releaseId, ...groupRequirements(rows) };
  }

  async requirementsFor(codes: readonly string[]): Promise<Map<string, JobRequirements>> {
    if (!codes.length) return new Map();
    if (codes.some(code => !ROME_CODE.test(code))) throw new Error('Invalid occupation code');
    const grouped = new Map<string, RequirementRow[]>();
    for (const row of await this.requirementRows(codes)) {
      const items = grouped.get(row.codeRome) ?? [];
      items.push(row);
      grouped.set(row.codeRome, items);
    }
    return new Map(codes.map(code => [code, groupRequirements(grouped.get(code) ?? [])]));
  }

  /**
   * Two or three jobs side by side: what they all require, what some do,
   * what only one does, and how each is entered.
   */
  async compare(codes: readonly string[]): Promise<
    Readonly<{
      jobs: readonly Readonly<{
        codeRome: string;
        label: string;
        riasec: Riasec | null;
        access: readonly string[];
      }>[];
      requirements: RequirementComparison;
      releaseId: string;
    }>
  > {
    if (codes.length < 2 || codes.length > 3) throw new Error('Compare two or three jobs');
    if (new Set(codes).size !== codes.length) throw new Error('Compare different jobs');
    for (const code of codes) {
      if (!ROME_CODE.test(code)) throw new Error(`Invalid ROME code ${JSON.stringify(code)}`);
    }
    const profiles = await Promise.all(codes.map((code) => this.occupation(code)));
    const missing = codes.filter((_, index) => !profiles[index]);
    if (missing.length > 0) throw new Error(`Unknown ROME code(s): ${missing.join(', ')}`);
    const rows = await this.requirementRows(codes);
    return {
      jobs: profiles.map((profile) => ({
        codeRome: profile!.codeRome,
        label: profile!.label,
        riasec: profile!.riasec,
        access: profile!.access,
      })),
      requirements: compareRequirements(codes, rows),
      releaseId: profiles[0]!.releaseId,
    };
  }

  /**
   * The possibilities map: directions from the learner's current job (ROME
   * mobility and shared savoir-faire) and from the interests they confirmed.
   * Either input may be absent; with neither, every group is empty.
   */
  async possibilities(
    input: Readonly<{ originCodeRome?: string; domainCode?: string; interestCentres?: readonly number[]; limit?: number | null; includeOrigin?: boolean }>,
  ): Promise<RomePossibilities> {
    const limit = input.limit === undefined ? 12 : input.limit;
    const origin = input.originCodeRome ?? null;
    if (origin !== null && !ROME_CODE.test(origin)) {
      throw new Error(`Invalid ROME code ${JSON.stringify(origin)}`);
    }
    const centres = [...new Set(input.interestCentres ?? [])];
    if (!centres.every((code) => Number.isInteger(code) && code > 0)) {
      throw new Error('Interest centres are positive integer codes');
    }
    const release = await this.pool.query<{ id: string }>(ACTIVE_RELEASE);
    const releaseId = release.rows[0]?.id;
    if (!releaseId) throw new Error('No active ROME release');

    let originFacts: { codeRome: string; label: string } | null = null;
    if (origin) {
      const found = (await this.jobLabels([origin])).get(origin);
      if (!found) throw new Error(`Unknown ROME code ${origin}`);
      originFacts = { codeRome: origin, label: found.label };
    }
    const confirmed = centres.length
      ? (
          await this.pool.query<{ code: number; label: string }>(
            `SELECT centre_code AS code, label FROM praxis.rome_interest_centre_versions
             WHERE release_id = $1 AND centre_code = ANY($2::integer[]) ORDER BY label`,
            [releaseId, centres],
          )
        ).rows
      : [];
    if (confirmed.length !== centres.length) throw new Error('Unknown interest centre');

    const [mobility, interests, sharedSkills] = await Promise.all([
      origin ? this.mobility(origin) : Promise.resolve([]),
      centres.length ? this.interestDirections(releaseId, centres) : Promise.resolve([]),
      origin ? this.sharedSkillDirections(releaseId, origin) : Promise.resolve([]),
    ]);
    const domainRows = input.domainCode ? (await this.pool.query<{code_rome:string;label:string;domain_label:string}>(
      `SELECT v.code_rome,v.preferred_label AS label,dv.domain_label
       FROM praxis.rome_occupation_professional_domains d
       JOIN praxis.rome_occupation_versions v ON v.release_id=d.release_id AND v.code_rome=d.code_rome
       JOIN praxis.rome_professional_domain_versions dv ON dv.release_id=d.release_id AND dv.domain_code=d.domain_code
       WHERE d.release_id=$1 AND d.domain_code=$2`,[releaseId,input.domainCode])).rows : [];
    const allowed = new Set(domainRows.map(row=>row.code_rome));
    const inScope = (items: readonly SourcedDirection[]) => input.domainCode ? items.filter(item=>allowed.has(item.codeRome)) : items;
    const domain: SourcedDirection[] = domainRows.map(row=>({codeRome:row.code_rome,label:row.label,riasec:null,
      reasons:[{kind:'rome_domain',domainCode:input.domainCode!,domainLabel:row.domain_label,releaseId}]}));
    return {
      origin: originFacts,
      confirmedInterests: confirmed,
      groups: assemblePossibilities(
        { originCodeRome: origin, includeOrigin: input.includeOrigin, domain, mobility:inScope(mobility), interests:inScope(interests), sharedSkills:inScope(sharedSkills) },
        limit,
      ),
      releaseId,
    };
  }

  private async jobLabels(codes: readonly string[]) {
    const result = await this.pool.query<{ code_rome: string; label: string; release_id: string }>(
      `WITH release AS (${ACTIVE_RELEASE})
       SELECT v.code_rome, v.preferred_label AS label, r.id AS release_id
       FROM release r JOIN praxis.rome_occupation_versions v
         ON v.release_id = r.id AND v.code_rome = ANY($1::text[])`,
      [codes],
    );
    return new Map(
      result.rows.map((row) => [row.code_rome, { label: row.label, releaseId: row.release_id }]),
    );
  }

  private async requirementRows(codes: readonly string[]): Promise<readonly RequirementRow[]> {
    const result = await this.pool.query<{
      code_rome: string;
      ogr: string;
      kind: RequirementKind;
      label: string | null;
      group_label: string | null;
      subgroup_label: string | null;
    }>(
      `WITH release AS (${ACTIVE_RELEASE}),
       macro_path AS (
         SELECT DISTINCT h.release_id, h.macro_competence_ogr AS ogr, h.domain_label, h.issue_label
         FROM praxis.rome_competence_hierarchy h JOIN release r ON h.release_id = r.id
       )
       SELECT l.code_rome, l.code_ogr::text AS ogr,
              CASE WHEN l.composition_bloc_code = '6' THEN 'work_context'
                   WHEN l.rubrique_code = '1' THEN 'savoir_faire'
                   WHEN l.rubrique_code = '2' THEN 'savoir_etre'
                   ELSE 'savoir' END AS kind,
              coalesce(c.label, s.label, w.label, iv.label) AS label,
              coalesce(h.domain_label, mp.domain_label, s.category, w.context_type_label) AS group_label,
              coalesce(h.issue_label, mp.issue_label, s.subcategory) AS subgroup_label
       FROM release r
       JOIN praxis.rome_fiche_item_links l ON l.release_id = r.id AND l.code_rome = ANY($1::text[])
         AND (l.composition_bloc_code = '6'
              OR (l.composition_bloc_code = '5' AND l.rubrique_code IN ('1', '2', '3')))
       LEFT JOIN praxis.rome_competence_versions c ON c.release_id = r.id AND c.code_ogr = l.code_ogr
       LEFT JOIN praxis.rome_competence_hierarchy h ON h.release_id = r.id AND h.competence_ogr = l.code_ogr
       LEFT JOIN macro_path mp ON mp.release_id = r.id AND mp.ogr = l.code_ogr
       LEFT JOIN praxis.rome_savoir_versions s ON s.release_id = r.id AND s.code_ogr = l.code_ogr
       LEFT JOIN praxis.rome_work_context_versions w ON w.release_id = r.id AND w.code_ogr = l.code_ogr
       LEFT JOIN praxis.rome_item_versions iv ON iv.release_id = r.id AND iv.code_ogr = l.code_ogr
         AND iv.item_kind = 'macro_competence'`,
      [codes],
    );
    return result.rows.map((row) => {
      if (!row.label) throw new Error(`ROME item ${row.ogr} of ${row.code_rome} has no label`);
      return {
        codeRome: row.code_rome,
        ogr: row.ogr,
        kind: row.kind,
        label: row.label,
        // Savoir-être are listed flat; their hierarchy adds nothing to read.
        group: row.kind === 'savoir_etre' ? null : row.group_label,
        subgroup: row.kind === 'savoir_etre' ? null : row.subgroup_label,
      };
    });
  }

  private async interestDirections(
    releaseId: string,
    centres: readonly number[],
  ): Promise<readonly SourcedDirection[]> {
    const result = await this.pool.query<{
      code_rome: string;
      label: string;
      riasec_major: string | null;
      riasec_minor: string | null;
      centre_code: number;
      centre_label: string;
      principal: boolean;
    }>(
      `SELECT c.code_rome, v.preferred_label AS label, x.riasec_major, x.riasec_minor,
              c.centre_code, cv.label AS centre_label, c.is_principal AS principal
       FROM praxis.rome_occupation_interest_centres c
       JOIN praxis.rome_interest_centre_versions cv
         ON cv.release_id = c.release_id AND cv.centre_code = c.centre_code
       JOIN praxis.rome_occupation_versions v ON v.release_id = c.release_id AND v.code_rome = c.code_rome
       LEFT JOIN praxis.rome_occupation_riasec x ON x.release_id = c.release_id AND x.code_rome = c.code_rome
       WHERE c.release_id = $1 AND c.centre_code = ANY($2::integer[])
       ORDER BY c.code_rome, c.centre_code`,
      [releaseId, centres],
    );
    return result.rows.map((row) => ({
      codeRome: row.code_rome,
      label: row.label,
      riasec: row.riasec_major ? { major: row.riasec_major, minor: row.riasec_minor } : null,
      reasons: [
        {
          kind: 'rome_interest_centre' as const,
          centreCode: row.centre_code,
          centreLabel: row.centre_label,
          principal: row.principal,
          releaseId,
        },
      ],
    }));
  }

  private async sharedSkillDirections(
    releaseId: string,
    origin: string,
  ): Promise<readonly SourcedDirection[]> {
    const originSkills = await this.pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM praxis.rome_fiche_item_links
       WHERE release_id = $1 AND code_rome = $2
         AND composition_bloc_code = '5' AND rubrique_code = '1'`,
      [releaseId, origin],
    );
    const originCount = originSkills.rows[0]?.count ?? 0;
    if (originCount === 0) return [];
    const result = await this.pool.query<{
      code_rome: string;
      label: string;
      riasec_major: string | null;
      riasec_minor: string | null;
      shared: string[];
    }>(
      `WITH origin AS (
         SELECT code_ogr FROM praxis.rome_fiche_item_links
         WHERE release_id = $1 AND code_rome = $2
           AND composition_bloc_code = '5' AND rubrique_code = '1'
       ), overlap AS (
         SELECT l.code_rome, array_agg(l.code_ogr::text ORDER BY l.code_ogr) AS shared
         FROM praxis.rome_fiche_item_links l JOIN origin USING (code_ogr)
         WHERE l.release_id = $1 AND l.code_rome <> $2
           AND l.composition_bloc_code = '5' AND l.rubrique_code = '1'
         GROUP BY l.code_rome
         HAVING count(*) >= $3
       )
       SELECT o.code_rome, v.preferred_label AS label, x.riasec_major, x.riasec_minor, o.shared
       FROM overlap o
       JOIN praxis.rome_occupation_versions v ON v.release_id = $1 AND v.code_rome = o.code_rome
       LEFT JOIN praxis.rome_occupation_riasec x ON x.release_id = $1 AND x.code_rome = o.code_rome`,
      [releaseId, origin, sharedSkillsThreshold(originCount)],
    );
    return result.rows.map((row) => ({
      codeRome: row.code_rome,
      label: row.label,
      riasec: row.riasec_major ? { major: row.riasec_major, minor: row.riasec_minor } : null,
      reasons: [
        {
          kind: 'rome_shared_skills' as const,
          fromCodeRome: origin,
          sharedSkillOgrs: row.shared,
          originSkillCount: originCount,
          releaseId,
        },
      ],
    }));
  }
}
