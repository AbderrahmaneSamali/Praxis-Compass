# Learner simulation (synthetic)

`npm run simulate` sends synthetic learners through the real engine pipeline:
evidence rows → `buildEvidenceProfile` → target gaps → ranking → learning plans.
It then grades each result against the learner's **hidden true skill levels**,
which the engine never sees. Output: `simulation/out/report.md` and `report.json` (not committed).
Options: `node simulation/run.mjs --learners 400 --seed 7`.

**What this is not.** The learners, the catalog (`SIM —` records) and the behaviour models are
assumptions. The results test engine logic under those assumptions. They say nothing about
real learners, real courses or real outcomes. The three OpenClassrooms records are the real
pilot drafts; the `pilot-only:published` scenario is a what-if, not a publication.

## Files

- `world.mjs`: seeded PRNG, two simulated occupations, a synthetic catalog containing drafts, incomplete offers, other languages, costly and high-workload courses, and prerequisites. Also includes the three pilot courses.
- `learners.mjs`: four archetypes of hidden truth (novice, switcher, near-ready, qualified), random constraints, and the evidence behaviour models (`assessed`, `honest`, `overconfident`, `underconfident`, `skips`, `cv`, `cv_unconfirmed`).
- `oracle.mjs`: grading written independently of the engine: hard-constraint breaches, whether a course is useful and ready at the learner's true levels, reachable gaps, and a replay of plans from the true levels. `tests/simulation.test.mjs` checks the grading itself.

## Columns

| Column | Meaning |
|---|---|
| Served | Learners who got a recommendation or plan, among those for whom some eligible course could truly help |
| Asked for more info | `insufficient_profile`: the engine withheld advice because a target skill had no usable evidence |
| Told "done" wrongly | `goal_satisfied` while real gaps remained |
| Useful @5 | Top-5 courses that raise a skill the learner truly lacks |
| Ready @5 | Top-5 courses the learner can truly start (entry level and prerequisites) |
| Gap recall @5 | Reachable true gaps covered by a useful and ready top-5 course |
| Plan closes gaps | Share of true gaps the best plan closes when replayed from the true levels |
| Random / Popular @5 | Useful @5 for naive picks from the same eligible pool |

With `assessed` or `honest` evidence, the engine sees the truth, so 100% useful is a
correctness check, not a quality claim. The informative rows are the ones where the
evidence is wrong or incomplete.

## Findings at seed 20260919, 300 learners per scenario

1. **A single blank skill blocks all advice.** With `skips` (each skill left blank 25% of the time), 70% of learners get nothing. The engine is right not to assume zero, but it withholds everything.
2. **CV recall matters through that same gate.** At the pilot's measured recall (~0.2–0.3), only 8–15% of learners reach any advice, even when they fill in half of the missed skills. At 0.9 recall, 75% do. Unconfirmed CV hints alone serve nobody, by design.
3. **Overconfidence is the most harmful evidence error.** 16% of overconfident learners are told they are done while real gaps remain, and only 39% of the courses shown to them are ones they can actually start. Underconfidence mostly wastes their time: 53% useful.
4. **What-if, partial advice:** ranking against the answered skills lifts "served" from 15% to 79% at recall 0.3. But it produces 9% wrong "done" results, because unanswered skills drop out of view. If adopted, it needs its own status ("partial: tell us about X") rather than `goal_satisfied`.
5. **The three real courses reach nobody while they are drafts.** If published, they serve every learner in this model, but their best plans close only 17% of true gaps, because they stop at level 1.
6. **No hard-constraint or publication breaches in any scenario.**
