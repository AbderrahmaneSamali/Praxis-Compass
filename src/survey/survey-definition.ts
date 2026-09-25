/**
 * The branching context survey.
 *
 * Short by design: every question must inform the next career exploration step or which
 * question comes next, and most are answered with one tap. Each question
 * declares which earlier answers it depends on, when it applies, and how its
 * wording and options change with those answers. The engine resolves
 * applicability, inference and priority over the learner's current answers,
 * so two learners who answered differently walk different paths.
 *
 * Questions are listed in dependency order. A question may only read answers
 * to questions listed before it; `context-survey.unit.mjs` asserts this, and
 * the engine relies on it to resolve the whole graph in one pass. `dependsOn`
 * is the subset it must wait for before it can be asked.
 *
 * Question ids are mirrored in `praxis.context_survey_question` by migration
 * 062, so every stored answer references a registered question. Adding,
 * removing or re-meaning a question needs a new survey version and a migration
 * that registers it.
 */

export type AnswerValue = string | number | readonly string[];

/**
 * `prior_context` answers come from the learner's own previous snapshot;
 * `inferred` answers are derived here and never persisted as learner answers.
 */
export type AnswerSource = 'learner' | 'prior_context' | 'inferred';

export type RecordedAnswer = Readonly<{
  value: AnswerValue | null;
  declined: boolean;
  source: AnswerSource;
}>;

export type SurveyFacts = Readonly<{
  /** The date the survey reasons with, fixed at session start so replays match. */
  today: string;
  roleLabel: string | null;
  goalKind: 'role' | 'task';
  goalText: string | null;
}>;

export type SurveyState = Readonly<{
  facts: SurveyFacts;
  answers: ReadonlyMap<string, RecordedAnswer>;
}>;

export const SURVEY_SECTIONS = Object.freeze({
  project: 'Votre projet',
  time: 'Votre temps',
  practice: 'Votre pratique',
});

export type SurveySection = keyof typeof SURVEY_SECTIONS;

/** The `learner_context.declined_fields` vocabulary used by this survey. */
export type DeclinableField =
  | 'motivation'
  | 'situation'
  | 'deadline'
  | 'time';

/** `detailFr` is a short second line, such as the date behind "in 3 months". */
export type SurveyOption = Readonly<{
  value: string;
  labelFr: string;
  detailFr?: string;
}>;

export type FreeInput =
  | Readonly<{
      kind: 'number';
      min: number;
      max: number;
      step: number;
      unitFr: string;
      labelFr: string;
    }>
  | Readonly<{ kind: 'date'; min: string; max: string; labelFr: string }>
  | Readonly<{
      kind: 'text';
      minLength: number;
      maxLength: number;
      labelFr: string;
      placeholderFr?: string;
    }>;

export type SurveyQuestion = Readonly<{
  id: string;
  section: SurveySection;
  selection: 'single' | 'multiple';
  dependsOn: readonly string[];
  applies: (state: SurveyState) => boolean;
  priority: (state: SurveyState) => number;
  prompt: (state: SurveyState) => string;
  help?: (state: SurveyState) => string | null;
  options: (state: SurveyState) => readonly SurveyOption[];
  freeInput?: (state: SurveyState) => FreeInput | null;
  /** A value that follows from earlier answers, so the question is not asked. */
  infer?: (state: SurveyState) => AnswerValue | undefined;
  contextField: DeclinableField | null;
  /**
   * Short label in the end-of-survey recap. Follow-ups without one are folded
   * into the row of the question they refine.
   */
  recapFr?: string;
}>;

// ---------------------------------------------------------------------------
// Reading answers

export function valueOf(state: SurveyState, id: string) {
  const answer = state.answers.get(id);
  return answer && !answer.declined ? (answer.value ?? undefined) : undefined;
}

export function is(state: SurveyState, id: string, ...values: string[]) {
  const value = valueOf(state, id);
  return typeof value === 'string' && values.includes(value);
}

export function numberOf(state: SurveyState, id: string) {
  const value = valueOf(state, id);
  return typeof value === 'number' ? value : undefined;
}

