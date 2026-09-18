# Evidence-backed recommendations and assessment handoff

This first research implementation connects existing evidence/session tables to the standalone engine. It supplies assessment requests to a host application; it does not add a learner screen, start a session, generate questions, implement assessment scoring or publish items.

## Server integration

Use an authenticated learner ID from the host application, never an arbitrary browser-supplied identity. The standalone repository does not enforce tenant/user authorization. Apply the project's existing migrations through 050 before using these APIs; no additional migration is needed.

```ts
const result = await engine.ranker.recommendFromEvidence(
  { learnerId: authenticatedLearnerId, constraints: { hoursPerWeek: 8, budgetMad: 2000 } },
  occupationId,
  { explorationProbability: 0 },
  'fr',
);
```

The context must exclude caller-supplied skill levels, prerequisite levels and target profiles. `skillEvidence()` reads `praxis.skill_evidence` and joins referenced assessment sessions by session ID, learner and skill. `buildEvidenceProfile()` is also exported for trusted server-side data and offline fixtures. Its assessment proof argument is not a safe input boundary for browser or model output.

The adapter retains provenance and selects by capped evidence confidence, then observation recency. This is a transparent policy heuristic, not calibrated mastery probability or a learned model. Unconfirmed CV extraction, superseded evidence and future observations are ignored. Optional `evidenceMaxAgeDays` applies one explicit freshness limit; no default age is invented. Multiple equally authoritative observations at exactly the same time with contradictory levels remain unknown. Other disagreements remain visible in diagnostics even when precedence selects one level.

Quiz evidence requires a completed production session with coverage achieved, reconciled tested evidence, matching final level and completion no later than observation. Pilot, incomplete, conflict and declared-only sessions cannot prove quiz mastery. `quiz_plus_practical` is capped at medium because this implementation verifies only its quiz component. Stronger practical evidence needs its own validation workflow. Sessions currently support L1–L3; L4 is never offered as a quiz result.

`recommendForTarget()` remains available for trusted caller-supplied levels and now returns the same handoff. When any target skill level is unknown, its existing `insufficient_profile` behavior is preserved. Missing levels are never assigned zero. All selected known levels remain available for prerequisite checks when a complete target profile can be scored.

## Route the handoff

`result.assessmentHandoff` is non-null for target-derived recommendations. Requests are ordered by number of relevant courses blocked by unknown prerequisites, then target importance, then skill ID. Only published, actionable courses that satisfy other hard constraints contribute to that count. The count covers prerequisite blockage, not hypothetical recommendation benefit, and the priority is a heuristic rather than an information-gain estimate.

The host application can route requests as follows:

| action | Learner's next step |
|---|---|
| `confirm_level` | Declare a level using the skill rubric, or submit supporting evidence through the host's evidence workflow. |
| `take_assessment` | Open the host's production assessment flow for the returned blueprint. Recheck bank availability at session start. |
| `resolve_evidence` | Review the conflicting evidence before treating a level as known. |
| `provide_practical_evidence` | Supply an appropriate work sample or human validation for an L4 requirement. |

An assessment is offered only in the requested locale, for the required level, when every non-zero blueprint cell has sufficient currently published, calibrated items. The blueprint must be reviewed/published; item calibration parameters and latest dated review approval are rechecked. A pilot or incomplete bank returns `confirm_level`, never a fictional quiz. Existing locale support for target profiles is French and English; Arabic/mixed-language CV evaluation is separate.

Ordinary `recommend()` results expose `assessmentHandoff: null` and `evidenceProfile: null`, because the engine cannot infer a role target or persisted evidence from that lower-level API alone. The ranker and its hard eligibility rules are unchanged.

## Record and verify

After the host actually displays the result, optionally call `recordImpression(result, surface)`. Replay snapshots now include the exact evidence selection and handoff. Mutated handoffs or evidence profiles are rejected at this write boundary. Evidence provenance is sensitive: access and retention controls should match the host's existing learner-evidence policy. Do not pass raw CV text into provenance when a source reference suffices.

```powershell
npm run typecheck
npm test
# Requires an EMPTY dedicated database with a name ending in _test:
npm run test:db
```

The database test rolls back fixture DDL/data and refuses an existing praxis schema. It covers complete/incomplete banks, wrong languages, calibration changes, latest rejection, session joins and evidence-backed handoffs. Unit tests run without PostgreSQL. See `evaluation/cv-skills/README.md` for the separate French/Arabic CV annotation and benchmark workflow.
