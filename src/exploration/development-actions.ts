import type { DevelopmentAction, RequirementAnalysis, RoleDirection } from './exploration.types.js';

export function startingActions(direction: RoleDirection, requirements: readonly RequirementAnalysis[]): DevelopmentAction[] {
  const unknown = requirements.find(item => item.state === 'conflicting' || item.state === 'unknown');
  const gap = requirements.find(item => item.state === 'development_needed');
  const focus = gap ?? unknown ?? requirements[0];
  if (!focus) return [];
  const actions: DevelopmentAction[] = [];
  if (unknown) actions.push({ id: `${direction.id}:check:${unknown.skillId}`, directionId: direction.id,
    kind: 'evidence_check', title: `Clarifier : ${unknown.label}`,
    purpose: `Vérifier votre point de départ pour ${unknown.label}.`, addresses: [unknown.skillId],
    instructions: 'Décrivez une situation précise où vous avez utilisé cette compétence, ou essayez une petite tâche représentative. Notez ce que vous avez fait seul et avec aide.',
    output: 'Un exemple daté et un niveau que vous pourrez déclarer ou faire valider.',
    prerequisites: 'Aucun. Vous pouvez aussi répondre que vous ne savez pas encore.',
    completionCriteria: 'Vous pouvez expliquer ce que vous avez essayé et ce qui reste incertain.',
    unlocks: 'Une comparaison plus précise; cette action ne valide pas automatiquement un niveau.' });
  actions.push({ id: `${direction.id}:practice:${focus.skillId}`, directionId: direction.id,
    kind: 'project', title: `Essayer : ${focus.label}`,
    purpose: `Découvrir une responsabilité liée à ${direction.title}.`, addresses: [focus.skillId],
    instructions: `Réalisez une petite étude ou un exemple de travail qui mobilise « ${focus.label} ». Décrivez votre méthode, vos choix et une difficulté rencontrée.`,
    output: 'Une page de synthèse ou un petit livrable montrable.', prerequisites: 'Un exemple de situation ou de données accessibles, sans information confidentielle.',
    completionCriteria: 'Le livrable montre votre démarche et une amélioration possible.',
    unlocks: 'Une conversation de retour avec un professionnel ou une pratique plus approfondie.' });
  actions.push({ id: `${direction.id}:conversation`, directionId: direction.id, kind: 'conversation',
    title: 'Parler avec une personne du métier', purpose: 'Vérifier les responsabilités et vos intérêts avant de vous engager.',
    addresses: [direction.roleId], instructions: `Demandez à une personne exerçant « ${direction.title} » quelles tâches occupent sa semaine, quelles compétences comptent et ce qui surprend les débutants.`,
    output: 'Trois enseignements et une question encore ouverte.', prerequisites: 'Un contact professionnel ou une communauté métier.',
    completionCriteria: 'Vous pouvez nommer une responsabilité qui vous attire et une qui vous interroge.', unlocks: 'Choisir un projet ou une question de compétence plus ciblé.' });
  return actions;
}
