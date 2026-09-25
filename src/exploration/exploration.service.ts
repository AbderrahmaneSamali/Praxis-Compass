import type { EvidenceProfile } from '../evidence/learner-evidence.js';
import { analyzeRequirements } from './skill-gap-analysis.js';
import { startingActions } from './development-actions.js';
import type { CareerPossibility, ExplorationResult, RoleDirection, StartingProfile } from './exploration.types.js';

export function exploreDirections(profile: StartingProfile, directions: readonly RoleDirection[], evidence: EvidenceProfile,
  savedIds: readonly string[] = []): ExplorationResult {
  const saved = new Set(savedIds);
  const possibilities: CareerPossibility[] = directions.filter(direction =>
    direction.kind !== 'current_role_growth' || direction.roleId === profile.currentRoleId).map(direction => {
    const requirements = analyzeRequirements(direction.requirements, evidence);
    const transferableSkills = requirements.filter(item => item.state === 'supported');
    const matchedInterests = direction.interestTags.filter(tag => profile.interests.toLocaleLowerCase('fr').includes(tag.toLocaleLowerCase('fr')));
    const mentionedExperience = direction.interestTags.filter(tag => profile.experience.toLocaleLowerCase('fr').includes(tag.toLocaleLowerCase('fr')));
    const reasons = [
      ...matchedInterests.map(tag => `Votre intérêt pour « ${tag} » rejoint cette direction.`),
      ...mentionedExperience.filter(tag => !matchedInterests.includes(tag)).map(tag => `Vous mentionnez « ${tag} » dans votre expérience; cela mérite d’être exploré, sans établir un niveau de compétence.`),
      ...transferableSkills.slice(0, 2).map(item => `Votre niveau ${item.observedLevel} en « ${item.label} » répond au niveau indiqué; source : ${item.evidenceType === 'self_declared' ? 'déclaration personnelle' : 'preuve enregistrée'}.`),
      ...(profile.currentRoleId === direction.roleId ? ['Cette piste développe votre métier actuel.'] : []),
    ];
    if (!reasons.length) reasons.push('Cette piste fait partie du petit catalogue de démonstration. Explorez ses responsabilités et précisez votre profil pour juger si elle vous convient.');
    const uncertainties = requirements.filter(item => item.state === 'unknown' || item.disagreementResolution)
      .slice(0, 4).map(item => `${item.label} : ${item.disagreementResolution ? 'preuves divergentes' : 'niveau non connu'}.`);
    return { id: direction.id, kind: direction.kind, title: direction.title, description: direction.description,
      responsibilities: direction.responsibilities, reasonsToExplore: reasons, transferableSkills,
      requirements, startingActions: startingActions(direction, requirements), uncertainties,
      sources: direction.sources, saved: saved.has(direction.id) };
  });
  const questions = [
    ...(!profile.currentRoleId ? ['Quel métier exercez-vous actuellement ? Cela aide à distinguer une évolution de poste d’une transition.'] : []),
    ...(!profile.experience ? ['Quelle tâche avez-vous déjà réalisée au travail ou dans un projet ? Un exemple peut éclairer vos compétences transférables.'] : []),
    ...(!profile.interests ? ['Quelles activités vous intéressent ? Cela aide à choisir les pistes à approfondir.'] : []),
  ];
  if (!questions.length) {
    const firstUnknown = possibilities.flatMap(item => item.requirements).find(item => item.state === 'unknown');
    if (firstUnknown) questions.push(`Avez-vous déjà pratiqué « ${firstUnknown.label} » ? Cette réponse clarifierait une exigence de métier.`);
  }
  return { possibilities, questions: questions.slice(0, 3),
    coverageNote: 'Catalogue de démonstration limité à quelques métiers et exigences éditoriales; faites vérifier les responsabilités et niveaux avant une décision professionnelle.', evidence };
}

export function compareDirections(possibilities: readonly CareerPossibility[], ids: readonly string[]): CareerPossibility[] {
  if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length) throw new RangeError('Choisissez deux ou trois directions distinctes.');
  return ids.map(id => { const found = possibilities.find(item => item.id === id); if (!found) throw new RangeError('Direction indisponible.'); return found; });
}
