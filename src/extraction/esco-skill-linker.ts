import { ALGORITHM_VERSIONS } from '../kernel/index.js';

export type CvLanguage = 'fr' | 'ar' | 'mixed';

export type EscoSkillConcept = {
  uri: string;
  type: string;
  labels: Readonly<Record<string, string | undefined>>;
  alternatives?: Readonly<Record<string, readonly string[] | undefined>>;
};

export type EscoSkillCatalog = {
  version?: string;
  concepts: readonly EscoSkillConcept[];
};

export type SkillMention = { start: number; end: number };

export type SkillLinkCandidate = {
  skillId: string;
  retrievalScore: number;
  rankScore: number;
  matchedLabel: string;
  matchedLanguage: string;
  labelKind: 'preferred' | 'alternative';
};

export type SkillLinkDecision = {
  start: number;
  end: number;
  decision: 'linked' | 'nil' | 'abstain';
  skillId: string | null;
  candidates: string[];
  ranking: SkillLinkCandidate[];
  reason: 'accepted' | 'no_candidates' | 'below_nil_threshold' | 'below_link_threshold' | 'ambiguous_margin';
};

export type SkillLinkerOptions = {
  expanded?: boolean;
  maxCandidates?: number;
  minimumRetrievalScore?: number;
  nilThreshold?: number;
  linkThreshold?: number;
  marginThreshold?: number;
};

type LabelEntry = {
  skillId: string;
  label: string;
  normalized: string;
  language: string;
  labelKind: 'preferred' | 'alternative';
  tokenSet: Set<string>;
  trigramSet: Set<string>;
  length: number;
};

type CatalogIndex = { entries: LabelEntry[]; exact: Map<string, LabelEntry[]> };

const INDEX_CACHE = new WeakMap<object, Map<string, CatalogIndex>>();

const DEFAULTS = Object.freeze({
  maxCandidates: 10,
  minimumRetrievalScore: 0.25,
  nilThreshold: 0.35,
  linkThreshold: 0.88,
  marginThreshold: 0.08,
});

function finiteUnit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function options(input: SkillLinkerOptions = {}) {
  const result = {
    expanded: input.expanded ?? false,
    maxCandidates: input.maxCandidates ?? DEFAULTS.maxCandidates,
    minimumRetrievalScore: finiteUnit(input.minimumRetrievalScore ?? DEFAULTS.minimumRetrievalScore, 'minimumRetrievalScore'),
    nilThreshold: finiteUnit(input.nilThreshold ?? DEFAULTS.nilThreshold, 'nilThreshold'),
    linkThreshold: finiteUnit(input.linkThreshold ?? DEFAULTS.linkThreshold, 'linkThreshold'),
    marginThreshold: finiteUnit(input.marginThreshold ?? DEFAULTS.marginThreshold, 'marginThreshold'),
  };
  if (!Number.isInteger(result.maxCandidates) || result.maxCandidates < 1 || result.maxCandidates > 10)
    throw new RangeError('maxCandidates must be an integer from 1 to 10');
  if (result.nilThreshold > result.linkThreshold) throw new RangeError('nilThreshold cannot exceed linkThreshold');
  return result;
}

function normalize(value: string, expanded: boolean): string {
  return value.normalize(expanded ? 'NFKC' : 'NFC').toLocaleLowerCase('fr').replace(/\s+/gu, ' ').trim();
}

function normalizeCharacter(value: string, expanded: boolean): string {
  return value.normalize(expanded ? 'NFKC' : 'NFC').toLocaleLowerCase('fr');
}

