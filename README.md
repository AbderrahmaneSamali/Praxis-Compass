# PRAXIS Standalone Recommendation Engine & Career Compass

A clean, self-contained extraction of the PRAXIS core:
1. **Career Compass:** Discovers next career horizons, mobility paths, shared skill capital, and bridge skill requirements across 3,046 ESCO occupations.
2. **Recommendation Engine:** 9-dimensional multi-objective linear ranking model with Bayesian empirical Bayes shrinkage and cryptographic provenance.
3. **Database Substrate:** PostgreSQL migrations (`001` through `050`) and automated migration runner.

---

## Folder Structure

```
praxis-engine-standalone/
├── README.md                           # This documentation
├── package.json                        # Dependencies (pg, dotenv, tsx, typescript)
├── tsconfig.json                       # TypeScript compiler options
├── docker-compose.db.yml               # Standalone PostgreSQL 17 container
├── .env.example                        # Database configuration template
│
├── database/                           # Database migrations & tools
│   ├── migrations/                     # Migrations (001 to 051)
│   ├── rollbacks/                      # Paired down-migrations (never run by the runner)
│   └── migrate.ts                      # Standalone migration runner (checksum-pinned)
│
├── src/
│   ├── kernel/                         # Foundational types & provenance
│   │   ├── algorithm-versions.ts       # Central version registry
│   │   ├── computation-provenance.ts   # SHA-256 inputs hashing & provenance wrapper
│   │   ├── evidence.ts                 # Evidence ladder (self-declared to certified)
│   │   └── scores.ts                   # Branded MasteryScore and PriorityScore types
│   │
│   ├── engine/                         # Recommendation & Scoring
│   │   ├── recommendation-engine.ts    # 9-feature scoring, priors, diversity rerank
│   │   ├── recommendation.types.ts     # Data structures
│   │   ├── learning-path-planner.ts    # Prerequisite-aware pathway search
│   │   └── recommendation.repository.ts# Lean PostgreSQL query adapter
│   │
│   ├── compass/                        # Career Compass & Trajectory
│   │   ├── career-compass.service.ts   # ESCO essential skill overlap & mobility query
│   │   └── career-compass.types.ts     # Destination, shared skills, bridge skills
│   │
│   └── index.ts                        # Main library export
│
└── examples/
    └── demo-run.ts                     # Executable CLI to query Compass & Ranker
```

---

## Quickstart

### 1. Install dependencies
```bash
cd praxis-engine-standalone
npm install
```

### 2. Configure Database
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

If you don't already have Postgres running, launch the standalone container:
```bash
npm run db:up
npm run migrate
```

### 3. Run the Interactive Demo
Test the Career Compass and Recommendation Engine directly in your terminal:
```bash
npm run demo
```
Or test with any occupation query:
```bash
npx tsx examples/demo-run.ts "scientifique des données"
npx tsx examples/demo-run.ts "statisticien"
npx tsx examples/demo-run.ts "gestionnaire de projet"
```

---

## Programmatic Usage in Any Project (Next.js, Express, FastAPI, etc.)

```typescript
import { PraxisEngine } from '@praxis/engine-standalone';

const engine = new PraxisEngine({
  connectionString: process.env.DATABASE_URL,
});

// 1. Explore Career Horizons from a job:
const compass = await engine.compass.explore('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2', 'fr');

for (const dest of compass.destinations) {
  console.log(`${dest.label}: ${dest.bridgePercentage}% weighted target coverage`);
  console.log(`${dest.shared}/${dest.totalSkills} shared taxonomy skills (${dest.rawOverlapPercentage}% raw overlap)`);
  console.log(`Bridge skills to develop: ${dest.bridgeSkills.map(s => s.label).join(', ')}`);
}

// 2. Run the 9-Feature Course Ranker:
const results = await engine.ranker.recommendForTarget(learnerState, targetOccupationId);
console.log(`Ranked ${results.recommendations.length} courses with cryptographic provenance.`);
console.log(results.status, results.missingSkillIds, results.learningPlans.status);

await engine.close();
```

---

## The 9 Recommendation Features

Every candidate course is scored using 9 normalized $[0, 1]$ features:

1. **`gap_coverage`**: Weighted fraction of learner's skill gaps closed by this course.
2. **`precision`**: Penalizes bloated courses that teach 30 irrelevant skills to cover 1 gap.
3. **`level_fit`**: Matches course entry level against learner's evidenced current level.
4. **`evidence_confidence`**: Weights candidate by reliability of learner's evidence ladder.
5. **`constraint_fit`**: Evaluates budget, weekly workload, delivery format, language, and city.
6. **`outcome_prior`**: Bayesian empirical Bayes shrinkage on completion and satisfaction rates.
7. **`scarcity`**: Rewards rare, hard-to-find skill coverage.
8. **`freshness`**: Exponential decay based on upcoming start date.
9. **`redundancy_penalty`**: Penalizes material the learner has already mastered.

## Reliability changes and API contracts

Apply migration `050_recommendation_reliability.sql` with `npm run migrate` when upgrading. Historical migrations are unchanged. The new migration preserves the numerical weights, activates `praxis-rank-reliable-v4`, and adds full input snapshots to immutable impressions. Build with `npm run build` before consuming `dist`. To roll back 050, follow [`database/rollbacks/050_recommendation_reliability.down.sql`](database/rollbacks/050_recommendation_reliability.down.sql).

`recommendForTarget(learnerState, occupationId, options?, locale?)` derives the complete target profile and reconstructs its gaps from supplied skill levels. Missing target skills return `insufficient_profile` and `missingSkillIds`; absence of evidence is never treated as demonstrated level zero. A prerequisite declaration supplies a level with `very_low` confidence unless an existing skill record supplies its confidence. Derived ESCO levels remain disclosed application defaults; authored levels are marked reviewed.

