import type { Pool, PoolClient } from 'pg';

import { ALGORITHM_VERSIONS } from '../kernel/algorithm-versions.js';
import { hashComputationInputs } from '../kernel/computation-provenance.js';
import { validateContextInput, type ContextInput } from './context-validation.js';
import type {
  AnswerValue,
  RecordedAnswer,
  SurveyFacts,
} from './survey-definition.js';
import {
  SURVEY_MAX_QUESTIONS,
  SurveyAnswerError,
  carriedContextFields,
  estimatedRemaining,
  normalizeAnswer,
  presentQuestion,
  priorContextSeeds,
  resolveSurvey,
  selectNextQuestion,
  summarize,
  surveyQuestion,
  toContextFields,
  type AnswerTrigger,
  type CarriedContext,
  type PriorContext,
  type QuestionView,
  type SummaryItem,
} from './survey-engine.js';

/** The session does not exist, or belongs to another learner. */
export class SurveyNotFoundError extends Error {}

/** The request does not fit the session's current state. */
export class SurveyStateError extends Error {}

export type ContextSurveyState = Readonly<{
  sessionId: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  surveyVersion: string;
  progress: Readonly<{ answered: number; remaining: number }>;
  question: QuestionView | null;
  summary: readonly SummaryItem[];
  canUndo: boolean;
  resultingContextId: string | null;
}>;

type SessionRecord = Readonly<{
  id: string;
  learnerId: string;
  surveyVersion: string;
  roleLabel: string | null;
  goalKind: 'role' | 'task';
  goalText: string | null;
  surveyDate: string;
  status: ContextSurveyState['status'];
  resultingContextId: string | null;
}>;

type AnswerRecord = Readonly<{
  questionId: string;
  value: AnswerValue | null;
  declined: boolean;
  source: 'learner' | 'prior_context';
}>;

type NewAnswer = AnswerRecord &
  Readonly<{ promptFr: string; triggeredBy: readonly AnswerTrigger[] }>;

type ContextRow = Readonly<{
  id: string;
  context_version: string;
  motivation: string | null;
  situation: string | null;
  hours_per_week: string | null;
  deadline: string | null;
  budget_band: 'range' | 'unknown' | null;
  budget_min_mad: string | null;
  budget_max_mad: string | null;
  budget_flexibility: string | null;
  languages: string[] | null;
  online_format: string | null;
  format_pref: string[] | null;
  location_city: string | null;
  remote_only: boolean | null;
  intensity_pref: string | null;
  declined_fields: string[];
  preferred_sector_code: string | null;
  education_status: string | null;
  highest_education_level: string | null;
  field_of_study: string | null;
  current_program: string | null;
  graduation_year: number | null;
  language_flexibility: string | null;
  format_flexibility: string | null;
}>;

const INSERT_ANSWER = `
  INSERT INTO praxis.context_survey_answer
    (session_id, survey_version, question_id, sequence, value, declined,
     source, prompt_fr, triggered_by)
  SELECT $1, $2, $3,
         coalesce((SELECT max(sequence) + 1 FROM praxis.context_survey_answer
                   WHERE session_id = $1), 0),
         $4::jsonb, $5, $6, $7, $8::jsonb`;

