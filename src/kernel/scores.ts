import type { EvidenceConfidence, MasteryLevel } from './evidence.js';

declare const masteryScoreBrand: unique symbol;
declare const priorityScoreBrand: unique symbol;

export type MasteryScore = number & {
  readonly [masteryScoreBrand]: 'MasteryScore';
};

export type PriorityScore = number & {
  readonly [priorityScoreBrand]: 'PriorityScore';
};

export type MasteryDisplay = Readonly<{ label: string }>;
export type PriorityDisplay = Readonly<{ label: string }>;

const CONFIDENCE_LABELS_FR: Readonly<Record<EvidenceConfidence, string>> =
  Object.freeze({
    very_low: 'très faible',
    low: 'faible',
    medium_low: 'faible à moyenne',
    medium: 'moyenne',
    medium_high: 'moyenne à élevée',
    high: 'élevée',
  });

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

export function createMasteryDisplay(
  level: MasteryLevel,
  confidence: EvidenceConfidence,
): MasteryDisplay {
  return Object.freeze({
    label: `${level} estimé — confiance ${CONFIDENCE_LABELS_FR[confidence]}`,
  });
}

export const MasteryScore = Object.freeze({
  from(value: number): MasteryScore {
    assertFinite(value, 'Mastery score');
    return value as MasteryScore;
  },

  toDisplay(
    _score: MasteryScore,
    level: MasteryLevel,
    confidence: EvidenceConfidence,
  ): MasteryDisplay {
    return createMasteryDisplay(level, confidence);
  },
});

export const PriorityScore = Object.freeze({
  from(value: number): PriorityScore {
    assertFinite(value, 'Priority score');
    if (value < 0 || value > 100) {
      throw new RangeError('Priority score must be between 0 and 100');
    }
    return value as PriorityScore;
  },

  toDisplay(score: PriorityScore): PriorityDisplay {
    if (score >= 75) return Object.freeze({ label: 'Correspondance forte' });
    if (score >= 50) return Object.freeze({ label: 'Correspondance utile' });
    if (score >= 25) return Object.freeze({ label: 'Correspondance complémentaire' });
    return Object.freeze({ label: 'Option exploratoire' });
  },
});
