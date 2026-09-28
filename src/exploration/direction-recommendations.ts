import type { CareerPossibility, StartingProfile } from './exploration.types.js';

export type RecommendationSignal = Readonly<{
  kind: 'domain' | 'starting_occupation' | 'interest' | 'mobility' | 'shared_skills' | 'personal_confirmation';
  label: string;
  sourceId: string;
}>;

export type DirectionRecommendation = Readonly<{
  directionId: string;
  title: string;
  signals: readonly RecommendationSignal[];
  nextStep: Readonly<{
    kind: 'confirm' | 'practice' | 'conversation';
    label: string;
    requirementId: string | null;
    linkedDirections: number;
  }>;
  rankingNote: string;
  confirmedCount: number;
  unknownCount: number;
}>;

/** Orders graph-linked directions using explicit interests and source links, never a fit score. */
export function recommendDirections(profile: StartingProfile,
  possibilities: readonly CareerPossibility[], limit = 5): DirectionRecommendation[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Invalid direction limit');
  const confirmedInterests = new Set(profile.confirmedInterestCodes ?? []);
  const candidates = possibilities.filter(item => item.romeCode && item.reasons?.length &&
    (!profile.preferredDomainCode || item.romeProfile?.professionalDomains.some(domain=>domain.code===profile.preferredDomainCode)));
  const unknownFrequency = new Map<string, number>();
  for (const item of candidates) {
    for (const requirement of item.requirements) {
      if (requirement.romeOgr && requirement.requirementKind === 'savoir_faire' &&
        (requirement.state === 'unknown' || requirement.state === 'conflicting')) {
        unknownFrequency.set(requirement.romeOgr, (unknownFrequency.get(requirement.romeOgr) ?? 0) + 1);
      }
    }
  }
  const ordered = candidates.map(item => {
    const interests = (item.reasons ?? []).filter(reason =>
      reason.kind === 'rome_interest_centre' && confirmedInterests.has(reason.centreCode));
    const mobility = (item.reasons ?? []).find(reason => reason.kind === 'rome_mobility');
    const shared = (item.reasons ?? []).find(reason => reason.kind === 'rome_shared_skills');
    const confirmed = item.requirements.filter(requirement => requirement.state === 'supported');
    const unknown = item.requirements.filter(requirement =>
      requirement.state === 'unknown' || requirement.state === 'conflicting');
    const development = item.requirements.filter(requirement => requirement.state === 'development_needed');
    const principalInterests = interests.filter(reason => reason.kind === 'rome_interest_centre' && reason.principal).length;
    const domain = (item.reasons ?? []).find(reason=>reason.kind==='rome_domain' && reason.domainCode===profile.preferredDomainCode);
    const startingOccupation=Boolean(profile.currentRomeCode&&item.romeCode===profile.currentRomeCode);
    const signals: RecommendationSignal[] = [
      ...(domain?.kind==='rome_domain' ? [{kind:'domain' as const,label:domain.domainLabel,
        sourceId:`domain:${domain.releaseId}:${domain.domainCode}:${item.romeCode}`}] : []),
      ...(startingOccupation ? [{kind:'starting_occupation' as const,label:'Métier actuel ou précédent sélectionné comme point de départ',
        sourceId:`profile:starting-occupation:${item.romeCode}`}] : []),
      ...interests.map(reason => reason.kind === 'rome_interest_centre' ? {
        kind: 'interest' as const,
        label: `${reason.principal ? 'Intérêt principal du métier' : 'Intérêt lié au métier'} : « ${reason.centreLabel} »`,
        sourceId: `interest:${reason.releaseId}:${reason.centreCode}:${item.romeCode}`,
      } : {kind: 'interest' as const, label: '', sourceId: ''}),
      ...(mobility?.kind === 'rome_mobility' ? [{
        kind: 'mobility' as const,
        label: 'Lien de mobilité entre votre métier et cette piste',
        sourceId: `mobility:${mobility.releaseId}:${mobility.fromCodeRome}:${mobility.toCodeRome}`,
      }] : []),
      ...(shared?.kind === 'rome_shared_skills' ? [{
        kind: 'shared_skills' as const,
        label: `${shared.sharedSkillOgrs.length} savoir-faire communs entre les deux métiers`,
        sourceId: `shared:${shared.releaseId}:${shared.fromCodeRome}:${item.romeCode}`,
      }] : []),
      ...(confirmed.length ? [{
        kind: 'personal_confirmation' as const,
        label: `${confirmed.length} exigence(s) que vous avez déclarée(s) pratiquée(s)`,
        sourceId: `confirmation:${confirmed[0]?.evidenceId ?? 'unknown'}`,
      }] : []),
    ];
    const practicalUnknown = unknown.filter(requirement => requirement.requirementKind === 'savoir_faire');
    const firstUnknown = practicalUnknown.sort((a,b) =>
      (unknownFrequency.get(b.romeOgr ?? '') ?? 0) - (unknownFrequency.get(a.romeOgr ?? '') ?? 0))[0] ?? unknown[0];
    const firstDevelopment = development.find(requirement => requirement.requirementKind === 'savoir_faire') ?? development[0];
    const linkedDirections = firstUnknown?.romeOgr ? unknownFrequency.get(firstUnknown.romeOgr) ?? 1 : 1;
    const nextStep = firstUnknown ? {
      kind: 'confirm' as const,
      label: `Indiquez si vous avez déjà pratiqué « ${firstUnknown.label} »${linkedDirections > 1 ? ` : cette réponse éclairera ${linkedDirections} pistes` : ''}`,
      requirementId: firstUnknown.romeOgr ?? null,
      linkedDirections,
    } : firstDevelopment ? {
      kind: 'practice' as const,
      label: `Essayez une courte tâche autour de « ${firstDevelopment.label} »`,
      requirementId: firstDevelopment.romeOgr ?? null,
      linkedDirections: 1,
    } : {
      kind: 'conversation' as const,
      label: `Échangez avec une personne exerçant « ${item.title} »`,
      requirementId: null,
      linkedDirections: 1,
    };
    const basis = interests.length
      ? `${interests.length} centre${interests.length > 1 ? 's' : ''} d’intérêt lié${interests.length > 1 ? 's' : ''} à ce métier${principalInterests ? `, dont ${principalInterests} principal${principalInterests > 1 ? 's' : ''}` : ''}`
      : startingOccupation ? 'Métier actuel ou précédent sélectionné comme point de départ'
      : mobility ? 'Lien de mobilité publié depuis votre métier' : shared ? 'Savoir-faire communs avec votre métier' : 'À découvrir dans votre domaine : aucune affinité personnelle établie';
    const rankingNote = domain?.kind==='rome_domain' ? `${domain.domainLabel} · ${basis}` : basis;
    return { item, interests: interests.length, principalInterests, confirmed: confirmed.length, startingOccupation,
      mobilityOrder: mobility?.kind === 'rome_mobility' ? mobility.sourceOrder : Number.MAX_SAFE_INTEGER,
      sharedCount: shared?.kind === 'rome_shared_skills' ? shared.sharedSkillOgrs.length : 0,
      recommendation: { directionId: item.id, title: item.title, signals,
        nextStep, rankingNote, confirmedCount: confirmed.length, unknownCount: unknown.length } };
  });
  ordered.sort((a, b) => b.interests - a.interests || b.confirmed - a.confirmed ||
    b.principalInterests - a.principalInterests || Number(b.startingOccupation)-Number(a.startingOccupation) ||
    a.mobilityOrder - b.mobilityOrder || b.sharedCount - a.sharedCount ||
    a.item.title.localeCompare(b.item.title, 'fr'));
  return ordered.slice(0, limit).map(item => item.recommendation);
}
