import {
  eligibilityIssues,
  gapCoverage,
} from './recommendation-engine.js';
import { validDate, validateItem, validateLearner } from './validation.js';
import type { CandidateItem, LearnerState } from './recommendation.types.js';

export function prerequisiteRequirements(item: CandidateItem) {
  validateItem(item);
  const requirements = new Map<
    string,
    { skillId: string; label: string; minimumLevel: number }
  >();
  for (const outcome of item.outcomes) {
    if ((outcome.entryLevel ?? 0) > 0)
      requirements.set(outcome.skillId, {
        skillId: outcome.skillId,
        label: outcome.skillId,
        minimumLevel: outcome.entryLevel!,
      });
  }
  for (const requirement of item.prerequisites ?? []) {
    const existing = requirements.get(requirement.skillId);
    requirements.set(requirement.skillId, {
      ...requirement,
      minimumLevel: Math.max(
        existing?.minimumLevel ?? 0,
        requirement.minimumLevel,
      ),
    });
  }
  return [...requirements.values()];
}

export function knownLevels(learner: LearnerState) {
  validateLearner(learner);
  return new Map<string, number>([
    ...Object.entries(learner.prerequisiteLevels ?? {}),
    ...learner.skills.map(
      (skill) => [skill.skillId, skill.declaredLevel] as const,
    ),
  ]);
}

/** Scheduled finish dates are authoritative. Self-paced dates are workload estimates. */
export function courseFinish(
  item: CandidateItem,
  learner: LearnerState,
  availableAt: Date,
  allowSameDayAdmission = true,
): Date | null {
  validateLearner(learner);
  validateItem(item);
  validDate(availableAt, 'availableAt');
  if (item.admissionStatus === 'scheduled') {
    if (
      !item.nextSessionAt ||
      !item.nextEndAt || item.nextEndAt < item.nextSessionAt ||
      item.nextSessionAt.getTime() <
        (allowSameDayAdmission ? new Date(availableAt.toISOString().slice(0, 10)).getTime() : availableAt.getTime())
    )
      return null;
    return item.nextEndAt;
  }
  const weekly = learner.constraints.hoursPerWeek;
  if (!weekly || !item.durationHours) return null;
  const finish = new Date(
    availableAt.getTime() +
      Math.ceil(item.durationHours / weekly) * 7 * 86_400_000,
  );
  validDate(finish, 'course finish');
  return finish;
}

export type LearningPlan = Readonly<{
  complete: boolean;
  steps: readonly Readonly<{
    itemId: string;
    title: string;
    skillIds: readonly string[];
    finishAt: string | null;
    isEstimate: boolean;
    dataSource: string;
    tradeoffs: readonly string[];
  }>[];
  totalPriceMad: number | null;
  finishAt: string | null;
  projectedCoverage: number;
}>;

