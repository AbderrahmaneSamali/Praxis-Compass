# Career journey evaluation

This benchmark runs fictional journeys through the real learner HTTP service, PostgreSQL catalog, report capture and exercise grading. The preset expectations are independent of the ranking implementation. It measures product behavior; it does not establish usefulness for real learners, professional readiness, or Moroccan regulatory accuracy.

## Run

```powershell
npm run evaluate:career-journeys
```

Use `PRAXIS_LEARNER_TEST_DATABASE_URL` for an explicitly selected, migrated and source-loaded database ending in `_test`. When it is absent, the runner uses the host and credentials from `DATABASE_URL` with the database name `praxis_rome_test`. It checks the actual database name before creating learners. It never creates or resets a database. The test catalog must contain the career drafts and enabled pilot exercises from the preceding implementation stages.

Temporary learners, reports and exercise attempts are erased after the run, including a failing run. No real learner session is used. Results go to the ignored `out/latest.json` and `out/latest.md` files. Source release, algorithm versions, case definitions, individual checks and aggregate results are retained without credentials, session cookies or learner IDs.

## Preset journeys and gates

| Journey | Market | Domain | Starting occupation and target | Expected first exercise |
|---|---|---|---|---|
| Credit dossier | France / Morocco | Banque | C1202 | Prepare a fictional credit dossier |
| Team allocation | France / Morocco | Banque | C1207 | Allocate a fictional team's work |
| Operations reconciliation | France / Morocco | Finance | C1302 | Reconcile a fictional batch |

Six journeys must retain all source-domain candidates, expose the selected target in the first five recommendations, offer the exact available pilot action, preserve country scope, and avoid professional mastery or career-level claims. Two reconciliation episodes must unlock the explicit correction exercise while leaving the unknown occupational requirements unknown.

Additional checks reject out-of-domain reports and draft career goals, require a country choice when absent, prevent exercise completion transferring to the other market, preserve historical reports, and exclude a starting occupation outside the selected domain. Every gate must pass; the CLI exits nonzero on failure.

Mirrored France/Morocco cases test country separation. Their occupation descriptions still originate from France Travail, and their exercises use fictional rules. This is not a reviewed local career framework. France and Morocco drafts remain unpublished.

## Optional live Gemma comparison

With `NVIDIA_API_KEY` configured server-side:

```powershell
npm run evaluate:career-journeys -- --with-nvidia
```

This runs two additional bounded coordinator analyses, one per market, on fictional three-target Finance reports. Maximum: **eight model requests in total**, plus bounded HTTP status polling. A failed provider run is recorded and makes the evaluation command fail. The default command performs **zero NVIDIA calls**.

Completed analyses create `out/review-pairs.json` and a separate `out/comparison-key.json`. Give an independent reviewer only the pairs and the rubric below. A/B position alternates; the pair file omits model identity and call counts. The current deterministic plan is the baseline. Two pairs are a smoke check, not enough to establish a quality gain or authorize specialist agents.

## Independent review rubric

For each market separately, record `preferred` as `A`, `B`, or `tie`, set `reviewerId`, and select one or more reason codes:

- `goal_relevance`: the order and next action address the learner's stated occupation goals.
- `action_specificity`: the learner can perform the action with the supplied materials and criteria.
- `prerequisite_validity`: the action is available now and respects explicit dependencies.
- `source_support`: the recommendation is supported by the dossier's exact sources.
- `market_appropriateness`: the reviewer can justify its use in the selected country; identify gaps rather than borrowing another market's level framework.
- `claim_calibration`: unknown practice, exercise outcomes, and professional competence remain distinct.

An invalid prerequisite, unsupported level claim, wrong market, or invented source is a blocking defect. Report wins, ties, losses, provider failures and latency separately for France and Morocco. Use independently reviewed journeys beyond these six fixed fixtures, and quantify uncertainty before making a benefit claim. Add a specialist agent only after its comparison against the current coordinator demonstrates useful improvement without introducing blocking defects. No specialist agent is enabled by this benchmark.
