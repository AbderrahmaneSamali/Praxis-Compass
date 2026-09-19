// Simulated world for offline engine evaluation. Everything here is SYNTHETIC
// except the three OpenClassrooms records, copied verbatim from the PRE-PRAXIS
// pilot catalog (config/pilot-catalog, checked 2026-09-06) and kept as drafts.
// Nothing in this file is a claim about real providers, prices or outcomes.

export const SIM_NOW = new Date('2026-09-19T12:00:00Z');

/** Deterministic PRNG (mulberry32) so every run is replayable from its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return next;
}

/** Mirrors the active praxis-rank-reliable-v4 weights row (unchanged since migration 021). */
export const WEIGHTS = {
  gap_coverage: 0.28, precision: 0.18, level_fit: 0.14, evidence_confidence: 0.10,
  constraint_fit: 0.10, outcome_prior: 0.05, scarcity: 0.08, freshness: 0.07, redundancy_penalty: 0.12,
  outcome_prior_estimator: {
    alpha: 25, minimum_trials: { item: 20, product_family_sector: 50, sector: 100, global: 200 },
    neutral_prior: 0.5, featured_prior: 0.7, rank_decay: 0.03,
  },
};

// Skill ids starting with `skill_` are the ones used by the real pilot catalog.
export const SKILLS = {
  skill_prepare_data: 'Préparer les données',
  skill_build_dashboard: 'Construire un tableau de bord',
  skill_model_data: 'Modéliser les données',
  sim_sql: 'SIM — Requêtes SQL',
  sim_statistics: 'SIM — Statistiques descriptives',
  skill_plan_delivery: 'Planifier la livraison',
  skill_plan_work_packages: 'Planifier des lots de travaux',
  sim_stakeholder_comms: 'SIM — Communication avec les parties prenantes',
  sim_budget_tracking: 'SIM — Suivi budgétaire',
};

export const OCCUPATIONS = {
  'sim-data-analyst': {
    label: 'SIM — Analyste de données',
    skills: [
      ['skill_prepare_data', 2, 1], ['skill_build_dashboard', 2, 1], ['sim_sql', 2, 1],
      ['skill_model_data', 1, 0.7], ['sim_statistics', 1, 0.7],
    ],
  },
  'sim-project-coordinator': {
    label: 'SIM — Coordinateur·rice de projet',
    skills: [
      ['skill_plan_delivery', 2, 1], ['skill_plan_work_packages', 2, 1],
      ['sim_stakeholder_comms', 2, 0.8], ['sim_budget_tracking', 1, 0.6],
    ],
  },
};

export function targetProfile(occupationId) {
  const occupation = OCCUPATIONS[occupationId];
  if (!occupation) throw new Error(`Unknown simulated occupation: ${occupationId}`);
  return {
    occupationId, label: occupation.label, source: 'authored',
    skills: occupation.skills.map(([skillId, targetLevel, importance]) => ({
      skillId, label: SKILLS[skillId], targetLevel, importance, reviewed: true, targetLevelBasis: 'simulation',
    })),
  };
}

const NO_EVIDENCE = { successes: 0, trials: 0 };

export function course(id, outcomes, extra = {}) {
  return {
    id, recordType: 'course', slug: id, title: `SIM — ${id}`, summary: '', status: 'published',
    productFamily: null, sectorCode: 'digital_it_telecom', featured: false, coldStartRank: null,
    coldStartSourceVersion: null, priceMad: 0, durationHours: 10, languages: ['fr'],
    format: 'online_self_paced', nextSessionAt: null, nextEndAt: null, requiredWeeklyHours: null,
    providerId: 'sim-provider', providerName: 'SIM — organisme fictif', applicationUrl: 'https://simulation.example',
    contactRoute: null, deliveryFormat: 'online_self_paced', isOnline: true, locationCity: null, locationCountry: null,
    priceStatus: 'priced', admissionStatus: 'rolling_admission', actionableOffer: true, actionableMissing: [],
    dataSource: 'simulation', updatedAt: SIM_NOW, targetOccupationId: null, variant: null, popularity: 0,
    outcomePrior: 0.5,
    outcomePriorEvidence: { itemSegment: NO_EVIDENCE, productFamilySector: NO_EVIDENCE, sector: NO_EVIDENCE, global: NO_EVIDENCE },
    outcomes: outcomes.map(([skillId, entryLevel, outcomeLevel, weight = 1]) =>
      ({ skillId, entryLevel, outcomeLevel, weight, catalogFrequency: 1 })),
    steps: [], prerequisites: [], ...extra,
  };
}

