/**
 * Resolves the context survey over a learner's answers.
 *
 * Everything here is a pure function of (facts, explicit answers), so a
 * session replays exactly from its stored rows and a changed early answer
 * re-shapes every later question: answers to questions that no longer apply
 * drop out of the result without being deleted, and inferences are recomputed
 * rather than stored.
 */

import {
  ISO_DATE,
  SURVEY_QUESTIONS,
  SURVEY_SECTIONS,
  effectiveDeadline,
  effectiveHours,
  formatDateFr,
  formatMonthFr,
  is,
  numberOf,
  valueOf,
  type AnswerValue,
  type DeclinableField,
  type FreeInput,
  type RecordedAnswer,
  type SurveyFacts,
  type SurveyOption,
  type SurveyQuestion,
  type SurveyState,
} from './survey-definition.js';

/** A hard stop; the learner can finish earlier at any time. */
export const SURVEY_MAX_QUESTIONS = 6;

const QUESTION_INDEX = new Map(
  SURVEY_QUESTIONS.map((question, index) => [question.id, index]),
);

export function surveyQuestion(id: string): SurveyQuestion | undefined {
  const index = QUESTION_INDEX.get(id);
  return index === undefined ? undefined : SURVEY_QUESTIONS[index];
}

export type ResolvedSurvey = Readonly<{
  state: SurveyState;
  /** Questions that currently apply, answered or not. */
  applicable: ReadonlySet<string>;
  /** Applicable, unanswered, and every question it depends on is settled. */
  askable: readonly SurveyQuestion[];
}>;

/**
 * One pass in dependency order. A question is settled once it has a value or
 * can no longer apply; it becomes askable only when everything it depends on
 * is settled, so dependent questions are asked only when their inputs are known.
 */
export function resolveSurvey(
  facts: SurveyFacts,
  explicit: ReadonlyMap<string, RecordedAnswer>,
): ResolvedSurvey {
  const answers = new Map<string, RecordedAnswer>();
  const applicable = new Set<string>();
  const settled = new Set<string>();
  const state: SurveyState = { facts, answers };

  for (const question of SURVEY_QUESTIONS) {
    const dependenciesSettled = question.dependsOn.every((id) =>
      settled.has(id),
    );
    if (!question.applies(state)) {
      if (dependenciesSettled) settled.add(question.id);
      continue;
    }
    applicable.add(question.id);
    const own = explicit.get(question.id);
    if (own) {
      answers.set(question.id, own);
      settled.add(question.id);
      continue;
    }
    const inferred = dependenciesSettled ? question.infer?.(state) : undefined;
    if (inferred !== undefined) {
      answers.set(question.id, {
        value: inferred,
        declined: false,
        source: 'inferred',
      });
      settled.add(question.id);
    }
  }

  const askable = SURVEY_QUESTIONS.filter(
    (question) =>
      applicable.has(question.id) &&
      !answers.has(question.id) &&
      question.dependsOn.every((id) => settled.has(id)),
  );
  return { state, applicable, askable };
}

