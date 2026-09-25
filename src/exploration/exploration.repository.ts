import type { Pool } from 'pg';
import type { RoleDirection, StartingProfile, DirectionKind, SourceReference } from './exploration.types.js';

type DirectionRow = { id: string; role_id: string; kind: DirectionKind; title_fr: string; description_fr: string;
  responsibilities_fr: string[]; interest_tags_fr: string[]; source_label: string; source_reference: string;
  review_status: SourceReference['reviewStatus']; skill_id: string | null; label: string | null;
  target_level: number | null; importance: number | null; source_version: string | null;
  esco_occupation_uri: string | null };

export class ExplorationRepository {
  constructor(private readonly pool: Pool) {}

  async profile(learnerId: string): Promise<StartingProfile> {
    const result = await this.pool.query<{ current_role_id: string | null; experience: string; interests: string;
      constraints_text: string; updated_at: Date }>(
      'SELECT current_role_id,experience,interests,constraints_text,updated_at FROM praxis.exploration_profile WHERE learner_id=$1', [learnerId]);
    const row = result.rows[0];
    return { learnerId, currentRoleId: row?.current_role_id ?? null, experience: row?.experience ?? '',
      interests: row?.interests ?? '', constraints: row?.constraints_text ?? '', updatedAt: row?.updated_at?.toISOString() ?? null };
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
    const result = await this.pool.query<{ direction_id: string }>(
      'SELECT direction_id FROM praxis.exploration_saved_direction WHERE learner_id=$1 ORDER BY saved_at', [learnerId]);
    return result.rows.map(row => row.direction_id);
  }

  async saveDirection(learnerId: string, directionId: string, saved: boolean): Promise<void> {
    if (saved) await this.pool.query(`INSERT INTO praxis.exploration_saved_direction(learner_id,direction_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING`, [learnerId,directionId]);
    else await this.pool.query('DELETE FROM praxis.exploration_saved_direction WHERE learner_id=$1 AND direction_id=$2', [learnerId,directionId]);
  }

  async selectedActions(learnerId: string): Promise<string[]> {
    const result = await this.pool.query<{ action_id: string }>(
      'SELECT action_id FROM praxis.exploration_selected_action WHERE learner_id=$1 ORDER BY selected_at', [learnerId]);
    return result.rows.map(row => row.action_id);
  }

  async selectAction(learnerId: string, directionId: string, actionId: string): Promise<void> {
    await this.pool.query(`INSERT INTO praxis.exploration_selected_action(learner_id,direction_id,action_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [learnerId,directionId,actionId]);
  }

  async feedback(learnerId: string, directionId: string | null, useful: boolean, comment: string): Promise<void> {
    await this.pool.query(`INSERT INTO praxis.exploration_feedback(learner_id,direction_id,useful,comment)
      VALUES ($1,$2,$3,$4)`, [learnerId,directionId,useful,comment]);
  }
}