export function isoDateOf(state: SurveyState, id: string) {
  const value = valueOf(state, id);
  return typeof value === 'string' && ISO_DATE.test(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Dates, in UTC so the server's timezone never changes an answer

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatDateFr(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

const MONTHS_FR = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

/** "déc. 2026": enough precision for a training deadline. */
export function formatMonthFr(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTHS_FR[Number(month) - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Derived survey values

function goalPhrase(facts: SurveyFacts): string {
  if (facts.goalKind === 'task' && facts.goalText) return facts.goalText;
  return facts.roleLabel ?? 'votre objectif';
}

export function effectiveHours(state: SurveyState) {
  return numberOf(state, 'hours_per_week');
}

export function effectiveDeadline(state: SurveyState) {
  return isoDateOf(state, 'deadline');
}

const UNKNOWN_OPTION: SurveyOption = {
  value: 'unknown',
  labelFr: 'Je ne sais pas encore',
};

function isTimeConstrained(state: SurveyState) {
  return is(state, 'situation', 'employed', 'studying');
}

// ---------------------------------------------------------------------------
// The questions, in dependency order

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = Object.freeze([
  {
    id: 'motivation',
    recapFr: 'Raison',
    section: 'project',
    selection: 'single',
    dependsOn: [],
    applies: () => true,
    priority: () => 100,
    prompt: () => 'Pourquoi maintenant ?',
    help: (state) => `Objectif : ${goalPhrase(state.facts)}`,
    options: () => [
      { value: 'career_change', labelFr: 'Changer de métier' },
      { value: 'promotion', labelFr: 'Évoluer dans mon poste' },
      { value: 'employer_required', labelFr: 'Mon employeur me le demande' },
      { value: 'job_seeking', labelFr: 'Trouver un emploi' },
      { value: 'exploration', labelFr: 'Explorer, sans urgence' },
    ],
    contextField: 'motivation',
  },
  {
    id: 'situation',
    recapFr: 'Situation',
    section: 'project',
    selection: 'single',
    dependsOn: ['motivation'],
    applies: () => true,
    priority: () => 95,
    prompt: () => 'Votre situation actuelle ?',
    options: () => [
      { value: 'employed', labelFr: 'En poste' },
      { value: 'seeking', labelFr: 'En recherche d’emploi' },
      { value: 'studying', labelFr: 'En études' },
      { value: 'between_contracts', labelFr: 'Entre deux missions' },
    ],
    // Evolving in, or being sent by, a current job means being employed.
    infer: (state) =>
      is(state, 'motivation', 'promotion', 'employer_required')
        ? 'employed'
        : undefined,
    contextField: 'situation',
  },
  {
    id: 'hours_per_week',
    recapFr: 'Temps',
    section: 'time',
    selection: 'single',
    dependsOn: ['situation'],
    applies: () => true,
    priority: () => 80,
    prompt: () => 'Combien de temps pour explorer, chaque semaine ?',
    help: () => 'Temps que vous pourriez consacrer à votre exploration professionnelle.',
    options: (state) => [
      ...(isTimeConstrained(state) ? [1, 2, 4, 6] : [2, 4, 8, 12]).map(
        (hours) => ({ value: String(hours), labelFr: `${hours} h` }),
      ),
      UNKNOWN_OPTION,
    ],
    freeInput: () => ({
      kind: 'number',
      min: 0.5,
      max: 40,
      step: 0.5,
      unitFr: 'h / semaine',
      labelFr: 'Autre',
    }),
    contextField: 'time',
  },
  {
    id: 'deadline',
    recapFr: 'Échéance',
    section: 'time',
    selection: 'single',
    dependsOn: ['motivation', 'situation'],
    applies: () => true,
    // A date someone else set is asked before anything else about time.
    priority: (state) =>
      is(state, 'motivation', 'employer_required') ? 85 : 75,
    prompt: (state) =>
      is(state, 'motivation', 'employer_required')
        ? 'Pour quand votre employeur attend-il ce choix ?'
        : is(state, 'motivation', 'job_seeking') ||
            is(state, 'situation', 'seeking', 'between_contracts')
          ? 'Prêt·e à postuler pour quand ?'
          : 'Quand souhaitez-vous décider ?',
    options: (state) => {
      const today = state.facts.today;
      const dated = [1, 3, 6, 12].map((months) => {
        const date = addMonths(today, months);
        return {
          value: date,
          labelFr: months === 1 ? 'Dans 1 mois' : `Dans ${months} mois`,
          detailFr: formatMonthFr(date),
        };
      });
      const none = { value: 'none', labelFr: 'Pas d’échéance' };
      // Someone exploring most likely has no date; offer that first.
      return is(state, 'motivation', 'exploration')
        ? [none, ...dated]
        : [...dated, none];
    },
    freeInput: (state) => ({
      kind: 'date',
      min: addDays(state.facts.today, 1),
      max: addMonths(state.facts.today, 60),
      labelFr: 'Autre date',
    }),
    contextField: 'deadline',
  },
  {
    id: 'practice_level',
    recapFr: 'Pratique',
    section: 'practice',
    selection: 'single',
    dependsOn: [],
    applies: () => true,
    priority: () => 45,
    prompt: () => 'Déjà pratiqué ?',
    help: (state) =>
      `Des tâches liées à « ${goalPhrase(state.facts)} ». Cela ne fixe aucun niveau.`,
    options: () => [
      { value: 'never', labelFr: 'Jamais, je débute' },
      { value: 'occasionally', labelFr: 'Un peu' },
      { value: 'regularly', labelFr: 'Régulièrement' },
    ],
    contextField: null,
  },
  {
    id: 'recent_work_example',
    recapFr: 'Exemple',
    section: 'practice',
    selection: 'single',
    dependsOn: ['practice_level'],
    applies: (state) =>
      is(state, 'practice_level', 'occasionally', 'regularly'),
    priority: () => 44,
    prompt: () => 'Un exemple, en une phrase ?',
    help: () =>
      'Ce que vous avez fait, avec quel outil, pour quel résultat. Facultatif.',
    options: () => [],
    freeInput: () => ({
      kind: 'text',
      minLength: 10,
      maxLength: 600,
      labelFr: 'Votre exemple',
      placeholderFr:
        'Ex. J’ai construit sous Excel le suivi mensuel des ventes de mon équipe.',
    }),
    contextField: null,
  },
] satisfies readonly SurveyQuestion[]);

export const SURVEY_QUESTION_IDS: readonly string[] = SURVEY_QUESTIONS.map(
  (question) => question.id,
);