/** Highest priority first; definition order breaks ties, so replays match. */
export function selectNextQuestion(
  resolved: ResolvedSurvey,
): SurveyQuestion | null {
  let best: SurveyQuestion | null = null;
  let bestPriority = -Infinity;
  for (const question of resolved.askable) {
    const priority = question.priority(resolved.state);
    if (priority > bestPriority) {
      best = question;
      bestPriority = priority;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Answers

export class SurveyAnswerError extends Error {}

export type RawAnswer = Readonly<{ value?: unknown; declined?: boolean }>;

function withinStep(value: number, min: number, step: number) {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

function normalizeFree(
  input: FreeInput,
  raw: unknown,
): AnswerValue | undefined {
  if (input.kind === 'number') {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim())
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(value)) return undefined;
    if (value < input.min || value > input.max) {
      throw new SurveyAnswerError(
        `Indiquez une valeur entre ${input.min} et ${input.max} ${input.unitFr}.`,
      );
    }
    if (!withinStep(value, 0, input.step)) {
      throw new SurveyAnswerError(`Utilisez un pas de ${input.step}.`);
    }
    return value;
  }
  if (typeof raw !== 'string') return undefined;
  if (input.kind === 'date') {
    const value = raw.trim();
    if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
      return undefined;
    if (value < input.min || value > input.max) {
      throw new SurveyAnswerError(
        `Choisissez une date entre le ${formatDateFr(input.min)} et le ${formatDateFr(input.max)}.`,
      );
    }
    return value;
  }
  const value = raw.trim();
  if (value.length < input.minLength || value.length > input.maxLength) {
    throw new SurveyAnswerError(
      `Votre réponse doit compter entre ${input.minLength} et ${input.maxLength} caractères.`,
    );
  }
  return value;
}

/** Validates a raw answer against the question as it reads in this state. */
export function normalizeAnswer(
  question: SurveyQuestion,
  state: SurveyState,
  raw: RawAnswer,
  source: 'learner' | 'prior_context' = 'learner',
): RecordedAnswer {
  if (raw.declined === true) {
    if (raw.value !== undefined && raw.value !== null) {
      throw new SurveyAnswerError(
        'Une réponse refusée ne porte pas de valeur.',
      );
    }
    return { value: null, declined: true, source };
  }
  const options = question.options(state);
  const allowed = new Set(options.map((option) => option.value));

  if (question.selection === 'multiple') {
    if (
      !Array.isArray(raw.value) ||
      raw.value.length === 0 ||
      !raw.value.every(
        (entry): entry is string =>
          typeof entry === 'string' && allowed.has(entry),
      )
    ) {
      throw new SurveyAnswerError('Choisissez au moins une option proposée.');
    }
    // Stored in option order so equal answers compare equal.
    const chosen = new Set(raw.value);
    return {
      value: options
        .map((option) => option.value)
        .filter((value) => chosen.has(value)),
      declined: false,
      source,
    };
  }

  if (question.id === 'hours_per_week' && typeof raw.value === 'number') raw = {...raw,value:String(raw.value)};
  const free = question.freeInput?.(state) ?? null;
  if (typeof raw.value === 'string' && allowed.has(raw.value)) {
    // A numeric preset is stored as the number it stands for.
    const value =
      question.id === 'hours_per_week' && /^\d+(\.\d+)?$/.test(raw.value)
        ? Number(raw.value)
        : raw.value;
    return { value, declined: false, source };
  }
  if (free) {
    const value = normalizeFree(free, raw.value);
    if (value !== undefined) return { value, declined: false, source };
  }
  throw new SurveyAnswerError('Cette réponse ne correspond pas à la question.');
}

// ---------------------------------------------------------------------------
// Presentation

export type AnswerTrigger = Readonly<{
  questionId: string;
  answerLabelFr: string;
  source: RecordedAnswer['source'];
}>;

export type QuestionView = Readonly<{
  id: string;
  section: string;
  sectionLabelFr: string;
  selection: 'single' | 'multiple';
  promptFr: string;
  helpFr: string | null;
  options: readonly SurveyOption[];
  freeInput: FreeInput | null;
  /** The earlier answers that made this question appear or shaped it. */
  triggeredBy: readonly AnswerTrigger[];
  current: RecordedAnswer | null;
}>;

export function answerLabel(
  question: SurveyQuestion,
  state: SurveyState,
  answer: RecordedAnswer,
): string {
  if (answer.declined) return 'Passé';
  const options = question.options(state);
  const label = (value: string) => {
    const option = options.find((candidate) => candidate.value === value);
    if (!option) return undefined;
    return option.detailFr
      ? `${option.labelFr} · ${option.detailFr}`
      : option.labelFr;
  };
  const value = answer.value;
  if (Array.isArray(value)) {
    return value
      .map(
        (entry) =>
          label(entry) ??
          entry,
      )
      .join(', ');
  }
  if (typeof value === 'number') {
    const byOption = label(String(value));
    if (byOption) return byOption;
    const free = question.freeInput?.(state);
    return free?.kind === 'number'
      ? `${value} ${free.unitFr}`.trim()
      : String(value);
  }
  if (typeof value === 'string') {
    const byOption = label(value);
    if (byOption) return byOption;
    if (ISO_DATE.test(value)) return formatMonthFr(value);
    return value.length > 90 ? `« ${value.slice(0, 87)}… »` : `« ${value} »`;
  }
  return '—';
}

export function presentQuestion(
  question: SurveyQuestion,
  resolved: ResolvedSurvey,
): QuestionView {
  const { state } = resolved;
  const triggeredBy = question.dependsOn.flatMap((id) => {
    const answer = state.answers.get(id);
    const source = surveyQuestion(id);
    if (!answer || answer.declined || !source) return [];
    return [
      {
        questionId: id,
        answerLabelFr: answerLabel(source, state, answer),
        source: answer.source,
      },
    ];
  });
  return {
    id: question.id,
    section: question.section,
    sectionLabelFr: SURVEY_SECTIONS[question.section],
    selection: question.selection,
    promptFr: question.prompt(state),
    helpFr: question.help?.(state) ?? null,
    options: question.options(state),
    freeInput: question.freeInput?.(state) ?? null,
    triggeredBy,
    current: state.answers.get(question.id) ?? null,
  };
}

export type SummaryItem = Readonly<{
  questionId: string;
  labelFr: string;
  answerLabelFr: string;
  source: RecordedAnswer['source'];
}>;

function formatHours(hours: number) {
  return `${String(hours).replace('.', ',')} h / semaine`;
}

/**
 * The context as it will be saved, one row per recap question.
 */
export function summarize(resolved: ResolvedSurvey): readonly SummaryItem[] {
  const { state } = resolved;
  return SURVEY_QUESTIONS.flatMap((question) => {
    const answer = state.answers.get(question.id);
    if (!answer || !question.recapFr) return [];
    let label = answerLabel(question, state, answer);
    if (!answer.declined) {
      if (question.id === 'hours_per_week') {
        const hours = effectiveHours(state);
        if (hours !== undefined) label = formatHours(hours);
      }
      if (question.id === 'deadline') {
        const deadline = effectiveDeadline(state);
        label = deadline ? formatMonthFr(deadline) : 'Pas d’échéance';
      }
    }
    return [
      {
        questionId: question.id,
        labelFr: question.recapFr,
        answerLabelFr: label,
        source: answer.source,
      },
    ];
  });
}

/**
 * Remaining questions that apply now. Later answers can add or remove some,
 * so the UI shows this as an estimate.
 */
export function estimatedRemaining(resolved: ResolvedSurvey): number {
  let remaining = 0;
  for (const id of resolved.applicable) {
    if (!resolved.state.answers.has(id)) remaining += 1;
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Seeding from the learner's previous snapshot

export type PriorContext = Readonly<{
  motivation: string | null;
  situation: string | null;
  hoursPerWeek: number | null;
  deadline: string | null;
}>;

/**
 * Candidate answers carried over from the previous snapshot. Only stated
 * values are carried: earlier snapshots recorded unasked fields as declined,
 * so a stored decline is not trusted as the learner's choice. Each candidate
 * is still validated against its question before it is recorded.
 */
export function priorContextSeeds(
  prior: PriorContext,
  facts: SurveyFacts,
): readonly Readonly<{ questionId: string; value: unknown }>[] {
  const seeds: { questionId: string; value: unknown }[] = [];
  const add = (questionId: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '')
      seeds.push({ questionId, value });
  };
  add('motivation', prior.motivation);
  add('situation', prior.situation);
  add('hours_per_week', prior.hoursPerWeek);
  if (prior.deadline && prior.deadline > facts.today)
    add('deadline', prior.deadline);
  return seeds;
}

/**
 * Previous-snapshot fields this survey does not ask. A completed survey writes
 * a whole new snapshot, so these are carried over rather than silently reset.
 */
export type CarriedContext = Readonly<{
  preferredSectorCode: string | null;
  educationStatus: string | null;
  highestEducationLevel: string | null;
  fieldOfStudy: string | null;
  currentProgram: string | null;
  graduationYear: number | null;
  languageFlexibility: string | null;
  formatFlexibility: string | null;
  budgetBand: 'range' | 'unknown' | null;
  budgetMinMad: number | null;
  budgetMaxMad: number | null;
  budgetFlexibility: string | null;
  languages: readonly string[] | null;
  onlineFormat: string | null;
}>;

export function carriedContextFields(prior: CarriedContext | null) {
  if (!prior) return {};
  const carried: Record<string, string | number | readonly string[]> = {};
  for (const [key, value] of Object.entries(prior)) {
    if (value !== null && value !== '') carried[key] = value;
  }
  return carried;
}

// ---------------------------------------------------------------------------
// Mapping to the learner-context snapshot

/** Career answers written to a learner-context snapshot. */
export type SurveyContextFields = {
  motivation?: string;
  situation?: string;
  deadline?: string;
  hoursPerWeek?: number;
  recentWorkExample?: string;
  declinedFields: DeclinableField[];
};

function text(state: SurveyState, id: string) {
  const value = valueOf(state, id);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Unanswered stays undefined. Only an explicit "skip" lands in
 * `declinedFields`, and a field is never both declined and filled.
 */
export function toContextFields(resolved: ResolvedSurvey): SurveyContextFields {
  const { state } = resolved;
  const fields: SurveyContextFields = { declinedFields: [] };

  fields.motivation = text(state, 'motivation');
  fields.situation = text(state, 'situation');

  const hours = effectiveHours(state);
  if (hours !== undefined) {
    fields.hoursPerWeek = hours;
  }
  const deadline = effectiveDeadline(state);
  if (deadline) fields.deadline = deadline;



  const declined = new Set<DeclinableField>();
  for (const question of SURVEY_QUESTIONS) {
    const answer = state.answers.get(question.id);
    if (answer?.declined && question.contextField) {
      declined.add(question.contextField);
    }
  }
  // A skipped follow-up must not hide a field the learner did answer.
  const answeredFields: Record<DeclinableField, boolean> = {
    motivation: fields.motivation !== undefined,
    situation: fields.situation !== undefined,
    deadline: fields.deadline !== undefined,
    time: fields.hoursPerWeek !== undefined,
  };
  fields.declinedFields = [...declined].filter(
    (field) => !answeredFields[field],
  );

  for (const key of Object.keys(fields) as (keyof SurveyContextFields)[]) {
    if (fields[key] === undefined) delete fields[key];
  }
  return fields;
}
