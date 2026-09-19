// Synthetic learners. Each has a HIDDEN true level per target skill that the
// engine never sees; the engine only receives evidence rows produced by an
// explicit behaviour model. The oracle later scores results against the truth.
import { EVIDENCE_LADDER } from '../dist/index.js';
import { OCCUPATIONS, SIM_NOW } from './world.mjs';

const ARCHETYPES = [
  ['novice', 0.3], ['switcher', 0.35], ['near_ready', 0.2], ['qualified', 0.15],
];

function trueLevel(archetype, target, r) {
  switch (archetype) {
    case 'novice': return r.chance(0.8) ? 0 : 1;
    case 'switcher': return r.int(0, target);
    case 'near_ready': return target;
    case 'qualified': return Math.min(4, target + r.int(0, 1));
    default: throw new Error(archetype);
  }
}

function weighted(r, entries) {
  let roll = r();
  for (const [value, weight] of entries) if ((roll -= weight) < 0) return value;
  return entries.at(-1)[0];
}

export function learnerId(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

export function makeLearner(index, r, occupationId = r.pick(Object.keys(OCCUPATIONS))) {
  const archetype = weighted(r, ARCHETYPES);
  const truth = Object.fromEntries(OCCUPATIONS[occupationId].skills.map(([skillId, target]) => [skillId, trueLevel(archetype, target, r)]));
  if (archetype === 'near_ready') {
    // Exactly one real gap remains.
    const [skillId, target] = r.pick(OCCUPATIONS[occupationId].skills);
    truth[skillId] = Math.max(0, target - 1);
  }
  const budget = r.pick([0, 500, 3000, undefined]);
  return {
    index, occupationId, archetype, truth,
    context: {
      learnerId: learnerId(index), segment: 'default',
      constraints: {
        ...(budget === undefined ? {} : { budgetMad: budget, budgetFlexibility: 'mandatory' }),
        languages: r.pick([['fr'], ['fr'], ['fr', 'en'], ['ar']]), languageFlexibility: 'mandatory',
        hoursPerWeek: r.pick([3, 6, 10]),
      },
    },
  };
}

/**
 * How a learner's knowledge turns into evidence rows.
 *  assessed        exact levels, validated (upper bound on evidence quality)
 *  honest          exact self-declarations
 *  overconfident   self-declares one level too high 60% of the time
 *  underconfident  self-declares one level too low 60% of the time
 *  skips           honest, but leaves each skill blank 25% of the time
 *  cv              a CV reader finds each skill with probability `recall`; the
 *                  learner confirms found skills (level inferred with noise)
 *                  and fills in each remaining skill only half the time
 *  cv_unconfirmed  CV hints only, never confirmed by the learner
 */
export function evidenceFor(learner, behaviour, r, { recall = 0.3 } = {}) {
  const rows = [];
  const add = (skillId, level, evidenceType, how) => {
    // L0 is only representable as an explicit self-declaration.
    const type = level === 0 ? 'self_declared' : evidenceType;
    rows.push({
      id: `sim-${learner.index}-${rows.length + 1}`, learnerId: learner.context.learnerId, skillId,
      level, evidenceType: type, confidence: EVIDENCE_LADDER[type].confidence,
      observedAt: new Date(SIM_NOW.getTime() - 86_400_000), supersededBy: null,
      provenance: { source: 'simulation', behaviour, how },
    });
  };
  for (const [skillId, level] of Object.entries(learner.truth)) {
    switch (behaviour) {
      case 'assessed': add(skillId, level, 'human_validated', 'exact'); break;
      case 'honest': add(skillId, level, 'self_declared', 'exact'); break;
      case 'overconfident': add(skillId, r.chance(0.6) ? Math.min(4, level + 1) : level, 'self_declared', 'biased_up'); break;
      case 'underconfident': add(skillId, r.chance(0.6) ? Math.max(0, level - 1) : level, 'self_declared', 'biased_down'); break;
      case 'skips': if (!r.chance(0.25)) add(skillId, level, 'self_declared', 'exact'); break;
      case 'cv':
        if (r.chance(recall)) {
          const inferred = r.chance(0.3) ? Math.max(0, Math.min(4, level + r.pick([-1, 1]))) : level;
          add(skillId, inferred, 'cv_extracted_confirmed', 'cv_found');
        } else if (r.chance(0.5)) add(skillId, level, 'self_declared', 'filled_in');
        break;
      case 'cv_unconfirmed':
        if (r.chance(recall) && level > 0) add(skillId, level, 'cv_extracted_unconfirmed', 'cv_found');
        break;
      default: throw new Error(`Unknown behaviour: ${behaviour}`);
    }
  }
  return rows;
}
