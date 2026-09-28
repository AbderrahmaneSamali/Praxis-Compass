import type { Pool } from 'pg';
import type { RoleDirection, StartingProfile, DirectionKind, SourceReference, DevelopmentAction } from './exploration.types.js';
import type { RomeConfirmation } from './exploration.types.js';
import { StandaloneRomeExplorer } from './rome-explorer.js';

type DirectionRow = { id: string; role_id: string; kind: DirectionKind; title_fr: string; description_fr: string;
  responsibilities_fr: string[]; interest_tags_fr: string[]; source_label: string; source_reference: string;
  review_status: SourceReference['reviewStatus']; skill_id: string | null; label: string | null;
  target_level: number | null; importance: number | null; source_version: string | null;
  esco_occupation_uri: string | null };

export class ExplorationRepository {
  constructor(private readonly pool: Pool) {}

  private get rome() { return new StandaloneRomeExplorer(this.pool); }

  async profile(learnerId: string): Promise<StartingProfile> {
    const [result, confirmed] = await Promise.all([
      this.pool.query<{ current_role_id: string | null; current_rome_code: string | null; current_rome_label: string | null; preferred_domain_code: string | null; preferred_domain_label: string | null;
        experience: string; interests: string; constraints_text: string; updated_at: Date }>(
        `SELECT p.current_role_id,p.current_rome_code,p.experience,p.interests,p.constraints_text,p.updated_at,
          p.preferred_domain_code,dv.domain_label AS preferred_domain_label,
          v.preferred_label AS current_rome_label FROM praxis.exploration_profile p
         LEFT JOIN praxis.source_releases r ON r.source='rome' AND r.is_active
         LEFT JOIN praxis.rome_occupation_versions v ON v.release_id=r.id AND v.code_rome=p.current_rome_code
         LEFT JOIN praxis.rome_professional_domain_versions dv ON dv.release_id=r.id AND dv.domain_code=p.preferred_domain_code
         WHERE p.learner_id=$1`, [learnerId]),
      this.pool.query<{ centre_code: number }>(
        'SELECT centre_code FROM praxis.exploration_confirmed_interest WHERE learner_id=$1 ORDER BY centre_code', [learnerId]),
    ]);
    const row = result.rows[0];
    return { learnerId, currentRoleId: row?.current_role_id ?? null,
      currentRomeCode: row?.current_rome_code ?? null, currentRomeLabel: row?.current_rome_label ?? null,
      preferredDomainCode: row?.preferred_domain_code ?? null, preferredDomainLabel: row?.preferred_domain_label ?? null,
      confirmedInterestCodes: confirmed.rows.map(item => item.centre_code), experience: row?.experience ?? '',
      interests: row?.interests ?? '', constraints: row?.constraints_text ?? '', updatedAt: row?.updated_at?.toISOString() ?? null };
  }

