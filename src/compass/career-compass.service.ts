import type { Pool } from 'pg';
import type {
  CompassDestination,
  CompassResult,
  CompassSkill,
} from './career-compass.types.js';

export class StandaloneCareerCompass {
  constructor(private readonly pool: Pool) {}

  /**
   * Explores career horizons and bridge skills from an origin occupation.
   * @param occupationId ESCO occupation ID or concept URI (e.g. 'occupation_esco_d3edb8f83a0647a08fb99b212c006aa2')
   * @param locale Language ('fr' or 'en')
   * @param limit Max destination occupations to return (default: 6)
   */
  async explore(
    occupationId: string,
    locale: 'fr' | 'en' = 'fr',
    limit = 6,
  ): Promise<CompassResult> {
    if (!occupationId.trim()) throw new TypeError('Occupation is required');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Compass limit must be between 1 and 100');
    // 1. Resolve origin label
    const originInfo = await this.pool.query<{
      concept_uri: string;
      label: string;
    }>(
      `WITH release AS (
         SELECT id FROM praxis.esco_releases WHERE is_active
         ORDER BY CASE WHEN language=$2 THEN 0 WHEN language='en' THEN 1 ELSE 2 END,
           imported_at DESC LIMIT 1
       ), origin AS (
         SELECT concept_uri FROM praxis.esco_occupations
         WHERE 'occupation_esco_' || replace(concept_id::text,'-','') = $1 OR concept_uri=$1
         UNION
         SELECT esco_occupation_uri FROM praxis.occupation WHERE id = $1
       )
       SELECT o.concept_uri, coalesce(v.preferred_label, po.label_fr) AS label
       FROM origin o
       JOIN release r ON true
       LEFT JOIN praxis.esco_occupation_versions v ON v.occupation_uri = o.concept_uri AND v.release_id = r.id
       LEFT JOIN praxis.occupation po ON po.esco_occupation_uri = o.concept_uri
       LIMIT 1`,
      [occupationId, locale],
    );

    const originLabel = originInfo.rows[0]?.label ?? occupationId;

    // 2. Query ESCO shared essential skills
    const result = await this.pool.query<{
      occupationId: string;
      conceptUri: string;
      label: string;
      description: string;
      language: string;
      shared: number;
      weightedCoverage: number;
      skills: CompassSkill[];
    }>(
      `WITH release AS (
         SELECT id FROM praxis.esco_releases WHERE is_active
         ORDER BY CASE WHEN language=$2 THEN 0 WHEN language='en' THEN 1 ELSE 2 END,
           imported_at DESC LIMIT 1
       ), origin AS (
         SELECT concept_uri FROM praxis.esco_occupations
         WHERE 'occupation_esco_' || replace(concept_id::text,'-','') = $1 OR concept_uri=$1
         UNION
         SELECT esco_occupation_uri FROM praxis.occupation WHERE id = $1
       ), relations AS MATERIALIZED (
         SELECT DISTINCT r.occupation_uri,r.skill_uri FROM praxis.esco_occupation_skill_relations r
         JOIN release ON release.id=r.release_id WHERE r.relationship_type='essential'
       ), skill_weights AS (
         SELECT skill_uri, 1 + ln(
           ((SELECT count(DISTINCT occupation_uri) FROM relations) + 1.0) /
           (count(DISTINCT occupation_uri) + 1.0)) AS weight
         FROM relations GROUP BY skill_uri
       ), destination_totals AS (
         SELECT occupation_uri,sum(weight) AS total_weight FROM relations JOIN skill_weights USING(skill_uri)
         GROUP BY occupation_uri
       ), base AS (
         SELECT DISTINCT skill_uri FROM relations
         WHERE occupation_uri IN (SELECT concept_uri FROM origin)
       ), candidates AS (
         SELECT r.occupation_uri, count(DISTINCT r.skill_uri)::int AS shared,
                (sum(w.weight) / totals.total_weight)::double precision AS weighted_coverage
         FROM relations r JOIN skill_weights w USING(skill_uri)
         JOIN destination_totals totals USING(occupation_uri)
         JOIN base USING(skill_uri)
         WHERE r.occupation_uri NOT IN (SELECT concept_uri FROM origin WHERE concept_uri IS NOT NULL)
         GROUP BY r.occupation_uri,totals.total_weight
         ORDER BY weighted_coverage DESC, shared DESC, r.occupation_uri
         LIMIT $3
       )
       SELECT
         'occupation_esco_' || replace(o.concept_id::text,'-','') AS "occupationId",
         c.occupation_uri AS "conceptUri",
         v.preferred_label AS label,
         v.description,
         v.language,
         c.shared,
         c.weighted_coverage AS "weightedCoverage",
         jsonb_agg(jsonb_build_object(
           'skillId', coalesce(s.id, 'skill_esco_' || replace(es.concept_id::text,'-','')),
           'label', sv.preferred_label,
           'targetLevel', coalesce(t.target_level, 3),
           'reviewed', coalesce(t.profile_source = 'authored',false),
           'shared', b.skill_uri IS NOT NULL
         ) ORDER BY sv.preferred_label) AS skills
       FROM candidates c
       JOIN release ON true
       JOIN praxis.esco_occupations o ON o.concept_uri = c.occupation_uri
       JOIN praxis.esco_occupation_versions v ON v.occupation_uri = c.occupation_uri AND v.release_id = release.id
       JOIN relations r ON r.occupation_uri = c.occupation_uri
       JOIN praxis.esco_skills es ON es.concept_uri = r.skill_uri
       JOIN praxis.esco_skill_versions sv ON sv.skill_uri = r.skill_uri AND sv.release_id = release.id
       LEFT JOIN praxis.skill s ON s.esco_skill_uri = r.skill_uri
       LEFT JOIN praxis.occupation po ON po.esco_occupation_uri = c.occupation_uri
       LEFT JOIN praxis.navigator_role_skill_targets t ON t.role_id = po.id AND t.skill_id = s.id AND t.profile_source = 'authored' AND t.archived_at IS NULL
       LEFT JOIN base b ON b.skill_uri = r.skill_uri
       GROUP BY o.concept_id, c.occupation_uri, v.preferred_label, v.description, v.language, c.shared,c.weighted_coverage
       ORDER BY c.weighted_coverage DESC,c.shared DESC,v.preferred_label`,
      [occupationId, locale, limit],
    );

    const destinations: CompassDestination[] = result.rows.map((row) => {
      const allSkills = row.skills ?? [];
      const sharedSkills = allSkills.filter((s) => s.shared);
      const bridgeSkills = allSkills.filter((s) => !s.shared);
      const totalSkills = allSkills.length;
      const rawOverlapPercentage = totalSkills > 0 ? Math.round((row.shared / totalSkills) * 100) : 0;
      const bridgePercentage = Math.round(row.weightedCoverage * 100);

      return {
        occupationId: row.occupationId,
        conceptUri: row.conceptUri,
        label: row.label,
        description: row.description,
        language: row.language,
        shared: row.shared,
        totalSkills,
        bridgePercentage,
        rawOverlapPercentage,
        similarityScore:row.weightedCoverage,
        sharedSkills,
        bridgeSkills,
        skills: allSkills,
      };
    });

    return {
      originOccupationId: occupationId,
      originLabel,
      metric:'idf_weighted_destination_coverage',
      evidenceBasis:'occupation_taxonomy',
      destinations,
    };
  }