function answerParameters(
  sessionId: string,
  surveyVersion: string,
  answer: NewAnswer,
) {
  return [
    sessionId,
    surveyVersion,
    answer.questionId,
    answer.value === null ? null : JSON.stringify(answer.value),
    answer.declined,
    answer.source,
    answer.promptFr,
    JSON.stringify(answer.triggeredBy),
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNumber(value: string | null) {
  return value === null ? null : Number(value);
}

function factsOf(session: SessionRecord): SurveyFacts {
  return {
    today: session.surveyDate,
    roleLabel: session.roleLabel,
    goalKind: session.goalKind,
    goalText: session.goalText,
  };
}

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The branching context survey over PostgreSQL. The caller authenticates the
 * learner; every method checks that the session belongs to that learner.
 * Question selection and wording are the pure rules in survey-engine.ts.
 */
export class StandaloneContextSurvey {
  constructor(private readonly pool: Pool) {}

  /**
   * Starts a survey. Values the learner stated in their current snapshot are
   * carried in as revisable answers, so they are not asked again.
   */
  async start(
    input: Readonly<{
      learnerId: string;
      roleId?: string;
      romeCode?: string;
      goalKind?: 'role' | 'task';
      goalText?: string;
    }>,
  ): Promise<ContextSurveyState> {
    const learner = UUID.test(input.learnerId)
      ? await this.pool.query('SELECT 1 FROM praxis.learner WHERE id = $1', [input.learnerId])
      : null;
    if (!learner?.rowCount) throw new SurveyNotFoundError('Unknown learner');
    const goalKind = input.goalKind ?? 'role';
    const goalText = input.goalText?.trim() || null;
    if (goalKind === 'task' && !goalText) {
      throw new SurveyStateError('Describe the task you want to accomplish');
    }
    const roleId = input.roleId ?? null;
    const romeCode = input.romeCode ?? null;
    if (roleId && romeCode) throw new SurveyStateError('Choose one occupation source');
    let roleLabel: string | null = null;
    if (roleId) {
      const role = await this.pool.query<{ label_fr: string }>(
        'SELECT label_fr FROM praxis.occupation WHERE id = $1',
        [roleId],
      );
      roleLabel = role.rows[0]?.label_fr ?? null;
      if (!roleLabel) throw new SurveyStateError('Unknown target occupation');
    }
    if (romeCode) {
      const role = await this.pool.query<{ preferred_label: string }>(
        `SELECT v.preferred_label FROM praxis.rome_occupation_versions v
         JOIN praxis.source_releases r ON r.id=v.release_id AND r.source='rome' AND r.is_active
         WHERE v.code_rome=$1`,[romeCode]);
      roleLabel=role.rows[0]?.preferred_label ?? null;
      if (!roleLabel) throw new SurveyStateError('Unknown ROME occupation');
    }

    const prior = await this.currentContext(input.learnerId);
    const surveyDate = new Date().toISOString().slice(0, 10);
    const facts: SurveyFacts = { today: surveyDate, roleLabel, goalKind, goalText };

    const explicit = new Map<string, RecordedAnswer>();
    const seeds: NewAnswer[] = [];
    const priorContext: PriorContext | null = prior?.context_version === ALGORITHM_VERSIONS.learnerContextSurvey ? {
      motivation: prior.motivation,
      situation: prior.situation,
      hoursPerWeek: toNumber(prior.hours_per_week),
      deadline: prior.deadline,
    } : null;
    for (const seed of priorContext ? priorContextSeeds(priorContext, facts) : []) {
      const question = surveyQuestion(seed.questionId);
      if (!question) continue;
      const { state } = resolveSurvey(facts, explicit);
      try {
        const answer = normalizeAnswer(question, state, { value: seed.value }, 'prior_context');
        explicit.set(question.id, answer);
        seeds.push({
          questionId: question.id,
          value: answer.value,
          declined: false,
          source: 'prior_context',
          promptFr: question.prompt(state),
          triggeredBy: [],
        });
      } catch (error) {
        // A stale value that no longer fits its question is simply asked again.
        if (!(error instanceof SurveyAnswerError)) throw error;
      }
    }

    const surveyVersion = ALGORITHM_VERSIONS.learnerContextSurvey;
    const priorContextId = prior?.id ?? null;
    const sessionId = await inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.learnerId]);
      await client.query(
        `UPDATE praxis.context_survey_session SET status = 'abandoned'
         WHERE learner_id = $1 AND status = 'in_progress'`,
        [input.learnerId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO praxis.context_survey_session
           (learner_id, survey_version, algorithm_version, inputs_hash, role_id,
            rome_code, role_label, goal_kind, goal_text, survey_date, prior_context_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          input.learnerId,
          surveyVersion,
          surveyVersion,
          hashComputationInputs({
            algorithmVersion: surveyVersion,
            roleId,
            romeCode,
            roleLabel,
            goalKind,
            goalText,
            surveyDate,
            priorContextId,
            seeds: seeds.map((seed) => [seed.questionId, seed.value]),
          }),
          roleId,
          romeCode,
          roleLabel,
          goalKind,
          goalText,
          surveyDate,
          priorContextId,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Survey session insert returned no row');
      for (const seed of seeds) {
        await client.query(INSERT_ANSWER, answerParameters(id, surveyVersion, seed));
      }
      return id;
    });
    return this.present(sessionId);
  }

  async latest(learnerId: string): Promise<ContextSurveyState | null> {
    const result=await this.pool.query<{id:string}>(
      `SELECT id FROM praxis.context_survey_session
       WHERE learner_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1`,[learnerId]);
    return result.rows[0] ? this.present(result.rows[0].id) : null;
  }

  async view(learnerId: string, sessionId: string): Promise<ContextSurveyState> {
    await this.ownedSession(learnerId, sessionId);
    return this.present(sessionId);
  }

  /** One question as it reads now, so the learner can revise an earlier answer. */
  async question(
    learnerId: string,
    sessionId: string,
    questionId: string,
  ): Promise<QuestionView> {
    const session = await this.ownedSession(learnerId, sessionId);
    const question = surveyQuestion(questionId);
    const resolved = resolveSurvey(factsOf(session), await this.explicitAnswers(sessionId));
    if (!question || !resolved.applicable.has(questionId)) {
      throw new SurveyStateError('This question does not apply');
    }
    return presentQuestion(question, resolved);
  }

  async answer(
    learnerId: string,
    sessionId: string,
    input: Readonly<{ questionId: string; value?: unknown; declined?: boolean }>,
  ): Promise<ContextSurveyState> {
    const session = await this.openSession(learnerId, sessionId);
    const question = surveyQuestion(input.questionId);
    if (!question) throw new SurveyStateError('Unknown survey question');
    const resolved = resolveSurvey(factsOf(session), await this.explicitAnswers(sessionId));
    const alreadyAnswered = resolved.state.answers.has(question.id);
    // Revising an answered or inferred question is always allowed; a new one
    // must be ready, so nothing is answered before what it depends on.
    if (
      !resolved.applicable.has(question.id) ||
      (!alreadyAnswered && !resolved.askable.some((candidate) => candidate.id === question.id))
    ) {
      throw new SurveyStateError('This question does not apply yet');
    }
    const answer = normalizeAnswer(question, resolved.state, {
      value: input.value,
      declined: input.declined,
    });
    const shown = presentQuestion(question, resolved);
    await this.pool.query(
      INSERT_ANSWER,
      answerParameters(sessionId, session.surveyVersion, {
        questionId: question.id,
        value: answer.value,
        declined: answer.declined,
        source: 'learner',
        promptFr: shown.promptFr,
        triggeredBy: shown.triggeredBy,
      }),
    );
    return this.present(sessionId);
  }

  /** Undoes the latest learner answer; carried-over answers stay. */
  async back(learnerId: string, sessionId: string): Promise<ContextSurveyState> {
    await this.openSession(learnerId, sessionId);
    const undone = await this.pool.query(
      `UPDATE praxis.context_survey_answer SET undone_at = now()
       WHERE id = (
         SELECT id FROM praxis.context_survey_answer
         WHERE session_id = $1 AND source = 'learner' AND undone_at IS NULL
         ORDER BY sequence DESC LIMIT 1
       )`,
      [sessionId],
    );
    if (!undone.rowCount) throw new SurveyStateError('There is nothing to undo');
    return this.present(sessionId);
  }

  /**
   * Writes the learner_context snapshot, supersedes the previous one and
   * closes the session in one transaction. Unanswered questions stay
   * unknown; only an explicit skip is recorded as declined. Fields the survey
   * does not ask are carried over from the current snapshot.
   */
  async complete(
    learnerId: string,
    sessionId: string,
    input: Readonly<{ preferredSectorCode?: string }> = {},
  ): Promise<ContextSurveyState & Readonly<{ contextId: string }>> {
    const session = await this.openSession(learnerId, sessionId);
    const resolved = resolveSurvey(factsOf(session), await this.explicitAnswers(sessionId));
    const current = await this.currentContext(learnerId);
    const carried: CarriedContext | null = current && {
      preferredSectorCode: current.preferred_sector_code,
      educationStatus: current.education_status,
      highestEducationLevel: current.highest_education_level,
      fieldOfStudy: current.field_of_study,
      currentProgram: current.current_program,
      graduationYear: current.graduation_year,
      languageFlexibility: current.language_flexibility,
      formatFlexibility: current.format_flexibility,
      budgetBand: current.budget_band,
      budgetMinMad: toNumber(current.budget_min_mad),
      budgetMaxMad: toNumber(current.budget_max_mad),
      budgetFlexibility: current.budget_flexibility,
      languages: current.languages,
      onlineFormat: current.online_format,
    };
    const surveyFields = toContextFields(resolved);
    const retainedDeclines = current?.declined_fields.filter(field =>
      !['motivation','situation','deadline','time'].includes(field)) ?? [];
    const context = validateContextInput({
      ...(carriedContextFields(carried) as ContextInput),
      ...surveyFields,
      declinedFields: [...new Set([...retainedDeclines,...surveyFields.declinedFields])],
      goalKind: session.goalKind,
      goalText: session.goalText ?? undefined,
      ...(input.preferredSectorCode ? { preferredSectorCode: input.preferredSectorCode } : {}),
    });
    if (input.preferredSectorCode && context.preferredSectorCode) {
      const sector = await this.pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM praxis.praxis_sectors AS sector
           JOIN praxis.occupation_sector_mapping AS mapping
             ON mapping.sector_id = sector.id
            AND mapping.taxonomy_version_id = sector.taxonomy_version_id
           WHERE sector.code = $1 AND sector.active
             AND mapping.valid_to IS NULL
             AND mapping.validation_status <> 'rejected'
         ) AS exists`,
        [context.preferredSectorCode],
      );
      if (!sector.rows[0]?.exists) {
        throw new SurveyStateError('Choose an available PRAXIS sector');
      }
    }

    const contextId = await inTransaction(this.pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO praxis.learner_context
          (learner_id, context_version, preferred_sector_code, education_status,
           highest_education_level, field_of_study, current_program, graduation_year,
           motivation, situation, deadline, budget_band, budget_min_mad, budget_max_mad,
           hours_per_week, format_pref, location_city, remote_only, languages,
           intensity_pref, declined_fields, goal_kind, goal_text, recent_work_example,
           budget_flexibility, language_flexibility, format_flexibility, online_format)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24,
                 $25, $26, $27, $28)
         RETURNING id`,
        [
          learnerId,
          ALGORITHM_VERSIONS.learnerContextSurvey,
          context.preferredSectorCode ?? null,
          context.educationStatus ?? null,
          context.highestEducationLevel ?? null,
          context.fieldOfStudy?.trim() || null,
          context.currentProgram?.trim() || null,
          context.graduationYear ?? null,
          context.motivation ?? null,
          context.situation ?? null,
          context.deadline ?? null,
          context.budgetBand ?? null,
          context.budgetMinMad ?? null,
          context.budgetMaxMad ?? null,
          context.hoursPerWeek ?? null,
          current?.format_pref ?? null,
          current?.location_city ?? null,
          current?.remote_only ?? null,
          context.languages ?? null,
          current?.intensity_pref ?? null,
          context.declinedFields ?? [],
          context.goalKind ?? 'role',
          context.goalText?.trim() || null,
          context.recentWorkExample?.trim() || null,
          context.budgetFlexibility ?? 'mandatory',
          context.languageFlexibility ?? 'mandatory',
          context.formatFlexibility ?? 'flexible',
          context.onlineFormat ?? null,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Learner context insert returned no row');
      await client.query(
        `UPDATE praxis.learner_context SET superseded_by = $1
         WHERE learner_id = $2 AND superseded_by IS NULL AND id <> $1`,
        [id, learnerId],
      );
      const closed = await client.query(
        `UPDATE praxis.context_survey_session
         SET status = 'completed', resulting_context_id = $2, completed_at = now()
         WHERE id = $1 AND status = 'in_progress'`,
        [sessionId, id],
      );
      // A concurrent completion must not leave two snapshots behind.
      if (!closed.rowCount) throw new SurveyStateError('This survey is already closed');
      return id;
    });
    return { ...(await this.present(sessionId)), contextId };
  }

  private async currentContext(learnerId: string): Promise<ContextRow | null> {
    const result = await this.pool.query<ContextRow>(
      `SELECT id, context_version, motivation, situation, hours_per_week::text, deadline::text,
              budget_band, budget_min_mad::text, budget_max_mad::text,
              budget_flexibility, languages, online_format, format_pref,
              location_city, remote_only, intensity_pref, declined_fields,
              preferred_sector_code, education_status,
              highest_education_level, field_of_study, current_program,
              graduation_year, language_flexibility, format_flexibility
       FROM praxis.learner_context
       WHERE learner_id = $1 AND superseded_by IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [learnerId],
    );
    return result.rows[0] ?? null;
  }

  private async loadSession(sessionId: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<{
      id: string;
      learner_id: string;
      survey_version: string;
      role_label: string | null;
      goal_kind: 'role' | 'task';
      goal_text: string | null;
      survey_date: string;
      status: SessionRecord['status'];
      resulting_context_id: string | null;
    }>(
      `SELECT session.id, session.learner_id, session.survey_version,
              session.role_label, session.goal_kind,
              session.goal_text, session.survey_date::text AS survey_date,
              session.status, session.resulting_context_id
       FROM praxis.context_survey_session AS session
       WHERE session.id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      learnerId: row.learner_id,
      surveyVersion: row.survey_version,
      roleLabel: row.role_label,
      goalKind: row.goal_kind,
      goalText: row.goal_text,
      surveyDate: row.survey_date,
      status: row.status,
      resultingContextId: row.resulting_context_id,
    };
  }

  private async loadAnswers(sessionId: string): Promise<readonly AnswerRecord[]> {
    const result = await this.pool.query<{
      question_id: string;
      value: AnswerValue | null;
      declined: boolean;
      source: AnswerRecord['source'];
    }>(
      `SELECT question_id, value, declined, source
       FROM praxis.context_survey_answer
       WHERE session_id = $1 AND undone_at IS NULL
       ORDER BY sequence`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      questionId: row.question_id,
      value: row.value,
      declined: row.declined,
      source: row.source,
    }));
  }

  private async explicitAnswers(sessionId: string) {
    const explicit = new Map<string, RecordedAnswer>();
    // Rows arrive in answer order, so a revision replaces the earlier value.
    for (const row of await this.loadAnswers(sessionId)) {
      explicit.set(row.questionId, {
        value: row.value,
        declined: row.declined,
        source: row.source,
      });
    }
    return explicit;
  }

  private async present(sessionId: string): Promise<ContextSurveyState> {
    const session = await this.loadSession(sessionId);
    if (!session) throw new SurveyNotFoundError('Unknown survey session');
    const answers = await this.loadAnswers(sessionId);
    const learnerAnswers = new Set(
      answers.filter((row) => row.source === 'learner').map((row) => row.questionId),
    ).size;
    const resolved = resolveSurvey(factsOf(session), await this.explicitAnswers(sessionId));
    const next =
      session.status === 'in_progress' && learnerAnswers < SURVEY_MAX_QUESTIONS
        ? selectNextQuestion(resolved)
        : null;
    return {
      sessionId,
      status: session.status,
      surveyVersion: session.surveyVersion,
      progress: {
        answered: resolved.state.answers.size,
        remaining: next ? Math.max(1, estimatedRemaining(resolved)) : 0,
      },
      question: next ? presentQuestion(next, resolved) : null,
      summary: summarize(resolved),
      canUndo: answers.some((row) => row.source === 'learner'),
      resultingContextId: session.resultingContextId,
    };
  }

  private async ownedSession(learnerId: string, sessionId: string) {
    const session = UUID.test(sessionId) ? await this.loadSession(sessionId) : null;
    // The same error for "missing" and "someone else's", so ids leak nothing.
    if (!session || session.learnerId !== learnerId) {
      throw new SurveyNotFoundError('Unknown survey session');
    }
    return session;
  }

  private async openSession(learnerId: string, sessionId: string) {
    const session = await this.ownedSession(learnerId, sessionId);
    if (session.status !== 'in_progress') {
      throw new SurveyStateError('This survey is already closed');
    }
    return session;
  }
}
