# Graph and sequential recommender experiments

Stage 8 adds a controlled offline-evaluation boundary for externally trained graph, sequential, or combined recommenders. It does not train a neural model, change production recommendation weights, or provide a route for an experimental model to serve learners.

## Why the boundary exists

The checked-in H-BERT4Rec research reports gains from combining heterogeneous-network embeddings with temporal course histories, but also identifies sensitivity to sequence length, embedding dimensions, hyperparameters, graph-data quality, computation cost, and negative sampling. The structure- and logic-aware graph work similarly shows that non-local graph structure and uncertain logical relations may matter, while using multiple baselines and ablations to establish whether the added complexity helps.

Those findings justify an experiment, not an automatic deployment. Historical recommendation logs expose only outcomes under the historical policy. Unchosen courses have no counterfactual completion or skill-gain label, and completion alone does not prove causal learning gain.

## Required data contract

`evaluateGraphSequentialExperiment()` accepts:

- immutable resolved learning outcomes labelled `real`, `fixture`, or `example`;
- one time-ordered holdout case per learner;
- the exact candidate set that was eligible at prediction time;
- one production baseline and at least one graph or sequential challenger;
- complete case-model rankings;
- model, feature, and graph snapshot cutoffs;
- caller-defined, versioned readiness and promotion thresholds.

Fixture and example outcomes remain in the audit manifest but never count toward readiness and cannot appear in evaluation cases. Real outcomes after the evaluation window also cannot satisfy readiness.

For database-backed experiments, load the cohort through `engine.recommenderExperiments.loadRealOutcomeCohort(evaluationEndsAt)`. Migration 057 defines its source view by joining governed learning outcomes to non-fixture content and providers, excluding example impressions, and deriving assessed-gain labels only from assessed skill-progress evidence.

Every history event, model training cutoff, feature snapshot, and graph snapshot must end before the global training cutoff. The target is a real completion after that cutoff. Ranked items must be a subset of the served-time eligible set, so an experimental model cannot improve its apparent score by recommending unavailable or constraint-ineligible courses.

## Evidence gates

The evaluator returns `blocked_insufficient_real_outcomes` and no metrics when any versioned gate fails. Gates cover:

- resolved and completed real outcomes;
- distinct real learners and observed items;
- minimum history per holdout learner;
- total evaluation cases and cases per segment;
- evaluation targets with an assessed skill-gain result.

The library deliberately supplies no “magic” sample-size defaults. The experiment owner must justify and version the thresholds before evaluating a model.

## Evaluation and promotion ceiling

For each model and requested K, Stage 8 calculates hit rate, NDCG, reciprocal rank, catalog coverage, assessed-gain metrics, and segment metrics. Challenger lift against the production baseline receives a deterministic learner-level paired-bootstrap interval.

A graph or sequential challenger is only `eligible_for_prospective_trial` when:

- the lower confidence bound clears the configured primary-metric lift;
- catalog coverage stays inside the allowed loss;
- the worst segment stays inside its non-inferiority margin;
- assessed-gain NDCG stays inside its non-inferiority margin.

This status is not production approval. An independent reviewer must additionally approve a prospective trial after checking temporal leakage, eligibility constraints, baseline comparison, subgroup results, and privacy. Even that review authorizes only a separately designed prospective trial with consent, guardrails, and predeclared stopping criteria.

```ts
const result = evaluateGraphSequentialExperiment({
  outcomes,
  cases,
  models,
  rankings,
  computedAt: new Date(),
  policy: experimentPolicy,
});

await engine.recommenderExperiments.recordBatch('offline-evaluator-v1', result);
```

Migration 057 persists only aggregate manifests, gates, metrics, paired comparisons, and reviews. Learner-level holdouts and ranking lists remain in the controlled evaluation environment. The migration intentionally has no foreign key, trigger, or view connecting an experiment to `recommendation_weights` or production serving.

## What remains before a real experiment

The host application still needs enough non-fixture, consent-compatible outcomes; a frozen extraction query that builds temporal holdouts from impressions and learning outcomes; externally trained baseline and challenger artifacts; and a registered analysis policy with defensible sample-size and non-inferiority thresholds. Until those exist, Stage 8 should record a blocked readiness result rather than synthetic performance claims.
