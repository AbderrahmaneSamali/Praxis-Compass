import type { CareerPossibility, RequirementAnalysis, StartingProfile } from './exploration.types.js';
import type { CareerLevelAvailability } from './career-levels.js';

export type CareerGraphOptions = {
  page?: number; pageSize?: number; expandedIds?: string[]; skillPage?: number;
  skillState?: 'all' | RequirementAnalysis['state'];
  skillKind?: 'all' | 'savoir_faire' | 'savoir_etre' | 'savoir';
  filter?: 'all' | 'saved' | 'practiced';
};

export class CareerGraphInputError extends Error {}
const states = ['supported', 'development_needed', 'unknown', 'conflicting'] as const;
const keyOf = (item: RequirementAnalysis) => `${item.requirementKind ?? 'skill'}:${item.skillId}`;
const alphabetic = (a: CareerPossibility, b: CareerPossibility) => a.title.localeCompare(b.title, 'fr') || a.id.localeCompare(b.id);

/** A bounded projection of the complete candidate set, with no inferred edges or readiness scores. */
export function buildCareerGraph(profile: StartingProfile, possibilities: readonly CareerPossibility[], options: CareerGraphOptions = {},
  levelCoverage:Record<string,{availability:CareerLevelAvailability;frameworkCount:number;marketCode:string|null;trackCode:string|null}> = {}) {
  const { page = 0, pageSize = 4, skillPage = 0, skillState = 'all', skillKind = 'all', filter = 'all', expandedIds = [] } = options;
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 12 ||
      !Number.isInteger(skillPage) || skillPage < 0 || !['all', ...states].includes(skillState) ||
      !['all', 'savoir_faire', 'savoir_etre', 'savoir'].includes(skillKind) || !['all', 'saved', 'practiced'].includes(filter) ||
      !Array.isArray(expandedIds) || expandedIds.length > 3 || new Set(expandedIds).size !== expandedIds.length ||
      expandedIds.some(id => typeof id !== 'string')) throw new CareerGraphInputError('Options de carte invalides.');
  const all = possibilities.filter(item => !profile.preferredDomainCode ||
    item.romeProfile?.professionalDomains.some(domain => domain.code === profile.preferredDomainCode)).slice().sort(alphabetic);
  const byId = new Map(all.map(item => [item.id, item]));
  if (expandedIds.some(id => !byId.has(id))) throw new CareerGraphInputError('Métier indisponible dans votre exploration.');
  const filtered = all.filter(item => filter === 'all' || (filter === 'saved' ? item.saved : item.requirements.some(r => r.state === 'supported')));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const visible = [...new Map([...pageItems, ...expandedIds.map(id => byId.get(id)!)].map(item => [item.id, item])).values()];
  const summaries = (items: readonly CareerPossibility[]) => items.map(item => ({
    id: item.id, title: item.title, saved: item.saved, current: item.romeCode === profile.currentRomeCode,
    counts: Object.fromEntries(states.map(state => [state, item.requirements.filter(r => r.state === state).length])),
    requirementCount: item.requirements.length, reasons: item.reasons ?? [],
    sources: item.sources, expanded: expandedIds.includes(item.id), pinned: !pageItems.some(row => row.id === item.id),
    levelAvailability: levelCoverage[item.romeCode??'']?.availability ?? 'unavailable',
    levelMarketCode: levelCoverage[item.romeCode??'']?.marketCode ?? null,
    levelFrameworkCount: levelCoverage[item.romeCode??'']?.frameworkCount ?? 0,
  }));
  const linked = new Map<string, { id: string; title: string }[]>();
  for (const job of all) for (const key of new Set(job.requirements.map(keyOf))) {
    const matches = linked.get(key) ?? []; matches.push({id: job.id, title: job.title}); linked.set(key, matches);
  }
  const skills = new Map<string, RequirementAnalysis>();
  for (const id of expandedIds) for (const item of byId.get(id)!.requirements) {
    if ((skillState === 'all' || item.state === skillState) && (skillKind === 'all' || item.requirementKind === skillKind)) skills.set(keyOf(item), item);
  }
  const sortedSkills = [...skills].sort((a, b) => (linked.get(b[0])?.length ?? 0) - (linked.get(a[0])?.length ?? 0) ||
    a[1].label.localeCompare(b[1].label, 'fr') || a[0].localeCompare(b[0]));
  const skillPageSize = 4, skillPageCount = Math.max(1, Math.ceil(skills.size / skillPageSize));
  const currentSkillPage = Math.min(skillPage, skillPageCount - 1);
  const shownSkills = sortedSkills.slice(currentSkillPage * skillPageSize, (currentSkillPage + 1) * skillPageSize);
  const root = { id: 'scope', label: profile.preferredDomainLabel ?? 'Votre exploration', kind: profile.preferredDomainCode ? 'domain' : 'profile' };
  const edges = visible.map(job => ({
    id: `scope:${job.id}`, from: root.id, to: job.id, kind: 'candidate',
    label: profile.preferredDomainCode ? 'Appartient au domaine choisi' : 'Lié à votre point de départ',
    references: (job.reasons ?? []).map(reason => ({ ...reason })),
  }));
  const requirementEdges = visible.filter(job => expandedIds.includes(job.id)).flatMap(job => shownSkills.flatMap(([key]) => {
    const requirement = job.requirements.find(item => keyOf(item) === key);
    return requirement ? [{id: `${job.id}:requires:${key}`, from: job.id, to: `skill:${key}`, kind: 'requirement',
      label: 'Exigence publiée pour ce métier', references: [{
        kind: 'occupation_requirement', codeRome: job.romeCode ?? null, itemId: requirement.romeOgr ?? requirement.skillId,
        requirementKind: requirement.requirementKind ?? null, sourceReference: requirement.source.reference,
        releaseId: job.romeProfile?.releaseId ?? null,
      }]}] : [];
  }));
  return {
    version: 'praxis-career-graph-v1', root,
    total: all.length, filteredTotal: filtered.length, page: currentPage, pageSize, pageCount,
    pageIds: pageItems.map(item => item.id), careers: summaries(visible),
    skills: shownSkills.map(([key, item]) => ({ id: `skill:${key}`, requirementId: item.romeOgr ?? item.skillId,
      label: item.label, kind: item.requirementKind ?? null, state: item.state,
      evidenceType: item.evidenceType, evidenceId: item.evidenceId, source: item.source,
      linkedCareers: linked.get(key) ?? [],
    })),
    skillTotal: skills.size, skillPage: currentSkillPage, skillPageCount, skillPageSize,
    expandedIds, edges: [...edges, ...requirementEdges],
    ordering: 'Métiers par ordre alphabétique. Exigences partagées par le plus de métiers du périmètre en premier, puis ordre alphabétique.',
    coverage: 'Les liens décrivent le catalogue disponible. Une pratique déclarée ne prouve pas la maîtrise. Les niveaux de carrière sont disponibles uniquement avec un référentiel revu pour le pays et le métier choisis.',
  };
}
