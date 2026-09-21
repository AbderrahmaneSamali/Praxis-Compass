# Bias-corrected labor-market ingestion

Stage 6 ingests online job advertisements as a timely but nonrepresentative sample. It deduplicates postings, calibrates the covered sample to an official benchmark distribution, quantifies uncertainty, and persists the complete weighting trace. It does not treat raw ad volume as labor-market truth.

## Required inputs

`biasCorrectLaborMarketIngestion()` requires:

- versioned online-ad source releases with retrieval time, license, and a coverage statement;
- posting identifiers, a cross-source deduplication key, observation time, governed skill IDs, and a complete country/region/sector/occupation stratum;
- one official benchmark release for the same period, with unique cells using the same strata;
- an explicit versioned policy for weight bounds, minimum benchmark coverage, effective sample size, minimum skill observations, and confidence level.

No job-description text, applicant data, names, contact details, or other personal data enter this layer. Text classification and ESCO linking happen upstream; only the resulting governed skill IDs are accepted for persistence.

## Correction method

For every covered stratum, the estimator calculates a post-stratification factor:

`official covered-frame share / deduplicated online-ad share`

The factor is bounded by the supplied policy. Adjusted skill demand is the weighted proportion of covered postings mentioning a skill. Results expose the benchmarked raw share, adjusted share, and relative change, so the effect of correction is auditable. The “adjusted posting equivalent” is a weighted sample quantity, not a forecast or an absolute vacancy count.

Cross-source duplicates are collapsed before weighting. Conflicting strata for the same deduplication key reject the batch. Skill disagreements across duplicate copies are merged but explicitly flagged. The upstream system is responsible for creating a documented, versioned deduplication key; source-specific posting IDs alone are not adequate for cross-portal duplication.

Benchmark cells with no observed postings are never silently assigned zero demand or imputed. Their official mass reduces the coverage ratio. Online-ad strata absent from the benchmark are retained in the raw trace but excluded from corrected estimates, and skills appearing in those observations cannot be published as corrected demand.

## Uncertainty and release gates

Each skill estimate includes Kish effective sample size, a weighted-proportion standard error, and a Wilson interval at the configured confidence level. An estimate is not `publishable` when benchmark coverage, overall effective sample size, or skill observations fall below policy limits. These intervals are approximations for the weighted sample; they do not capture benchmark error, linkage error, or every aspect of platform selection.

`selection_bias_may_remain` and `absolute_vacancy_level_not_identified` are always emitted. Post-stratification corrects observed differences across the supplied cells, but nonrandom selection can remain within cells or through omitted variables. A validated sample-selection model can later be introduced under a new algorithm version; it must not overwrite these historical estimates.

## Persistence and downstream use

Apply migration `055_bias_corrected_labor_market_ingestion.sql`, then call:

```ts
const batch = biasCorrectLaborMarketIngestion(input);
const recorded = await engine.laborMarket.record(batch);
```

The repository verifies all skill IDs against the governed catalog and atomically stores source releases, official benchmark cells, raw observation metadata, stratum weights, skill estimates, uncertainty, and hashed snapshots. Source and benchmark release IDs cannot be silently reused with different metadata. All records are append-only.

Stage 6 deliberately does not wire these estimates into recommendation scoring. A later policy must define freshness, geographic relevance, uncertainty penalties, and outcome evaluation before any `publishable` demand signal can influence ranking. Labor-market demand is also never evidence that a learner possesses a skill.

The implementation follows the checked-in research finding that online job advertisements are timely and granular but can strongly overrepresent or underrepresent sectors, regions, and occupations. The paper's sample-selection approach reduced measured bias substantially but did not justify treating raw counts as representative; this implementation therefore makes its simpler post-stratification assumptions and residual-bias boundary explicit.
