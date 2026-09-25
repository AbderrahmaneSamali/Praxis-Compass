/**
 * Validation for a learner_context snapshot written by the survey.
 *
 * Mirrors the rules of the main app's SaveLearnerContextDto and
 * NavigatorJourneyService.saveLearnerContext, so a snapshot written here is
 * one the main app would also accept. The database CHECK constraints remain
 * the last line of defence; this rejects bad input with a readable message
 * before a transaction starts.
 */

export const CONTEXT_MOTIVATIONS = [
  'career_change',
  'promotion',
  'employer_required',
  'job_seeking',
  'exploration',
] as const;
export const CONTEXT_SITUATIONS = [
  'employed',
  'seeking',
  'studying',
  'between_contracts',
] as const;
export const EDUCATION_STATUSES = [
  'currently_studying',
  'completed',
  'interrupted',
  'not_disclosed',
] as const;
export const EDUCATION_LEVELS = [
  'none',
  'secondary',
  'technical_vocational',
  'bac_plus_2',
  'licence',
  'master',
  'doctorate',
  'other',
] as const;
const FLEXIBILITY = ['mandatory', 'flexible'] as const;
const ONLINE_FORMATS = ['online_live', 'online_self_paced'] as const;
const INTENSITY = ['intensive', 'progressif'] as const;
const DECLINABLE = [
  'sector',
  'education',
  'motivation',
  'situation',
  'deadline',
  'budget',
  'time',
  'format',
  'location',
  'languages',
  'intensity',
] as const;

export type ContextInput = {
  goalKind?: 'role' | 'task';
  goalText?: string;
  recentWorkExample?: string;
  preferredSectorCode?: string;
  educationStatus?: string;
  highestEducationLevel?: string;
  fieldOfStudy?: string;
  currentProgram?: string;
  graduationYear?: number;
  motivation?: string;
  situation?: string;
  deadline?: string;
  budgetBand?: 'range' | 'unknown';
  budgetMinMad?: number;
  budgetMaxMad?: number;
  budgetFlexibility?: string;
  hoursPerWeek?: number;
  languages?: readonly string[];
  languageFlexibility?: string;
  onlineFormat?: string;
  formatFlexibility?: string;
  intensityPref?: string;
  declinedFields?: readonly string[];
};

export class ContextValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join(' '));
  }
}

function oneOf(
  problems: string[],
  field: string,
  value: string | undefined,
  allowed: readonly string[],
) {
  if (value !== undefined && !allowed.includes(value)) {
    problems.push(`${field} must be one of ${allowed.join(', ')}.`);
  }
}

function maxLength(
  problems: string[],
  field: string,
  value: string | undefined,
  max: number,
) {
  if (value !== undefined && value.length > max) {
    problems.push(`${field} must be at most ${max} characters.`);
  }
}

/** Returns the input unchanged, or throws listing every problem found. */
export function validateContextInput(input: ContextInput): ContextInput {
  const problems: string[] = [];
  oneOf(problems, 'goalKind', input.goalKind, ['role', 'task']);
  maxLength(problems, 'goalText', input.goalText, 1000);
  if (input.goalKind === 'task' && !input.goalText?.trim()) {
    problems.push('Describe the task you want to accomplish.');
  }
  maxLength(problems, 'recentWorkExample', input.recentWorkExample, 2000);
  if (
    input.preferredSectorCode !== undefined &&
    !/^[a-z][a-z0-9_]{1,49}$/.test(input.preferredSectorCode)
  ) {
    problems.push('preferredSectorCode is not a valid sector code.');
  }
  oneOf(problems, 'educationStatus', input.educationStatus, EDUCATION_STATUSES);
  oneOf(
    problems,
    'highestEducationLevel',
    input.highestEducationLevel,
    EDUCATION_LEVELS,
  );
  maxLength(problems, 'fieldOfStudy', input.fieldOfStudy, 160);
  maxLength(problems, 'currentProgram', input.currentProgram, 200);
  if (
    input.graduationYear !== undefined &&
    (!Number.isInteger(input.graduationYear) ||
      input.graduationYear < 1900 ||
      input.graduationYear > 2200)
  ) {
    problems.push('graduationYear must be a year between 1900 and 2200.');
  }
  oneOf(problems, 'motivation', input.motivation, CONTEXT_MOTIVATIONS);
  oneOf(problems, 'situation', input.situation, CONTEXT_SITUATIONS);
  if (
    input.deadline !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) ||
      Number.isNaN(Date.parse(`${input.deadline}T00:00:00Z`)))
  ) {
    problems.push('deadline must be an ISO date (YYYY-MM-DD).');
  }
  oneOf(problems, 'budgetBand', input.budgetBand, ['range', 'unknown']);
  for (const [field, value] of [
    ['budgetMinMad', input.budgetMinMad],
    ['budgetMaxMad', input.budgetMaxMad],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      problems.push(`${field} must be a non-negative number.`);
    }
  }
  if (
    input.budgetBand === 'range' &&
    (input.budgetMinMad === undefined || input.budgetMaxMad === undefined)
  ) {
    problems.push('Provide both budget boundaries or choose unknown.');
  }
  if (
    input.budgetMinMad !== undefined &&
    input.budgetMaxMad !== undefined &&
    input.budgetMinMad > input.budgetMaxMad
  ) {
    problems.push('The minimum budget cannot exceed the maximum budget.');
  }
  oneOf(problems, 'budgetFlexibility', input.budgetFlexibility, FLEXIBILITY);
  if (
    input.hoursPerWeek !== undefined &&
    (!Number.isFinite(input.hoursPerWeek) ||
      input.hoursPerWeek < 0.5 ||
      input.hoursPerWeek > 168)
  ) {
    problems.push('hoursPerWeek must be between 0.5 and 168.');
  }
  if (
    input.languages !== undefined &&
    !input.languages.every(
      (language) => typeof language === 'string' && language.length <= 20,
    )
  ) {
    problems.push('languages must be short language codes.');
  }
  oneOf(
    problems,
    'languageFlexibility',
    input.languageFlexibility,
    FLEXIBILITY,
  );
  oneOf(problems, 'onlineFormat', input.onlineFormat, ONLINE_FORMATS);
  oneOf(problems, 'formatFlexibility', input.formatFlexibility, FLEXIBILITY);
  oneOf(problems, 'intensityPref', input.intensityPref, INTENSITY);
  for (const field of input.declinedFields ?? []) {
    if (!(DECLINABLE as readonly string[]).includes(field)) {
      problems.push(`${field} is not a declinable field.`);
    }
  }
  if (problems.length > 0) throw new ContextValidationError(problems);
  return input;
}
