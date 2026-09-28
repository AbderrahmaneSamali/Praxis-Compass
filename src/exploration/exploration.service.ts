import type { EvidenceProfile } from '../evidence/learner-evidence.js';
import { analyzeRequirements } from './skill-gap-analysis.js';
import { startingActions } from './development-actions.js';
import type { CareerPossibility, ExplorationResult, RequirementAnalysis, RoleDirection, RomeConfirmation, StartingProfile } from './exploration.types.js';

function analyzeRomeRequirements(direction: RoleDirection, confirmations: readonly RomeConfirmation[]): RequirementAnalysis[] {
  const byOgr = new Map<string, RomeConfirmation[]>();
  for (const item of confirmations) {
    const list = byOgr.get(item.ogr) ?? [];
    list.push(item);
    byOgr.set(item.ogr, list);
  }
  return direction.requirements.map((requirement) => {
    const matches = byOgr.get(requirement.romeOgr ?? '') ?? [];
    const responses = new Set(matches.map((item) => item.response));
    const state = responses.size > 1 ? 'conflicting' : responses.has('practiced') ? 'supported'
      : responses.has('not_yet') ? 'development_needed' : 'unknown';
    return { ...requirement, state, observedLevel: null,
      evidenceType: matches.length ? 'rome_self_confirmation' : null,
      evidenceStrength: matches.length ? 'low' : null,
      evidenceId: matches[0]?.id ?? null,
      disagreementResolution: responses.size > 1 ? 'unresolved' : null };
  });
}

export function exploreDirections(profile: StartingProfile, directions: readonly RoleDirection[], evidence: EvidenceProfile,
  savedIds: readonly string[] = [], romeConfirmations: readonly RomeConfirmation[] = []): ExplorationResult {
  const saved = new Set(savedIds);
  const possibilities: CareerPossibility[] = directions.filter(direction =>
    direction.kind !== 'current_role_growth' || direction.roleId === profile.currentRoleId).map(direction => {
    const requirements = direction.romeCode
      ? analyzeRomeRequirements(direction, romeConfirmations)
      : analyzeRequirements(direction.requirements, evidence);
    const transferableSkills = requirements.filter(item => item.state === 'supported');
    const matchedInterests = direction.interestTags.filter(tag => profile.interests.toLocaleLowerCase('fr').includes(tag.toLocaleLowerCase('fr')));
    const mentionedExperience = direction.interestTags.filter(tag => profile.experience.toLocaleLowerCase('fr').includes(tag.toLocaleLowerCase('fr')));
    const reasons = direction.romeCode ? [] : [
      ...matchedInterests.map(tag => `Votre intérêt pour « ${tag} » rejoint cette direction.`),
      ...mentionedExperience.filter(tag => !matchedInterests.includes(tag)).map(tag => `Vous mentionnez « ${tag} » dans votre expérience; cela mérite d’être exploré, sans établir un niveau de compétence.`),
      ...transferableSkills.slice(0, 2).map(item => `Votre niveau ${item.observedLevel} en « ${item.label} » répond au niveau indiqué; source : ${item.evidenceType === 'self_declared' ? 'déclaration personnelle' : 'preuve enregistrée'}.`),
      ...(profile.currentRoleId === direction.roleId ? ['Cette piste développe votre métier actuel.'] : []),
    ];
    if (!direction.romeCode && !reasons.length) reasons.push('Cette piste fait partie du petit catalogue de démonstration. Explorez ses responsabilités et précisez votre profil pour juger si elle vous convient.');
    const uncertainties = requirements.filter(item => item.state === 'unknown' || item.disagreementResolution)
      .slice(0, 4).map(item => `${item.label} : ${item.disagreementResolution ? 'preuves divergentes' : 'niveau non connu'}.`);
    return { id: direction.id, kind: direction.kind, title: direction.title, description: direction.description,
      responsibilities: direction.responsibilities, reasonsToExplore: reasons,
      reasons: direction.reasons, romeCode: direction.romeCode, romeProfile: direction.romeProfile,
      workContexts: direction.workContexts,
      transferableSkills,
      requirements, startingActions: startingActions(direction, requirements), uncertainties,
      sources: direction.sources, saved: saved.has(direction.id) };
  });
  const questions = [
    ...(!(directions.some(item => item.romeCode) ? profile.currentRomeCode : profile.currentRoleId) ? ['Quel métier exercez-vous actuellement ? Cela aide à distinguer une évolution de poste d’une transition.'] : []),
    ...(!profile.experience ? ['Quelle tâche avez-vous déjà réalisée au travail ou dans un projet ? Un exemple peut éclairer vos compétences transférables.'] : []),
    ...(!profile.interests ? ['Quelles activités vous intéressent ? Cela aide à choisir les pistes à approfondir.'] : []),
  ];
  if (!questions.length) {
    const firstUnknown = possibilities.flatMap(item => item.requirements).find(item => item.state === 'unknown');
    if (firstUnknown) questions.push(`Avez-vous déjà pratiqué « ${firstUnknown.label} » ? Cette réponse clarifierait une exigence de métier.`);
  }
  return { possibilities, questions: questions.slice(0, 3),
    coverageNote: directions.some(item => item.romeCode) || profile.currentRomeCode || profile.confirmedInterestCodes?.length
      ? 'Pistes issues des fiches métiers de France Travail. Ces fiches ne publient pas de niveau attendu; seules vos confirmations directes y sont comparées. Aucun score de compatibilité n’est calculé.'
      : 'Choisissez votre métier ou confirmez des centres d’intérêt pour voir des pistes; le catalogue éditorial reste disponible séparément.', evidence };
}

export function compareDirections(possibilities: readonly CareerPossibility[], ids: readonly string[]): CareerPossibility[] {
  if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length) throw new RangeError('Choisissez deux ou trois directions distinctes.');
  return ids.map(id => { const found = possibilities.find(item => item.id === id); if (!found) throw new RangeError('Direction indisponible.'); return found; });
}