  /**
   * Search occupations by keyword.
   */
  async search(query: string, locale: 'fr' | 'en' = 'fr', limit = 8): Promise<readonly {
    occupationId: string;
    label: string;
    description: string;
  }[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Search limit must be between 1 and 100');
    if (!query.trim()) return [];
    const result = await this.pool.query<{
      occupation_id: string;
      label: string;
      description: string;
    }>(
      `WITH release AS (
         SELECT id FROM praxis.esco_releases WHERE is_active
         ORDER BY CASE WHEN language=$2 THEN 0 WHEN language='en' THEN 1 ELSE 2 END,
           imported_at DESC LIMIT 1
       ), matches AS (
         SELECT
           'occupation_esco_' || replace(o.concept_id::text,'-','') AS occupation_id,
           v.preferred_label AS label,
           coalesce(v.description, '') AS description,
           1 AS priority
         FROM praxis.esco_occupations o
         JOIN release r ON true
         JOIN praxis.esco_occupation_versions v ON v.occupation_uri = o.concept_uri AND v.release_id = r.id
         WHERE v.preferred_label ILIKE '%' || $1 || '%'
         UNION
         SELECT
           po.id AS occupation_id,
           po.label_fr AS label,
           coalesce(po.label_en, '') AS description,
           0 AS priority
         FROM praxis.occupation po
         WHERE po.label_fr ILIKE '%' || $1 || '%' OR po.id ILIKE '%' || $1 || '%'
       )
       SELECT occupation_id, label, description
       FROM matches
       ORDER BY priority ASC, length(label) ASC, label ASC
       LIMIT $3`,
      [query.trim(), locale, limit],
    );

    return result.rows.map((row) => ({
      occupationId: row.occupation_id,
      label: row.label,
      description: row.description,
    }));
  }
}