  async saveRomeProfile(profile: StartingProfile): Promise<StartingProfile> {
    const centres = [...new Set(profile.confirmedInterestCodes ?? [])];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO praxis.exploration_profile
        (learner_id,current_rome_code,experience,interests,constraints_text,preferred_domain_code)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (learner_id) DO UPDATE SET current_rome_code=EXCLUDED.current_rome_code,
          preferred_domain_code=EXCLUDED.preferred_domain_code,
          experience=EXCLUDED.experience,interests=EXCLUDED.interests,
          constraints_text=EXCLUDED.constraints_text,updated_at=clock_timestamp()`,
        [profile.learnerId, profile.currentRomeCode ?? null, profile.experience, profile.interests, profile.constraints, profile.preferredDomainCode ?? null]);
      await client.query('DELETE FROM praxis.exploration_confirmed_interest WHERE learner_id=$1', [profile.learnerId]);
      for (const code of centres) {
        await client.query('INSERT INTO praxis.exploration_confirmed_interest(learner_id,centre_code) VALUES ($1,$2)',
          [profile.learnerId, code]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return this.profile(profile.learnerId);
  }

  async romeDirections(profile: StartingProfile): Promise<RoleDirection[]> {
    if (!profile.preferredDomainCode && !profile.currentRomeCode && !(profile.confirmedInterestCodes?.length)) return [];
    const map = await this.rome.possibilities({
      originCodeRome: profile.currentRomeCode ?? undefined,
      domainCode: profile.preferredDomainCode ?? undefined,
      interestCentres: profile.confirmedInterestCodes ?? [], limit: null, includeOrigin: true,
    });
    const unique = new Map<string, typeof map.groups.mobility.items[number]>();
    for (const group of [map.groups.domain, map.groups.mobility, map.groups.interests, map.groups.sharedSkills]) {
      for (const item of group.items) if (!unique.has(item.codeRome)) unique.set(item.codeRome, item);
    }
    const explorer = this.rome;
    const codes = [...unique.keys()];
    const [profiles, jobs] = await Promise.all([explorer.occupations(codes), explorer.requirementsFor(codes)]);
    const byCode = new Map(profiles.map(item => [item.codeRome, item]));
    return [...unique.values()].map((item): RoleDirection => {
      const occupation = byCode.get(item.codeRome), job = jobs.get(item.codeRome);
      if (!occupation || !job) throw new Error(`ROME direction ${item.codeRome} disappeared`);
      const source: SourceReference = { label: 'Fiches métiers de France Travail',
        reference: `rome:${map.releaseId}:${item.codeRome}`, reviewStatus: 'official_source' };
      const items = [
        ...job.savoirFaire.flatMap(group => group.subgroups.flatMap(sub => sub.items.map(entry => ({...entry, kind: 'savoir_faire' as const})))),
        ...job.savoirEtre.map(entry => ({...entry, kind: 'savoir_etre' as const})),
        ...job.savoirs.flatMap(group => group.subgroups.flatMap(sub => sub.items.map(entry => ({...entry, kind: 'savoir' as const})))),
      ];
      const seen = new Set<string>();
      const requirements = items.filter(entry => { const key=`${entry.kind}:${entry.ogr}`; if(seen.has(key))return false; seen.add(key); return true; })
        .map(entry => ({ skillId: `rome:${entry.ogr}`, romeOgr: entry.ogr, requirementKind: entry.kind,
          label: entry.label, targetLevel: null, importance: null,
          source: { ...source, reference: `rome:${map.releaseId}:item:${entry.ogr}` } }));
      const workContexts = job.workContexts.flatMap(group => group.subgroups.flatMap(sub => sub.items));
      return { id: `rome:${item.codeRome}`, roleId: `rome:${item.codeRome}`, romeCode: item.codeRome,
        kind: 'rome_exploration', title: occupation.label,
        description: occupation.definition.join(' '), responsibilities: occupation.definition,
        interestTags: [], requirements, workContexts, reasons: item.reasons, romeProfile: occupation,
        sources: [source] };
    });
  }

  async romeConfirmations(learnerId: string): Promise<RomeConfirmation[]> {
    const result = await this.pool.query<{ id: string; ogr: string; response: RomeConfirmation['response']; work_example: string }>(
      `SELECT q.id,q.code_ogr::text AS ogr,q.response,q.work_example FROM praxis.rome_requirement_confirmation q
       JOIN praxis.source_releases r ON r.id=q.release_id AND r.source='rome' AND r.is_active
       WHERE q.learner_id=$1 AND q.superseded_by IS NULL ORDER BY q.recorded_at DESC,q.id DESC`, [learnerId]);
    return result.rows.map(row => ({id:row.id,ogr:row.ogr,response:row.response,workExample:row.work_example}));
  }

  async confirmRomeRequirement(learnerId: string, ogr: string, releaseId: string,
    response: RomeConfirmation['response'], workExample: string, practiceContextId: string | null = null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [learnerId]);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO praxis.rome_requirement_confirmation(learner_id,code_ogr,release_id,response,work_example,practice_context_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [learnerId,ogr,releaseId,response,workExample,practiceContextId]);
      await client.query(`UPDATE praxis.rome_requirement_confirmation SET superseded_by=$1
        WHERE learner_id=$2 AND code_ogr=$3 AND superseded_by IS NULL AND id<>$1`,
        [inserted.rows[0]!.id,learnerId,ogr]);
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async saveProfile(profile: StartingProfile): Promise<StartingProfile> {
    await this.pool.query(`INSERT INTO praxis.exploration_profile
      (learner_id,current_role_id,experience,interests,constraints_text) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (learner_id) DO UPDATE SET current_role_id=EXCLUDED.current_role_id,
      experience=EXCLUDED.experience,interests=EXCLUDED.interests,
      constraints_text=EXCLUDED.constraints_text,updated_at=clock_timestamp()`,
    [profile.learnerId,profile.currentRoleId,profile.experience,profile.interests,profile.constraints]);
    return this.profile(profile.learnerId);
  }

  async directions(): Promise<RoleDirection[]> {
    const result = await this.pool.query<DirectionRow>(`SELECT d.*,o.esco_occupation_uri,t.skill_id,t.label,t.target_level,t.importance,
      t.source_version FROM praxis.exploration_direction d
      JOIN praxis.occupation o ON o.id=d.role_id AND o.status='published'
      LEFT JOIN praxis.navigator_role_skill_targets t ON t.role_id=d.role_id
        AND t.archived_at IS NULL AND t.profile_source='authored'
      WHERE d.active=true ORDER BY d.id,t.importance DESC,t.label`);
    const grouped = new Map<string, RoleDirection>();
    for (const row of result.rows) {
      const directionSource: SourceReference = { label: row.source_label, reference: row.source_reference,
        reviewStatus: row.review_status };
      let direction = grouped.get(row.id);
      if (!direction) {
        direction = { id: row.id, roleId: row.role_id, kind: row.kind, title: row.title_fr,
          description: row.description_fr, responsibilities: row.responsibilities_fr,
          interestTags: row.interest_tags_fr, requirements: [], sources: [directionSource,
            ...(row.esco_occupation_uri ? [{ label: 'Ancrage de métier ESCO', reference: row.esco_occupation_uri,
              reviewStatus: 'demo_unreviewed' as const }] : [])] };
        grouped.set(row.id, direction);
      }
      if (row.skill_id && row.label && row.target_level !== null && row.importance !== null) {
        (direction.requirements as Array<RoleDirection['requirements'][number]>).push({ skillId: row.skill_id,
          label: row.label, targetLevel: row.target_level, importance: row.importance,
          source: { label: 'Profil de compétences éditorial PRAXIS', reference: row.source_version ?? '',
            reviewStatus: 'demo_unreviewed' } });
      }
    }
    return [...grouped.values()].filter(item => item.requirements.length > 0);
  }

  async savedDirections(learnerId: string): Promise<string[]> {
    const [demo, rome] = await Promise.all([
      this.pool.query<{ direction_id: string }>(
        'SELECT direction_id FROM praxis.exploration_saved_direction WHERE learner_id=$1 ORDER BY saved_at', [learnerId]),
      this.pool.query<{ code_rome: string }>(
        'SELECT code_rome FROM praxis.exploration_saved_rome_direction WHERE learner_id=$1 ORDER BY saved_at', [learnerId]),
    ]);
    return [...demo.rows.map(row => row.direction_id),...rome.rows.map(row => `rome:${row.code_rome}`)];
  }

  async saveDirection(learnerId: string, directionId: string, saved: boolean): Promise<void> {
    if (/^rome:[A-Z][0-9]{4}$/.test(directionId)) {
      const code = directionId.slice(5);
      if(saved) await this.pool.query(`INSERT INTO praxis.exploration_saved_rome_direction(learner_id,code_rome)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`,[learnerId,code]);
      else await this.pool.query('DELETE FROM praxis.exploration_saved_rome_direction WHERE learner_id=$1 AND code_rome=$2',[learnerId,code]);
      return;
    }
    if (saved) await this.pool.query(`INSERT INTO praxis.exploration_saved_direction(learner_id,direction_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING`, [learnerId,directionId]);
    else await this.pool.query('DELETE FROM praxis.exploration_saved_direction WHERE learner_id=$1 AND direction_id=$2', [learnerId,directionId]);
  }

  async selectedActions(learnerId: string): Promise<string[]> {
    const [demo,rome] = await Promise.all([
      this.pool.query<{ action_id: string }>(
        'SELECT action_id FROM praxis.exploration_selected_action WHERE learner_id=$1 ORDER BY selected_at', [learnerId]),
      this.pool.query<{ action_id: string }>(
        'SELECT action_id FROM praxis.exploration_selected_rome_action WHERE learner_id=$1 ORDER BY selected_at', [learnerId]),
    ]);
    return [...demo.rows.map(row=>row.action_id),...rome.rows.map(row=>row.action_id)];
  }

  async selectAction(learnerId: string, directionId: string, action: DevelopmentAction): Promise<void> {
    if (/^rome:[A-Z][0-9]{4}$/.test(directionId)) {
      const client=await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO praxis.rome_development_action(action_id,code_rome,kind,title)
          VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[action.id,directionId.slice(5),action.kind,action.title]);
        await client.query(`INSERT INTO praxis.exploration_selected_rome_action(learner_id,code_rome,action_id)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[learnerId,directionId.slice(5),action.id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return;
    }
    await this.pool.query(`INSERT INTO praxis.exploration_selected_action(learner_id,direction_id,action_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [learnerId,directionId,action.id]);
  }

  async feedback(learnerId: string, directionId: string | null, useful: boolean, comment: string, reasonId: string | null = null): Promise<void> {
    if (directionId === null || /^rome:[A-Z][0-9]{4}$/.test(directionId)) {
      await this.pool.query(`INSERT INTO praxis.exploration_rome_feedback(learner_id,code_rome,useful,comment,reason_id)
        VALUES ($1,$2,$3,$4,$5)`,[learnerId,directionId?.slice(5) ?? null,useful,comment,reasonId]);
      return;
    }
    await this.pool.query(`INSERT INTO praxis.exploration_feedback(learner_id,direction_id,useful,comment,reason_id)
      VALUES ($1,$2,$3,$4,$5)`, [learnerId,directionId,useful,comment,reasonId]);
  }
}