/** Bounded state search: every edge requires all prerequisites, and no course repeats. */
export function planLearningPaths(
  items: readonly CandidateItem[],
  learner: LearnerState,
  now = new Date(),
  limits = { maxDepth: 4, maxCandidates: 200, beamWidth: 64 },
) {
  validateLearner(learner);
  validDate(now, 'now');
  for (const value of [limits.maxDepth,limits.maxCandidates,limits.beamWidth])
    if (!Number.isInteger(value) || value < 1) throw new RangeError('Search limits must be positive integers');
  for (const item of items) validateItem(item);
  const total = learner.skills.reduce((sum, skill) => sum + skill.gap * skill.importance, 0);
  const blockingConstraints: Record<string, number> = {};
  const blocked = (issues: readonly string[]) => {
    for (const issue of new Set(issues)) blockingConstraints[issue] = (blockingConstraints[issue] ?? 0) + 1;
  };
  let searchTruncated = false;
  const wanted = new Set(
    learner.skills
      .filter((skill) => skill.gap > 0 && skill.importance > 0)
      .map((skill) => skill.skillId),
  );
  // Traverse prerequisite edges backwards; taxonomy adjacency is never readiness evidence.
  for (let depth = 0; depth < limits.maxDepth; depth++) {
    const additions = new Set<string>();
    for (const item of items)
      if (item.outcomes.some((outcome) => outcome.weight > 0 && wanted.has(outcome.skillId))) {
        for (const prerequisite of prerequisiteRequirements(item))
          additions.add(prerequisite.skillId);
      }
    const previousSize = wanted.size;
    for (const id of additions) wanted.add(id);
    if (wanted.size === previousSize) break;
  }
  searchTruncated = items.some((item) => item.outcomes.some((outcome) => outcome.weight > 0 && wanted.has(outcome.skillId)) &&
    prerequisiteRequirements(item).some((requirement) => !wanted.has(requirement.skillId)));
  const allRelevant = items
    .filter(
      (item) =>
        item.status === 'published' && item.actionableOffer &&
        item.outcomes.some((outcome) => outcome.weight > 0 && wanted.has(outcome.skillId)),
    )
    .sort(
      (a, b) =>
        gapCoverage(b, learner) - gapCoverage(a, learner) ||
        a.id.localeCompare(b.id),
    );
  const relevant = allRelevant.slice(0, limits.maxCandidates);
  searchTruncated ||= allRelevant.length > relevant.length;
  const missing = new Map<
    string,
    { skillId: string; label: string; minimumLevel: number }
  >();
  const held = knownLevels(learner);
  for (const item of relevant)
    for (const requirement of prerequisiteRequirements(item)) {
      if ((held.get(requirement.skillId) ?? -1) < requirement.minimumLevel) {
        const existing = missing.get(requirement.skillId);
        if (!existing || existing.minimumLevel < requirement.minimumLevel)
          missing.set(requirement.skillId, requirement);
      }
    }
  type State = {
    learner: LearnerState;
    steps: LearningPlan['steps'];
    price: number | null;
    availableAt: Date;
    hours: number;
  };
  let frontier: State[] = [
    { learner, steps: [], price: 0, availableAt: now, hours: 0 },
  ];
  const plans: LearningPlan[] = [];
  for (let depth = 0; total > 0 && depth < limits.maxDepth && frontier.length; depth++) {
    const next: State[] = [];
    for (const state of frontier)
      for (const item of relevant) {
        if (state.steps.some((step) => step.itemId === item.id)) continue;
        const issues = eligibilityIssues(item, state.learner, state.availableAt);
        if (issues.length) { blocked(issues); continue; }
        const levels = knownLevels(state.learner);
        if (
          !item.outcomes.some(
            (outcome) =>
              outcome.weight > 0 && outcome.outcomeLevel !== null &&
              outcome.outcomeLevel > (levels.get(outcome.skillId) ?? 0),
          )
        )
          continue;
        const price =
          state.price === null || item.priceMad === null
            ? null
            : state.price + item.priceMad;
        const hours = state.hours + (item.durationHours ?? 0);
        const c = learner.constraints;
        if (
          c.budgetMad !== undefined &&
          c.budgetFlexibility !== 'flexible' &&
          (price === null || price > c.budgetMad)
        ) { blocked(['budget']); continue; }
        if (c.maxDurationHours !== undefined && hours > c.maxDurationHours)
          { blocked(['duration']); continue; }
        const finish = courseFinish(item, state.learner, state.availableAt, state.steps.length === 0);
        if (!finish) { blocked([item.admissionStatus === 'scheduled' ? 'session_unavailable' : 'completion_unknown']); continue; }
        if (c.deadline && finish > c.deadline) { blocked(['completion_deadline']); continue; }
        for (const outcome of item.outcomes)
          if (outcome.weight > 0 && outcome.outcomeLevel !== null)
            levels.set(
              outcome.skillId,
              Math.max(levels.get(outcome.skillId) ?? 0, outcome.outcomeLevel),
            );
        const updated: LearnerState = {
          ...state.learner,
          prerequisiteLevels: Object.fromEntries(levels),
          skills: state.learner.skills.map((skill) => ({
            ...skill,
            declaredLevel: levels.get(skill.skillId) ?? skill.declaredLevel,
            gap: Math.max(
              0,
              skill.targetLevel -
                (levels.get(skill.skillId) ?? skill.declaredLevel),
            ),
          })),
        };
        const steps = [
          ...state.steps,
          {
            itemId: item.id,
            title: item.title,
            skillIds: item.outcomes.map((o) => o.skillId),
            finishAt: finish.toISOString(),
            isEstimate: item.admissionStatus !== 'scheduled',
            dataSource: item.dataSource,
            tradeoffs: [
              ...(c.budgetMad !== undefined &&
              price !== null &&
              price > c.budgetMad
                ? ['budget']
                : []),
              ...(c.onlineFormat && c.onlineFormat !== item.deliveryFormat
                ? ['format']
                : []),
              ...(c.languages?.length &&
              !item.languages.some((lang) => c.languages!.includes(lang))
                ? ['language']
                : []),
            ],
          },
        ];
        const remaining = updated.skills.reduce((sum, s) => sum + s.gap * s.importance, 0);
        if (remaining < total) {
          plans.push({
            complete: remaining === 0,
            steps,
            totalPriceMad: price,
            finishAt: finish.toISOString(),
            projectedCoverage: total ? 1 - remaining / total : 0,
          });
        }
        // Recording a partial result must not terminate a viable search branch.
        if (remaining > 0)
          next.push({
            learner: updated,
            steps,
            price,
            availableAt: item.admissionStatus === 'scheduled'
              ? new Date(new Date(finish.toISOString().slice(0, 10)).getTime() + 86_400_000)
              : finish,
            hours,
          });
      }
    if (next.length > limits.beamWidth || (depth === limits.maxDepth - 1 && next.length > 0)) searchTruncated = true;
    frontier = next
      .sort(
        (a, b) =>
          a.learner.skills.reduce((sum, s) => sum + s.gap * s.importance, 0) -
            b.learner.skills.reduce(
              (sum, s) => sum + s.gap * s.importance,
              0,
            ) || (a.price ?? Infinity) - (b.price ?? Infinity),
      )
      .slice(0, limits.beamWidth);
  }
  return {
    status: learner.skills.length === 0 ? 'insufficient_profile' as const
      : total === 0 ? 'goal_satisfied' as const
      : plans.some((plan) => plan.complete) ? 'complete' as const
      : plans.length ? 'partial' as const : 'no_plan' as const,
    plans: plans
      .sort(
        (a, b) =>
          b.projectedCoverage - a.projectedCoverage ||
          (a.totalPriceMad ?? Infinity) - (b.totalPriceMad ?? Infinity) ||
          a.steps.length - b.steps.length ||
          (a.finishAt ?? '').localeCompare(b.finishAt ?? '') ||
          a.steps.map((s) => s.itemId).join(':').localeCompare(b.steps.map((s) => s.itemId).join(':')),
      )
      .slice(0, 3),
    missingPrerequisites: [...missing.values()],
    blockingConstraints,
    searchTruncated,
    limits,
    searchIsBounded: true,
  };
}
