/**
 * What a ROME job requires, and how several jobs compare. Pure functions over
 * rows the explorer reads, so grouping and comparison are unit-tested.
 *
 * ROME v61 places each job's requirements in block 5 ("Compétences"), in
 * three rubriques: savoir-faire, savoir-être professionnels and savoirs.
 * Savoir-faire are grouped by the competence hierarchy (domain › stake);
 * savoirs by their category › subcategory. Block 6 holds work contexts.
 * The source's "cœur de métier" flag is false on every v61 row, so no
 * requirement is presented as more essential than another.
 */

export type RequirementKind = 'savoir_faire' | 'savoir_etre' | 'savoir' | 'work_context';

/** One requirement as read from the database, for one job. */
export type RequirementRow = Readonly<{
  codeRome: string;
  ogr: string;
  kind: RequirementKind;
  label: string;
  group: string | null;
  subgroup: string | null;
}>;

export type Requirement = Readonly<{ ogr: string; label: string }>;

export type RequirementGroup = Readonly<{
  label: string;
  subgroups: readonly Readonly<{ label: string | null; items: readonly Requirement[] }>[];
}>;

export type JobRequirements = Readonly<{
  savoirFaire: readonly RequirementGroup[];
  savoirEtre: readonly Requirement[];
  savoirs: readonly RequirementGroup[];
  workContexts: readonly RequirementGroup[];
  counts: Readonly<Record<RequirementKind, number>>;
}>;

const UNGROUPED = 'Autres';

function byLabel(left: { label: string | null }, right: { label: string | null }) {
  return (left.label ?? '').localeCompare(right.label ?? '', 'fr');
}

function group(rows: readonly RequirementRow[]): readonly RequirementGroup[] {
  const groups = new Map<string, Map<string | null, Requirement[]>>();
  for (const row of rows) {
    const groupLabel = row.group ?? UNGROUPED;
    let subgroups = groups.get(groupLabel);
    if (!subgroups) groups.set(groupLabel, (subgroups = new Map()));
    const items = subgroups.get(row.subgroup) ?? [];
    items.push({ ogr: row.ogr, label: row.label });
    subgroups.set(row.subgroup, items);
  }
  return [...groups.entries()]
    .map(([label, subgroups]) => ({
      label,
      subgroups: [...subgroups.entries()]
        .map(([subLabel, items]) => ({
          label: subLabel,
          items: [...items].sort(byLabel),
        }))
        .sort(byLabel),
    }))
    .sort((left, right) =>
      // "Autres" last; otherwise alphabetical, never by size.
      left.label === UNGROUPED ? 1 : right.label === UNGROUPED ? -1 : byLabel(left, right),
    );
}

/** Groups one job's rows. Duplicate (kind, ogr) rows are kept once. */
export function groupRequirements(rows: readonly RequirementRow[]): JobRequirements {
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = `${row.kind}|${row.ogr}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const of = (kind: RequirementKind) => unique.filter((row) => row.kind === kind);
  return {
    savoirFaire: group(of('savoir_faire')),
    savoirEtre: of('savoir_etre')
      .map((row) => ({ ogr: row.ogr, label: row.label }))
      .sort(byLabel),
    savoirs: group(of('savoir')),
    workContexts: group(of('work_context')),
    counts: {
      savoir_faire: of('savoir_faire').length,
      savoir_etre: of('savoir_etre').length,
      savoir: of('savoir').length,
      work_context: of('work_context').length,
    },
  };
}

/**
 * A job joins the "shares your skills" group when it shares at least this
 * share of the origin's savoir-faire, and at least MIN_SHARED of them.
 * Measured on v61: 20 % keeps between 1 and 17 jobs for typical origins,
 * few enough to list alphabetically instead of ranking by overlap.
 */
export const SHARED_SKILLS_MIN_FRACTION = 0.2;
export const SHARED_SKILLS_MIN_COUNT = 3;

export function sharedSkillsThreshold(originSavoirFaireCount: number): number {
  return Math.max(
    SHARED_SKILLS_MIN_COUNT,
    Math.ceil(originSavoirFaireCount * SHARED_SKILLS_MIN_FRACTION),
  );
}

export type ComparedRequirement = Requirement &
  Readonly<{ kind: RequirementKind; group: string | null; jobs: readonly string[] }>;

export type RequirementComparison = Readonly<{
  jobs: readonly string[];
  /** Required by every compared job. */
  common: readonly ComparedRequirement[];
  /** Required by some but not all; `jobs` says which. */
  partial: readonly ComparedRequirement[];
  /** Required by exactly one job, per job. */
  onlyIn: Readonly<Record<string, readonly ComparedRequirement[]>>;
}>;

/**
 * Set comparison of requirements across 2–3 jobs: what they all need, what
 * some need, and what only one needs. Work contexts are compared too, since
 * "possibilité de télétravail" or "travail de nuit" matter when choosing.
 */
export function compareRequirements(
  jobs: readonly string[],
  rows: readonly RequirementRow[],
): RequirementComparison {
  if (jobs.length < 2 || jobs.length > 3) {
    throw new Error('Compare two or three jobs');
  }
  if (new Set(jobs).size !== jobs.length) throw new Error('Compare different jobs');
  const byItem = new Map<string, { row: RequirementRow; jobs: Set<string> }>();
  for (const row of rows) {
    if (!jobs.includes(row.codeRome)) continue;
    const key = `${row.kind}|${row.ogr}`;
    const entry = byItem.get(key);
    if (entry) entry.jobs.add(row.codeRome);
    else byItem.set(key, { row, jobs: new Set([row.codeRome]) });
  }
  const items = [...byItem.values()]
    .map(({ row, jobs: owners }) => ({
      ogr: row.ogr,
      label: row.label,
      kind: row.kind,
      group: row.group,
      // In the caller's job order, so the output is stable.
      jobs: jobs.filter((job) => owners.has(job)),
    }))
    .sort((left, right) =>
      left.kind === right.kind ? byLabel(left, right) : left.kind.localeCompare(right.kind),
    );
  const onlyIn: Record<string, ComparedRequirement[]> = Object.fromEntries(
    jobs.map((job) => [job, []]),
  );
  for (const item of items) {
    if (item.jobs.length === 1) onlyIn[item.jobs[0]!]!.push(item);
  }
  return {
    jobs,
    common: items.filter((item) => item.jobs.length === jobs.length),
    partial: items.filter((item) => item.jobs.length > 1 && item.jobs.length < jobs.length),
    onlyIn,
  };
}
