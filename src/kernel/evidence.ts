export type MasteryLevel = 'L1' | 'L2' | 'L3' | 'L4';

export type EvidenceType =
  | 'cv_extracted_unconfirmed'
  | 'cv_extracted_confirmed'
  | 'cv_experience_inferred'
  | 'self_declared'
  | 'quiz_sufficient_coverage'
  | 'quiz_plus_practical'
  | 'human_validated';

export type EvidenceConfidence =
  | 'very_low'
  | 'low'
  | 'medium_low'
  | 'medium'
  | 'medium_high'
  | 'high';

export type MasteryLevelDefinition = Readonly<{
  descriptorFr: string;
  suitedEvidenceFr: string;
}>;

export const MASTERY_LEVELS: Readonly<
  Record<MasteryLevel, MasteryLevelDefinition>
> = Object.freeze({
  L1: Object.freeze({
    descriptorFr:
      'Découverte — Comprend le vocabulaire et exécute avec guidage.',
    suitedEvidenceFr: 'Connaissance, reconnaissance, procédure simple',
  }),
  L2: Object.freeze({
    descriptorFr:
      'Application — Réalise une tâche standard de manière autonome.',
    suitedEvidenceFr: "Scénario standard, choix d'outil, calcul ou séquence",
  }),
  L3: Object.freeze({
    descriptorFr:
      'Maîtrise — Résout des situations variées, justifie et améliore.',
    suitedEvidenceFr: 'Cas contextuel, arbitrage, diagnostic',
  }),
  L4: Object.freeze({
    descriptorFr:
      'Expertise / transmission — Traite les cas complexes, conçoit, supervise et transmet.',
    suitedEvidenceFr: 'Cas complexe, livrable, portfolio, validation humaine',
  }),
});

export type EvidenceLadderEntry = Readonly<{
  confidence: EvidenceConfidence;
  displayLabelFr: string;
  usableAlone: boolean;
}>;

export const EVIDENCE_LADDER: Readonly<
  Record<EvidenceType, EvidenceLadderEntry>
> = Object.freeze({
  cv_extracted_unconfirmed: Object.freeze({
    confidence: 'very_low',
    displayLabelFr: 'Indice issu du CV',
    usableAlone: false,
  }),
  cv_extracted_confirmed: Object.freeze({
    confidence: 'low',
    displayLabelFr: 'Information déclarée et confirmée',
    usableAlone: true,
  }),
  cv_experience_inferred: Object.freeze({
    confidence: 'medium_low',
    displayLabelFr: 'Niveau inféré de l’expérience CV',
    usableAlone: true,
  }),
  self_declared: Object.freeze({
    confidence: 'low',
    displayLabelFr: 'Niveau déclaré',
    usableAlone: true,
  }),
  quiz_sufficient_coverage: Object.freeze({
    confidence: 'medium',
    displayLabelFr: 'Niveau estimé par test',
    usableAlone: true,
  }),
  quiz_plus_practical: Object.freeze({
    confidence: 'medium_high',
    displayLabelFr: 'Niveau évalué',
    usableAlone: true,
  }),
  human_validated: Object.freeze({
    confidence: 'high',
    displayLabelFr: 'Niveau validé / preuve externe',
    usableAlone: true,
  }),
});

const EVIDENCE_CONFIDENCE_SCALE = Object.freeze<EvidenceConfidence[]>([
  'very_low',
  'low',
  'medium_low',
  'medium',
  'medium_high',
  'high',
]);

export function downgradeEvidenceConfidence(
  confidence: EvidenceConfidence,
  steps = 1,
): EvidenceConfidence {
  if (!Number.isInteger(steps) || steps < 0) {
    throw new RangeError(
      'Confidence downgrade steps must be a non-negative integer',
    );
  }
  const currentIndex = EVIDENCE_CONFIDENCE_SCALE.indexOf(confidence);
  return (
    EVIDENCE_CONFIDENCE_SCALE[Math.max(0, currentIndex - steps)] ?? 'very_low'
  );
}

export const downgrade = downgradeEvidenceConfidence;
