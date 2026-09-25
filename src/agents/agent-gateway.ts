import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ALGORITHM_VERSIONS } from '../kernel/algorithm-versions.js';
import { compareDirections } from '../exploration/exploration.service.js';
import type { CareerPossibility, SourceReference } from '../exploration/exploration.types.js';

type Snapshot = Readonly<{
  possibilities: readonly CareerPossibility[];
  coverageNote: string;
  careerContext?: { motivation: string | null; situation: string | null;
    hoursPerWeek: number | null; deadline: string | null } | null;
}>;
type ToolName = 'get_candidate_directions' | 'get_requirement_states' |
  'get_reviewed_sources' | 'get_career_context';
type ToolTrace = { name: ToolName; outcome: 'succeeded' | 'failed'; elapsedMs: number };

export class AgentGatewayInputError extends Error {}

/** Fixed, read-only tool chain. The caller supplies the authenticated learner ID, never the request body. */
export class StandaloneAgentGateway {
  constructor(private readonly pool: Pool) {}

  async compare(learnerId: string, ids: unknown, getSnapshot: () => Promise<Snapshot>) {
    const requestId = randomUUID();
    const inputsHash = createHash('sha256').update(JSON.stringify({learnerId, ids})).digest('hex');
    const trace: ToolTrace[] = [];
    const started = Date.now();
    const tool = async <T>(name: ToolName, run: () => Promise<T> | T): Promise<T> => {
      if (trace.length >= 4 || Date.now() - started > 10000) throw new Error('Agent gateway limit exceeded');
      const began = Date.now();
      try {
        const value = await run();
        trace.push({name, outcome: 'succeeded', elapsedMs: Date.now() - began});
        return value;
      } catch (error) {
        trace.push({name, outcome: 'failed', elapsedMs: Date.now() - began});
        throw error;
      }
    };
    let outcome: 'succeeded' | 'rejected' | 'failed' = 'failed';
    try {
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > 3 ||
        ids.some(id => typeof id !== 'string' || id.length > 160) || new Set(ids).size !== ids.length) {
        throw new AgentGatewayInputError('Choisissez deux ou trois directions distinctes.');
      }
      const snapshot = await tool('get_candidate_directions', getSnapshot);
      let chosen: CareerPossibility[];
      try { chosen = compareDirections(snapshot.possibilities, ids); }
      catch { throw new AgentGatewayInputError('Direction indisponible pour ce profil.'); }
      const requirements = await tool('get_requirement_states', () => chosen.map(direction => {
        const count = (state: string) => direction.requirements.filter(item => item.state === state).length;
        return {directionId: direction.id, counts: {
          supported: count('supported'), developmentNeeded: count('development_needed'),
          unknown: count('unknown'), conflicting: count('conflicting')},
          toClarify: direction.requirements.filter(item => item.state === 'unknown' || item.state === 'conflicting')
            .slice(0, 5).map(item => ({requirementId: item.romeOgr ?? item.skillId, label: item.label,
              state: item.state, sourceReference: item.source.reference})),
          toDevelop: direction.requirements.filter(item => item.state === 'development_needed')
            .slice(0, 5).map(item => ({requirementId: item.romeOgr ?? item.skillId, label: item.label,
              sourceReference: item.source.reference})),
        };
      }));
      const sources = await tool('get_reviewed_sources', () => chosen.map(direction => ({
        directionId: direction.id,
        sources: direction.sources.filter((source: SourceReference) =>
          source.reviewStatus === 'official_source' || source.reviewStatus === 'reviewed')
          .slice(0, 3).map(source => ({label: source.label, reference: source.reference,
            reviewStatus: source.reviewStatus})),
      })));
      const context = await tool('get_career_context', () => snapshot.careerContext ? {
        motivation: snapshot.careerContext.motivation,
        situation: snapshot.careerContext.situation,
        hoursPerWeek: snapshot.careerContext.hoursPerWeek,
        deadline: snapshot.careerContext.deadline,
      } : null);
      if (Date.now() - started > 10000) throw new Error('Agent gateway limit exceeded');
      outcome = 'succeeded';
      return {requestId, policyVersion: ALGORITHM_VERSIONS.agentGateway,
        directions: chosen.map((direction, index) => ({
          id: direction.id, title: direction.title, romeCode: direction.romeCode ?? null,
          reasons: (direction.reasons ?? []).slice(0, 3),
          requirements: requirements[index], sources: sources[index].sources,
          sourceCoverage: sources[index].sources.length ? 'reviewed_or_official' : 'unreviewed',
        })), context, coverageNote: snapshot.coverageNote,
        note: 'Comparaison structurée des données disponibles. Les confirmations personnelles ne prouvent pas la maîtrise.'};
    } catch (error) {
      outcome = error instanceof AgentGatewayInputError ? 'rejected' : 'failed';
      throw error;
    } finally {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO praxis.agent_gateway_request
          (id,learner_id,operation,policy_version,inputs_hash,outcome,tool_count)
          VALUES ($1,$2,'compare_directions',$3,$4,$5,$6)`,
          [requestId, learnerId, ALGORITHM_VERSIONS.agentGateway, inputsHash, outcome, trace.length]);
        for (let i = 0; i < trace.length; i++) {
          const entry = trace[i]!;
          await client.query(`INSERT INTO praxis.agent_gateway_tool_call
            (request_id,learner_id,sequence,tool_name,outcome,elapsed_ms)
            VALUES ($1,$2,$3,$4,$5,$6)`,
            [requestId, learnerId, i + 1, entry.name, entry.outcome, entry.elapsedMs]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
  }
}
