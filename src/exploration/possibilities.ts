/**
 * Assembles the possibilities map from the three sources of directions.
 * Pure: the explorer reads the rows, this merges and orders them.
 */

import type {
  ExplorationReason,
  PossibilityGroup,
  Riasec,
  RomeDirection,
} from './rome-explorer.types.js';

export type DirectionFacts = Readonly<{
  codeRome: string;
  label: string;
  riasec: Riasec | null;
}>;

export type SourcedDirection = DirectionFacts & Readonly<{ reasons: readonly ExplorationReason[] }>;

export type PossibilitySources = Readonly<{
  originCodeRome: string | null;
  includeOrigin?: boolean;
  domain?: readonly SourcedDirection[];
  mobility: readonly SourcedDirection[];
  interests: readonly SourcedDirection[];
  sharedSkills: readonly SourcedDirection[];
}>;

function sourceOrder(direction: RomeDirection) {
  for (const reason of direction.reasons) {
    if (reason.kind === 'rome_mobility') return reason.sourceOrder;
  }
  return Number.MAX_SAFE_INTEGER;
}

function interestCounts(direction: RomeDirection) {
  let matched = 0;
  let principal = 0;
  for (const reason of direction.reasons) {
    if (reason.kind !== 'rome_interest_centre') continue;
    matched += 1;
    if (reason.principal) principal += 1;
  }
  return { matched, principal };
}

function byLabel(left: RomeDirection, right: RomeDirection) {
  return left.label.localeCompare(right.label, 'fr') || left.codeRome.localeCompare(right.codeRome);
}

function limited(items: RomeDirection[], limit: number | null): PossibilityGroup {
  return { items: limit === null ? items : items.slice(0, limit), total: items.length };
}

/**
 * Every direction carries the reasons from every group it is in, so a job
 * reached both by mobility and by an interest says so wherever it is shown.
 * Legacy mobility views omit the origin; the full domain explorer retains it.
 */
export function assemblePossibilities(sources: PossibilitySources, limit: number | null) {
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer or null');
  const merged = new Map<string, { facts: DirectionFacts; reasons: ExplorationReason[] }>();
  const membership = { domain: new Set<string>(), mobility: new Set<string>(), interests: new Set<string>(), sharedSkills: new Set<string>() };
  for (const group of ['domain', 'mobility', 'interests', 'sharedSkills'] as const) {
    for (const direction of sources[group] ?? []) {
      if (!sources.includeOrigin && direction.codeRome === sources.originCodeRome) continue;
      membership[group].add(direction.codeRome);
      const entry = merged.get(direction.codeRome);
      if (entry) entry.reasons.push(...direction.reasons);
      else
        merged.set(direction.codeRome, {
          facts: { codeRome: direction.codeRome, label: direction.label, riasec: direction.riasec },
          reasons: [...direction.reasons],
        });
    }
  }
  const directions = (codes: Set<string>): RomeDirection[] =>
    [...codes].map((code) => {
      const entry = merged.get(code)!;
      return { ...entry.facts, reasons: entry.reasons };
    });

  const mobility = directions(membership.mobility).sort(
    (left, right) => sourceOrder(left) - sourceOrder(right) || byLabel(left, right),
  );
  const interests = directions(membership.interests).sort((left, right) => {
    const a = interestCounts(left);
    const b = interestCounts(right);
    return b.matched - a.matched || b.principal - a.principal || byLabel(left, right);
  });
  const sharedSkills = directions(membership.sharedSkills).sort(byLabel);
  return {
    domain: limited(directions(membership.domain).sort((a,b) => {
      const left=interestCounts(a),right=interestCounts(b);
      return right.matched-left.matched || right.principal-left.principal || sourceOrder(a)-sourceOrder(b) || byLabel(a,b);
    }), limit),
    mobility: limited(mobility, limit),
    interests: limited(interests, limit),
    sharedSkills: limited(sharedSkills, limit),
  };
}
