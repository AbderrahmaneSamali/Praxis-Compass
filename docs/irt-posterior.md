# Bayesian IRT posterior and uncertainty

Stage 4 adds a replayable Bayesian two-parameter logistic (2PL) assessment model. It replaces neither the governed item bank nor historical SPRT traces; it provides a versioned posterior and uncertainty-aware stopping policy alongside them.

## Required inputs

The host must provide a versioned population prior and explicit theta boundaries for L1, L2 and L3. The engine intentionally does not invent mastery cut scores. Every administered item must be calibrated and have difficulty in `[-4,4]` and discrimination in `(0,4]`. Responses are correct, incorrect, or omitted; omissions are recorded but add no likelihood.

For response `i`, the model is `P(correct | theta) = logistic(a_i * (theta - b_i))`. The posterior is evaluated on a bounded grid, normalized with log-space likelihoods, and summarized with EAP theta, MAP theta, posterior standard deviation, an equal-tailed credible interval, category/mastery probabilities, and Fisher-information measures.

```ts
const posterior = estimateIrtPosterior(responses, {
  prior: { mean: 0, standardDeviation: 1, version: 'population-2026-q3' },
  levelThresholds: [
    { level: 'L1', minimumTheta: -1 },
    { level: 'L2', minimumTheta: 0 },
    { level: 'L3', minimumTheta: 1 },
  ],
});

const decision = evaluateIrtStopping(posterior, coverageAchieved, {
  minimumScoredItems: 8,
  maximumScoredItems: 24,
  maximumPosteriorStandardDeviation: 0.45,
  minimumCategoryProbability: 0.8,
  minimumTestInformation: 5,
  version: 'assessment-stop-2026-q3',
});
```

Those numbers are examples, not production defaults. Thresholds, priors, and stopping values must be estimated and approved for each intended assessment population.

## Calibration uncertainty

When both item-parameter standard errors are available, the response curve is marginalized over difficulty and discrimination uncertainty with Gaussian quadrature. If neither is available, the posterior is explicitly marked `conditional_point_estimates`; mixed banks are marked `mixed`. This avoids silently describing calibration estimates as known constants. Migration `053_irt_posterior_uncertainty.sql` adds these standard-error fields and an optional calibration sample size.

`selectNextIrtItem()` chooses the eligible non-administered item with the greatest posterior expected Fisher information. A caller-supplied exposure ceiling is enforced, but content balancing and security constraints remain the bank allocator's responsibility.

## Stopping and persistence

Stopping requires all configured conditions: minimum length, blueprint coverage, posterior precision, test information, and category probability. At the maximum length, an unresolved posterior ends as `inconclusive`; it is never forced into the nearest level. Lack of coverage also prevents a level decision.

Use `engine.assessments.record(sessionId, posterior, coverageAchieved, policy)` after the matching response rows have been committed. It validates posterior input and result hashes, locks the session, verifies response count, computes the stopping decision server-side, and writes an append-only trace. Repeating identical content is idempotent; different content at the same step is rejected. Apply migration 053 first.

## Interpretation limits

- The model assumes one latent dimension and local item independence. Validate dimensionality and model fit before production use.
- The `dif_not_modeled` flag is always emitted. DIF analyses by relevant language and learner groups remain mandatory; short adaptive tests can amplify biased-item effects.
- A posterior probability is not automatically mastery evidence. Only a completed, covered, reconciled production session may enter the existing evidence ladder.
- Small or unrepresentative calibration samples can still bias ability estimates. Parameter marginalization represents reported standard errors, not every source of model error.
- The default numerical grid and credible mass are integration settings, not policy cut scores. Boundary mass is flagged so the caller can widen the grid or investigate extreme response patterns.

The implementation is based on the checked-in research on CAT under DIF, online 2PL calibration, and Bayesian hierarchical IRT. No generative model makes assessment decisions or publishes items.
