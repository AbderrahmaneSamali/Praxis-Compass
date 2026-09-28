import type { Pool } from 'pg';

export type LearnerChoice = Readonly<{ id: string; value: string; labelFr: string }>;
export type LearnerChoiceCatalog = Readonly<Record<string, readonly LearnerChoice[]>>;

export async function loadLearnerChoices(pool: Pool): Promise<LearnerChoiceCatalog> {
  const result = await pool.query<{group_id:string;id:string;value:string;labelFr:string}>(
    `SELECT group_id,id,code AS value,label_fr AS "labelFr" FROM praxis.learner_choice
     WHERE active ORDER BY group_id,display_order,id`);
  const catalog: Record<string,LearnerChoice[]> = {};
  for (const {group_id,...choice} of result.rows) (catalog[group_id] ??= []).push(choice);
  return catalog;
}