/** The three real pilot courses, exactly as drafted: free, French, self-paced, levels 0→1 not yet reviewed. */
export function pilotCourses(status = 'draft') {
  const real = (id, title, url, hours, outcomes) => course(id, outcomes, {
    title, status, durationHours: hours, providerId: 'openclassrooms', providerName: 'OpenClassrooms',
    applicationUrl: url, dataSource: 'official_catalog',
  });
  return [
    real('oc-initiation-gestion-projet', 'Initiez-vous à la gestion de projet',
      'https://openclassrooms.com/fr/courses/8744811-initiez-vous-a-la-gestion-de-projet', 4,
      [['skill_plan_delivery', 0, 1, 1], ['skill_plan_work_packages', 0, 1, 0.7]]),
    real('oc-dashboards-power-bi', 'Réalisez des dashboards avec Power BI',
      'https://openclassrooms.com/fr/courses/7110891-realisez-des-dashboards-avec-power-bi', 8,
      [['skill_build_dashboard', 0, 1, 1], ['skill_prepare_data', 0, 1, 0.7]]),
    real('oc-modelisation-donnees', 'Modélisez vos bases de données',
      'https://openclassrooms.com/fr/courses/6938711-modelisez-vos-bases-de-donnees', 8,
      [['skill_model_data', 0, 1, 1]]),
  ];
}

/**
 * A synthetic catalog with deliberate traps: drafts, incomplete offers, other
 * languages, expensive and high-workload courses, and prerequisite chains.
 */
export function syntheticCatalog(seed = 1) {
  const r = rng(seed);
  const items = [];
  const prices = [0, 0, 300, 900, 2500, 6000];
  let n = 0;
  for (const skillId of Object.keys(SKILLS)) {
    for (const [entry, outcome] of [[0, 1], [1, 2], [2, 3]]) {
      for (let copy = 0; copy < 2; copy++) {
        const id = `sim-${String(++n).padStart(3, '0')}-${skillId.replace(/^(skill|sim)_/, '')}-l${outcome}`;
        items.push(course(id, [[skillId, entry, outcome, 1]], {
          priceMad: r.pick(prices),
          durationHours: r.pick([6, 12, 20, 40, 80]),
          languages: [r.pick(['fr', 'fr', 'fr', 'en', 'ar'])],
          requiredWeeklyHours: r.chance(0.3) ? r.pick([4, 8, 15]) : null,
          popularity: r.int(0, 500),
          status: r.chance(0.1) ? 'draft' : 'published',
          actionableOffer: !r.chance(0.08),
        }));
      }
    }
  }
  // Bundles that teach two skills of the same occupation.
  for (const [occupationId, occupation] of Object.entries(OCCUPATIONS)) {
    const ids = occupation.skills.map(([skillId]) => skillId);
    for (let i = 0; i + 1 < ids.length; i++) {
      items.push(course(`sim-bundle-${occupationId.slice(4)}-${i}`, [[ids[i], 1, 2, 1], [ids[i + 1], 1, 2, 0.7]], {
        priceMad: r.pick([900, 2500, 6000]), durationHours: 60, languages: ['fr'], popularity: r.int(100, 900),
        targetOccupationId: occupationId,
      }));
    }
  }
  // A course with a cross-skill prerequisite: dashboards need prepared data first.
  items.push(course('sim-advanced-dashboards', [['skill_build_dashboard', 1, 3, 1]], {
    priceMad: 900, durationHours: 30,
    prerequisites: [{ skillId: 'skill_prepare_data', label: SKILLS.skill_prepare_data, minimumLevel: 2 }],
  }));
  return items;
}