`recommend(learnerState, occupationId, options?)` is the lower-level API for a caller that has already assembled target gaps. Set `learnerState.targetOccupationId` to bind those gaps; a different requested target is rejected. Unbound legacy states remain accepted and are labelled `targetStateSource: 'caller_supplied'`. Use `recommendForTarget` for role selection changes.

Results distinguish `ok`, `plan_available`, `insufficient_profile`, `goal_satisfied`, and `no_eligible_courses`. Direct recommendations must advance an evidenced target gap. `relatedRecommendations` contains separately labelled taxonomy/pathway suggestions; their adjacency does not establish goal progress or prerequisite readiness. Candidate generation scores items before the cap and gives direct progress precedence over related suggestions. Catalog frequency counts distinct published items in the chosen reviewed or bypass catalog scope.

Results include `learningPlans`, `exclusions`, `droppedItemIds`, one `scoringAt`, `isExploration`, `explorationProbability`, `algorithmVersion`, `inputSnapshot`, and `inputsHash`. Exploration shuffles only the selected top ten; it is an ordering experiment, not exploration of unseen catalog items. `zeroCandidates` refers to an empty direct recommendation list; plans or related options may still exist.

`engine.planner.plan(learnerState, occupationId, options?)` assembles catalog inputs for the planner. A useful one-course solution is represented. Partial plans continue through further courses until the target is complete or a bound is reached. Each plan exposes `complete`; the result exposes `status`, `searchTruncated`, `limits`, `missingPrerequisites`, and `blockingConstraints`. Rejection counts in `blockingConstraints` describe encountered conditions, not proof that a condition prevents every possible solution. Search remains approximate: default depth 4, candidate cap 200, beam width 64. Prerequisites are traced backward independently of item input order, and zero-weight outcomes do not confer skills.

The default catalog remains `reviewed_online_offers`. `allowAllPublishedOffers: true` explicitly bypasses review but still requires published, actionable offers and hard learner eligibility. Its result carries `reviewBypassed: true`. The demo enables this bypass for examples; production callers should use the default reviewed catalog.

Compass ranks and limits all candidate occupations using smoothed inverse-frequency-weighted destination coverage. `similarityScore` is the unrounded ranking value; `bridgePercentage` is its rounded percentage. `rawOverlapPercentage` retains the simple shared/total ratio. This changes the meaning of `bridgePercentage` from the earlier raw overlap. The result declares `metric: 'idf_weighted_destination_coverage'` and `evidenceBasis: 'occupation_taxonomy'`. Shared occupation requirements are not evidence that an individual holds those skills. Locale-aware labels and concept-URI inputs are supported.

## Recording displayed results

Recommendation and planning calls are read-only. Record the result after it is actually displayed, rather than logging every preview:

```typescript
const result = await engine.ranker.recommendForTarget(learnerState, targetOccupationId);
// Render result, including its insufficient-profile status when appropriate.
await engine.ranker.recordImpression(result, 'career_report', false);
```

The learner and target occupation must exist in the database, and migration 050 must be applied. The write is transactional: impression header, actual direct recommendation ranks, features, reasons, prior provenance, learning plans and replay snapshot are stored together. Related cards are captured in the full snapshot. `isExample: true` identifies demonstration impressions; example-source outcomes and fixture catalog outcomes are excluded from ranking priors. Snapshot integrity is verified before writing; failures roll back. Recording the same request twice raises the existing immutable-record uniqueness error. Keep the returned `requestId` to associate later feedback/outcomes with the source impression. The caller remains responsible for its feedback/outcome collection flow and scheduled health aggregation.

## Validation

```bash
npm run typecheck
npm test
```

Type checking includes source, examples and the migration runner. Tests exercise complete and partial plans, prerequisites, cycles, cumulative constraints, candidate recall, target changes, evidence gaps, publication filtering, numerical validation, exploration, snapshot integrity and transactional recording. No new runtime dependencies are required.

For real PostgreSQL query verification, create an **empty dedicated database whose name ends in `_test`**, set `PRAXIS_TEST_DATABASE_URL`, and run `npm run test:db`. The fixture test executes actual catalog/target/Compass/neighbour SQL, migration 050, and impression inserts. It refuses a database with an existing `praxis` schema and rolls back its fixture DDL/data. It does not replace validation of the full migration chain against a deployment database.
# Research implementation: evidence and assessment

The engine now supports `ranker.recommendFromEvidence()` and returns an assessment handoff from target-derived recommendations. See [the integration guide](docs/evidence-and-assessment.md) for evidence precedence, assessment availability and host application routing. The [CV evaluation guide](evaluation/cv-skills/README.md) provides French/Arabic extraction and linking evaluation; its included examples are synthetic.

## Learner application and measured real-CV pilot

The [learner screen guide](docs/learner-screen.md) covers starting the local French application with PostgreSQL, all 51 migrations, a guarded dedicated preview bootstrap and fictional course seed, and `npm run test:learner`. The screen stores declarations and preferences, separates unknown from explicitly declared zero, and displays target-based recommendations and projected plans. Run `npm run learner` with `DATABASE_URL` set to a migrated database.

The original synthetic evaluation examples remain examples. The [real local CV pilot](evaluation/cv-skills/pilot/README.md) now contains seven deidentified real CV skill-section excerpts, 92 provisional annotations, subject-separated development/test splits and a frozen official ESCO catalog. Run `npm run cv:benchmark` to regenerate both dictionary baselines and their measured results. This small pilot does not establish full-CV or Arabic performance and its annotations await independent human adjudication.