const isWord = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}_]/u.test(character);
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function tokens(value: string): Set<string> {
  return new Set(value.match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function trigrams(value: string): Set<string> {
  const compact = `  ${value.replace(/\s+/gu, ' ')}  `;
  const points = Array.from(compact);
  const result = new Set<string>();
  for (let index = 0; index <= points.length - 3; index += 1) result.add(points.slice(index, index + 3).join(''));
  return result;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function dice(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

function catalogIndex(catalog: EscoSkillCatalog, language: CvLanguage, expanded: boolean): CatalogIndex {
  if (!catalog || !Array.isArray(catalog.concepts)) throw new TypeError('A catalog with concepts is required');
  const cacheKey = `${language}:${expanded}`;
  const cache = INDEX_CACHE.get(catalog as object);
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const result: LabelEntry[] = [];
  for (const concept of catalog.concepts) {
    if (concept.type !== 'skill' || !concept.uri?.trim()) continue;
    const preferred = language === 'mixed' || expanded
      ? Object.entries(concept.labels)
      : [[language, concept.labels[language]] as const];
    const alternatives = expanded
      ? (Object.entries(concept.alternatives ?? {}) as [string, readonly string[] | undefined][]).flatMap(([entryLanguage, labels]) =>
          (labels ?? []).map((label) => [entryLanguage, label] as const))
      : [];
    for (const [entryLanguage, label, labelKind] of [
      ...preferred.map(([entryLanguage, label]) => [entryLanguage, label, 'preferred'] as const),
      ...alternatives.map(([entryLanguage, label]) => [entryLanguage, label, 'alternative'] as const),
    ]) {
      if (!label?.trim()) continue;
      const normalized = normalize(label, expanded);
      if (Array.from(normalized).length < 2) continue;
      result.push({ skillId: concept.uri, label, normalized, language: entryLanguage, labelKind,
        tokenSet: tokens(normalized), trigramSet: trigrams(normalized), length: Array.from(normalized).length });
    }
  }
  const exact = new Map<string, LabelEntry[]>();
  for (const entry of result) exact.set(entry.normalized, [...(exact.get(entry.normalized) ?? []), entry]);
  const index = { entries: result, exact };
  const nextCache = cache ?? new Map<string, CatalogIndex>();
  nextCache.set(cacheKey, index);
  if (!cache) INDEX_CACHE.set(catalog as object, nextCache);
  return index;
}

function lexicalScore(mention: string, mentionTokens: Set<string>, mentionTrigrams: Set<string>, mentionLength: number, entry: LabelEntry): number {
  if (mention === entry.normalized) return entry.labelKind === 'preferred' ? 1 : 0.96;
  const tokenScore = jaccard(mentionTokens, entry.tokenSet);
  const trigramScore = dice(mentionTrigrams, entry.trigramSet);
  const containment = mention.includes(entry.normalized) || entry.normalized.includes(mention)
    ? Math.min(mentionLength, entry.length) / Math.max(mentionLength, entry.length)
    : 0;
  return Math.max(0.55 * trigramScore + 0.35 * tokenScore + 0.1 * containment, 0.7 * containment);
}

/** Stage 1: generate a bounded ESCO candidate set. Scores are lexical signals, not probabilities. */
export function retrieveSkillCandidates(
  mentionText: string,
  catalog: EscoSkillCatalog,
  language: CvLanguage,
  input: SkillLinkerOptions = {},
): Omit<SkillLinkCandidate, 'rankScore'>[] {
  const config = options(input);
  const mention = normalize(mentionText, config.expanded);
  if (!mention) return [];
  const index = catalogIndex(catalog, language, config.expanded);
  const exact = index.exact.get(mention);
  const searchable = exact?.length ? exact : index.entries;
  const mentionTokens = tokens(mention);
  const mentionTrigrams = trigrams(mention);
  const mentionLength = Array.from(mention).length;
  const bySkill = new Map<string, Omit<SkillLinkCandidate, 'rankScore'>>();
  for (const entry of searchable) {
    const retrievalScore = lexicalScore(mention, mentionTokens, mentionTrigrams, mentionLength, entry);
    if (retrievalScore < config.minimumRetrievalScore) continue;
    const candidate = { skillId: entry.skillId, retrievalScore: round(retrievalScore), matchedLabel: entry.label,
      matchedLanguage: entry.language, labelKind: entry.labelKind };
    const current = bySkill.get(entry.skillId);
    if (!current || candidate.retrievalScore > current.retrievalScore ||
      (candidate.retrievalScore === current.retrievalScore && candidate.labelKind === 'preferred' && current.labelKind !== 'preferred'))
      bySkill.set(entry.skillId, candidate);
  }
  return [...bySkill.values()]
    .sort((left, right) => right.retrievalScore - left.retrievalScore || left.skillId.localeCompare(right.skillId))
    .slice(0, config.maxCandidates);
}

/** Stage 2: rerank retrieved candidates independently from candidate generation. */
export function rankSkillCandidates(
  mentionText: string,
  candidates: readonly Omit<SkillLinkCandidate, 'rankScore'>[],
  expanded = false,
): SkillLinkCandidate[] {
  const mention = normalize(mentionText, expanded);
  return candidates.map((candidate) => {
    const exact = mention === normalize(candidate.matchedLabel, expanded);
    const rankScore = exact
      ? candidate.labelKind === 'preferred' ? 1 : 0.96
      : Math.min(1, candidate.retrievalScore * 0.94 + (candidate.labelKind === 'preferred' ? 0.03 : 0));
    return { ...candidate, rankScore: round(rankScore) };
  }).sort((left, right) => right.rankScore - left.rankScore || right.retrievalScore - left.retrievalScore ||
    left.skillId.localeCompare(right.skillId));
}

function validateMentions(text: string, mentions: readonly SkillMention[]): void {
  const length = Array.from(text).length;
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < 0 || mention.end <= mention.start || mention.end > length)
      throw new RangeError('Mention offsets must be Unicode code points with an exclusive end');
    const key = `${mention.start}:${mention.end}`;
    if (seen.has(key)) throw new TypeError('Duplicate mention');
    seen.add(key);
  }
}

/** Links detector-supplied spans without treating a mention as proof of learner mastery. */
export function linkSkillMentions(
  record: { documentId: string; language: CvLanguage; text: string },
  catalog: EscoSkillCatalog,
  mentions: readonly SkillMention[],
  input: SkillLinkerOptions = {},
) {
  if (!record.documentId?.trim() || typeof record.text !== 'string' || !['fr', 'ar', 'mixed'].includes(record.language))
    throw new TypeError('A documentId, supported language and text are required');
  validateMentions(record.text, mentions);
  const config = options(input);
  const codePoints = Array.from(record.text);
  const spans: SkillLinkDecision[] = mentions.map((mention) => {
    const mentionText = codePoints.slice(mention.start, mention.end).join('');
    const retrieved = retrieveSkillCandidates(mentionText, catalog, record.language, config);
    const ranking = rankSkillCandidates(mentionText, retrieved, config.expanded).slice(0, config.maxCandidates);
    const candidates = ranking.map((candidate) => candidate.skillId);
    const top = ranking[0];
    const margin = top ? top.rankScore - (ranking[1]?.rankScore ?? 0) : 0;
    if (!top) return { ...mention, decision: 'nil' as const, skillId: null, candidates, ranking, reason: 'no_candidates' as const };
    if (top.rankScore < config.nilThreshold)
      return { ...mention, decision: 'nil' as const, skillId: null, candidates, ranking, reason: 'below_nil_threshold' as const };
    if (top.rankScore < config.linkThreshold)
      return { ...mention, decision: 'abstain' as const, skillId: null, candidates, ranking, reason: 'below_link_threshold' as const };
    if (margin < config.marginThreshold)
      return { ...mention, decision: 'abstain' as const, skillId: null, candidates, ranking, reason: 'ambiguous_margin' as const };
    return { ...mention, decision: 'linked' as const, skillId: top.skillId, candidates, ranking, reason: 'accepted' as const };
  });
  return { documentId: record.documentId, catalogVersion: catalog.version ?? null,
    algorithmVersion: ALGORITHM_VERSIONS.escoSkillLinker, spans };
}

/** Exact alias mention detector retained as a reproducible baseline ahead of a trained detector. */
export function detectCatalogMentions(
  record: { documentId: string; language: CvLanguage; text: string },
  catalog: EscoSkillCatalog,
  input: SkillLinkerOptions = {},
): SkillMention[] {
  const config = options(input);
  const original = Array.from(record.text);
  const characters: string[] = [];
  const offsets: number[] = [];
  original.forEach((character, index) => {
    for (const normalized of Array.from(normalizeCharacter(character, config.expanded))) {
      characters.push(normalized);
      offsets.push(index);
    }
  });
  const text = characters.join('');
  const matches = new Map<string, SkillMention>();
  for (const entry of catalogIndex(catalog, record.language, config.expanded).entries) {
    let position = 0;
    while ((position = text.indexOf(entry.normalized, position)) !== -1) {
      const start = Array.from(text.slice(0, position)).length;
      const end = start + Array.from(entry.normalized).length;
      position += entry.normalized.length;
      if (isWord(characters[start - 1]) || isWord(characters[end])) continue;
      const originalStart = offsets[start];
      const lastOffset = offsets[end - 1];
      if (originalStart === undefined || lastOffset === undefined) continue;
      matches.set(`${originalStart}:${lastOffset + 1}`, { start: originalStart, end: lastOffset + 1 });
    }
  }
  const accepted: SkillMention[] = [];
  for (const mention of [...matches.values()].sort((left, right) =>
    (right.end - right.start) - (left.end - left.start) || left.start - right.start)) {
    if (!accepted.some((other) => mention.start < other.end && mention.end > other.start)) accepted.push(mention);
  }
  return accepted.sort((left, right) => left.start - right.start);
}

export function extractCatalogSkills(
  record: { documentId: string; language: CvLanguage; text: string },
  catalog: EscoSkillCatalog,
  input: SkillLinkerOptions = {},
) {
  return linkSkillMentions(record, catalog, detectCatalogMentions(record, catalog, input), input);
}
