# Adaptive skill interview for PRAXIS

**Decision proposal — design only.** Build a deterministic, replayable interview coordinator and make the language agent an optional renderer/interpreter. The first release is a **low-confidence screening interview**, not an IRT test and not proof of mastery. It should usually ask 5–8 questions, return useful partial advice when safe, and abstain when the evidence does not support a level.

## 1. Overview

The interview fills the gap between sparse CV/self-declared evidence and the governed calibrated assessment path. It targets the few unknown skills most likely to change the recommendation set, rather than testing every skill.

```text
target role + immutable ESCO/overlay + learner evidence + catalog snapshot
                              |
                    deterministic coordinator
          prior -> choose skill/item -> validate answer -> update belief
             |              |                              |
             |       language agent (optional)             |
             |       speaks / maps free text               |
             |       but never scores or decides           |
             +----------------------+-----------------------+
                                    |
               stop: stable top 3 / budget 8 / no item / learner exits
                                    |
                 evidence ledger -> deterministic recommender
                                    |
             ok | plan_available | partial_profile | insufficient_profile
                 | goal_satisfied | no_eligible_courses
```

The PostgreSQL system of record remains authoritative. ESCO records stay immutable; reviewed, versioned overlays hold PRAXIS target levels and importance. Every decision stores a registered algorithm version, immutable input snapshot/hash, taxonomy and overlay releases, item versions, and structured reason IDs. A replay consumes stored normalized answers and agent outputs; it never asks a stochastic model to recreate a past decision.

## 2. Deterministic/agent boundary

| Concern | Deterministic core | Language agent |
|---|---|---|
| Target/skills | Loads reviewed role profile and evidence; unknown remains unknown | May explain labels in the selected locale |
| Next question | Computes value of information (VOI), applies bank/review/exposure rules, tie-breaks by stable ID | Cannot nominate a skill or item |
| Scored item | Serves an approved, immutable stem/options/key and scores the selected option | Adds a short conversational lead-in; cannot rewrite the scored stem/options |
| Free text | Validates allowed rubric IDs and exact cited spans; keeps this evidence separate | Maps the utterance to a reviewed rubric or `unknown`; never invents a rubric |
| Level/confidence | Updates L0–L4 beliefs, emits a conservative lower bound or abstains | No numeric probability, level, confidence, gap, or pass/fail authority |
| Stop/status | Applies per-skill/global budgets, top-3 stability, eligibility, and status rules | May phrase the transition or result |
| Recommendation | Existing hard filters, pathway planner, ranker, and reason IDs | May summarize only facts present in the result payload |
| Failure | Template UI and buttons remain fully functional | Invalid/late/unavailable output is discarded and logged |

The system must run in `agent_mode: disabled`: reviewed text, buttons, and deterministic templates provide the complete flow. This is also the fallback and the reference implementation for tests.

## 3. Algorithms

### State and initial question

For each required target skill `s`, keep a categorical belief `p_s(L)` over `L0..L4`. This is an interview policy distribution, **not a calibrated psychometric posterior**. With no usable evidence or conflicting evidence it is uniform. For usable low-confidence evidence at level `h`, use `p=(1-w)U+wK_h`, where `U` is uniform and `K_h` has relative mass `.2/.6/.2` on `h-1/h/h+1` (renormalized at L0/L4); `w=.20` for low and `.35` for medium-low evidence. Medium-or-higher evidence is not re-screened by this MVP. These weights are versioned hypotheses and sensitivity-tested. An unconfirmed CV mention may choose the first item anchor but cannot create usable evidence or a non-uniform mastery prior. The first item is closest to the CV hint when present, otherwise closest to the job target, clamped to L1–L3. L4 is never certified by this interview; it requires practical/human evidence.

Only independently reviewed `pilot` closed-form items with four options and the requested locale are eligible. Until real calibration exists, use this declared, monotone likelihood policy:

| True level relative to item anchor `d` | `L <= d-2` | `L = d-1` | `L = d` | `L >= d+1` |
|---|---:|---:|---:|---:|
| Policy `P(correct | L,d)` | .25 | .35 | .65 | .80 |

These are auditable engineering assumptions (including the four-option chance floor), not fitted item parameters. A sensitivity sweep must vary them in simulation. For response `y`, update `p'(L) proportional to p(L) * P(y|L,d)`; incorrect uses `1-P(correct)`. `skip`, `don't know`, timeout, and invalid agent mappings are recorded with likelihood 1, so they do not move belief.

Free-text rubric matches update a separate `rubric_context` stream only. They may guide the next conversational prompt, but they do not update the closed-form belief or promote its level. This prevents fluent model interpretation from masquerading as tested evidence.

### Question selection (cheap VOI v1)

For every eligible unasked item, enumerate correct/incorrect outcomes and calculate expected entropy reduction `EIG = H(p) - E_y[H(p|y)]`. Compute once per skill:

- `importance = target importance / 3`;
- `decision_proximity = 4q(1-q)`, where `q=P(L < target)`; it peaks when the gap decision is uncertain;
- `recommendation_impact = min(1, affected/max(1,top_pool))`, where `affected` is the number of the deterministic ranker's top-20 pre-candidates whose outcome or reviewed prerequisite references the skill.

Then:

`utility(item) = EIG * importance * (0.5 + 0.25*decision_proximity + 0.25*recommendation_impact)`.

Apply hard review/locale/security/exposure filters first; choose maximum utility, then target-level distance, then stable item ID. This is a transparent proxy for “would resolving this skill change recommendations?” It avoids running a learned policy and is cheap enough for one developer. The simulation compares it with both ask-all and importance-only policies.

### Estimation and stopping

After at least two scored closed-form items from two blueprint facets, define the conservative level as the greatest `k in L1..L3` for which `P(L >= k) >= .80`. Emit it only when it remains the same after the next scored response; otherwise ask up to three scored items for that skill and then abstain. L0 is emitted only from an explicit learner self-declaration; L4 is never emitted. `.80`, two facets, and three items are versioned launch hypotheses to tune—not claims of validity.

The interview asks at least 5 and at most 8 total questions. It can stop earlier only if the learner exits or no reviewed item remains. From question 5 onward, compute current deterministic top 3, then rerun the ranker for each unresolved skill at its lowest and highest level carrying at least .10 belief mass. The top 3 is stable only when every one-at-a-time perturbation preserves the same ordered IDs and all three items have known prerequisites. Stop after two consecutive stable snapshots. Exhausting the budget yields partial/insufficient output, never a forced level.

```text
load versioned inputs; create session; belief[skill] = prior(skill)
while asked < 8 and not learner_exit:
  candidates = reviewed_pilot_items - asked_items
  item = argmax deterministic_utility(candidates, beliefs, target, catalog)
  if no item: break
  display immutable item (optional agent lead-in); validate answer
  append step; update closed-form belief or separate rubric context
  if skill rule passes: append low-confidence screening evidence
  if asked >= 5 and top3_stable_twice(): break
return deterministic recommendation status, unknowns, evidence, and trace
```

**Worked update.** For a target-L2 skill with a uniform prior, a correct L2 item has unnormalized weights `[.05,.07,.13,.16,.16]`, or posterior `[.09,.12,.23,.28,.28]`. An incorrect L3 item then gives approximately `[.14,.20,.32,.21,.12]`. Only the conservative L1 lower bound crosses `.80`, and it has not yet met the stability rule, so the core asks again or abstains. Two plausible answers do not become false precision.

## 4. Data model and migration plan

Reuse migration 019's `assessment_item`/response concepts, 030's multi-skill `diagnostic_session(flow='skills')` and append-only question trace, and 031's locale, taxonomy releases, utility factors, likelihood model, selection reason, posteriors, and observations. Reuse 032–034/054 governance: only the latest independently approved `pilot` item is interview-eligible; `draft` is never served, and `published` remains reserved for calibrated production assessment. The existing 2PL service is not called for this bank.

Propose append-only migration `058_adaptive_skill_interview.sql`:

- extend `skill_evidence.evidence_type` with `interview_closed_form_screening` (low, usable for conservative partial ranking, L1–L3 only) and `interview_rubric_context` (very low, not usable alone); preserve the L0 self-declaration check;
- add `adaptive_interview_skill_trace(session_id, step_index, skill_id, target_level, prior, posterior, scored_count, facet_count, conservative_level, stop_reason_id, algorithm_version, inputs_hash, created_at)`, unique by session/step/skill and guarded against update/delete;
- add `adaptive_interview_agent_turn(session_id, step_id, mode, provider, model, prompt_template_version, safety_policy_version, structured_input, structured_output, validation_status, fallback_reason_id, externally_processed, consent_record_id, inputs_hash, created_at)`, also immutable;
- add indexes by session/step and session/skill. Do not duplicate ESCO, role targets, items, responses, or recommendations.

The migration begins with a rollback block that drops the two new tables and restores the prior evidence-type constraint **only after exporting/removing new evidence rows**. Its checksum is added once and never rewritten. Register `ALGORITHM_VERSIONS.adaptiveSkillInterview = 'praxis-adaptive-skill-interview-v1'`; prompt template, safety policy, likelihood policy, item/blueprint, recommender, evidence adapter, overlay, and taxonomy versions are separate inputs to the session hash.

Store no raw CV in the trace—only evidence IDs, skill IDs, level hints, and source hashes. Computational replay uses normalized answers plus stored validated agent output; optional raw utterance retention belongs in a separately access-controlled/encrypted host store with its own deletion policy.

## 5. Statuses and contracts

Add `partial_profile` to `RecommendationResult.status` and expose:

```ts
type InterviewRecommendationResult = {
  status: 'ok'|'plan_available'|'partial_profile'|'insufficient_profile'|
          'goal_satisfied'|'no_eligible_courses';
  knownGapSkillIds: string[]; unknownSkillIds: string[]; conflictingSkillIds: string[];
  recommendations: ScoredRecommendation[]; relatedRecommendations: ScoredRecommendation[];
  assessmentHandoff: AssessmentHandoff|null;
  interview: { sessionId: string; questionsAsked: number; maxQuestions: 8;
    stopReasonId: string; stableTop3: boolean; algorithmVersion: string; inputsHash: string };
  reasonIds: string[];
}
```

Rules, in order:

1. `goal_satisfied` requires every required target skill to have usable, non-conflicting evidence and meet its target. One unknown makes this status impossible.
2. `partial_profile` means at least one required skill is still unknown/conflicting **and** at least one known gap supports safe ranking. Rank only items that advance known gaps; an unknown prerequisite remains a hard block. Return the unknown list and assessment/confirmation handoff.
3. `insufficient_profile` means no required skill has usable evidence or no course can be safely ranked from the known subset. It is not a negative skill judgment.
4. `ok`, `plan_available`, and `no_eligible_courses` retain their meanings after the complete-profile guard. Partial results use only `partial_profile`, even if they contain a plan.

Initial reason IDs: `INTERVIEW_TOP3_STABLE`, `INTERVIEW_BUDGET_EXHAUSTED`, `INTERVIEW_NO_REVIEWED_ITEM`, `INTERVIEW_LEARNER_EXIT`, `SKILL_SCREENING_RESOLVED`, `SKILL_SCREENING_ABSTAINED`, `PARTIAL_UNKNOWN_TARGET_SKILLS`, `PARTIAL_UNKNOWN_PREREQUISITE`, and `GOAL_STATUS_REQUIRES_COMPLETE_PROFILE`.

## 6. Agent contract, validation, fallback, and privacy

The agent receives one JSON object and must return one JSON object; no tools, database, recommendation list, answer key, hidden probabilities, or raw CV are exposed.

```json
{
  "schemaVersion":"interview-agent-v1", "turnId":"uuid", "mode":"render|interpret_rubric|summarize",
  "locale":"fr|ar|en", "promptTemplateVersion":"...", "safetyPolicyVersion":"...",
  "reviewedContent":{"questionId":"...","skillLabel":"...","stem":"...","options":[{"id":"...","text":"..."}]},
  "allowedRubric":[{"criterionId":"...","description":"..."}],
  "learnerMessage":"PII-minimized text or null",
  "resultFacts":{"status":null,"knownGapSkillIds":[],"unknownSkillIds":[],"reasonIds":[]}
}
```

Only fields needed by `mode` are populated. For `render`, the UI—not the model—renders `stem` and `options` unchanged. Output:

```json
{
  "schemaVersion":"interview-agent-v1", "turnId":"same uuid",
  "intent":"answer|dont_know|skip|off_topic|request_clarification",
  "leadIn":"max 240 chars", "selectedOptionId":null,
  "rubricMatches":[{"criterionId":"allowed id","start":0,"end":12}],
  "summary":"max 500 chars"
}
```

The validator rejects unknown keys/IDs, wrong turn/schema/locale, bad offsets, markup/URLs, control characters, length excess, or output facts absent from the input. A typed button click is scored directly. A free-text option mapping is shown back for one-tap confirmation before scoring. Rubric offsets must quote the normalized learner message exactly. One schema-repair retry is allowed; then a deterministic localized template and buttons take over. Failure changes no belief.

Injection defenses are structural: learner/source text is delimited as data, the agent has no tools or secrets, scored content and rubric IDs are allowlisted and immutable, output is JSON-schema validated and HTML-escaped, and no model field can drive item choice, correctness, probability, stop, eligibility, or status. Log validation/fallback reason IDs, not hidden chain-of-thought.

Law 09-08 applies to personal-data processing in Morocco; PRAXIS should document purpose, minimization, retention, security, learner access/correction/opposition, and the required CNDP declaration/authorization. If a model processes data abroad, do not send it by default: offer an equivalent local/template path, obtain specific informed opt-in where relied upon, name provider/country/purpose/retention, prohibit provider training, use contractual/security controls, and complete the applicable CNDP transfer process. Consent does not replace notification/authorization of the underlying processing. See the official [Law 09-08](https://www.cndp.ma/images/lois/Loi-09-08-Fr.pdf), [CNDP processing formalities](https://www.cndp.ma/notifier-un-traitement/), and [foreign-transfer procedure](https://www.cndp.ma/transfert-de-donnees-a-letranger/). Final deployment needs Moroccan counsel/CNDP review, not an engineering interpretation alone.

## 7. Item-bank plan

Pilot one existing published role: **Analyste de données**, whose authored profile has 12 catalog-supported skills (`analyze_dataset`, `frame_analytical_question`, `build_dashboard`, `prepare_data`, `communicate_finding`, `model_data`, `write_queries`, `check_data_integrity`, `explore_data`, `choose_analytical_method`, `validate_findings`, `quantitative_reasoning`). Start in French; Arabic is a separately reviewed form, not live model translation.

Create 3–5 closed-form items per skill (36–60 per locale): two target-level scenarios across distinct facets, one misconception/diagnostic item, and up to two neighboring-level items. Optional free-text prompts are separate and do not count toward closed-form coverage. Use the existing AI-assisted drafting workflow only for drafts; a subject-matter expert plus independent French/Arabic language and bias/accessibility review must approve the latest version before pilot serving.

Calibration sequence:

- 30–50 responses/item: usability, ambiguity, timing, broken distractors only; no “calibrated” claim;
- plan for at least 200 scored responses/item before considering 2PL activation, with 300 preferred where feasible; these are collection targets, not guarantees of parameter quality;
- require psychometric recovery/power analysis, dimensionality/local-dependence and fit checks, parameter uncertainty, exposure review, and DIF checks by language/relevant learner groups. Where subgroup counts are inadequate, mark DIF unknown rather than pass;
- only then promote qualifying items through the existing calibrated publication gate and use the Stage-4 IRT path. Failed items are revised as new versions or retired, never overwritten.

## 8. Simulation and ship gates

Extend the seeded simulator/oracle with hidden L0–L4 truth, CV-hint noise, four-option responses from multiple plausible likelihood tables, skips, agent failures, and per-question abandonment. Run identical learners through:

1. **ask-all:** three items for every target skill (quality upper bound, high burden);
2. **importance:** eight-question cap, skills/items ordered only by target importance/distance;
3. **VOI adaptive:** the proposed 5–8-question policy.

Report bootstrap intervals overall and by locale/archetype for median/p90 questions, completion, exact-level accuracy **and estimate coverage/MAE**, served rate, wrong `goal_satisfied`, useful@5, ready@5, hard-constraint breaches, and abstention. Accuracy without coverage is rejected because a policy can look accurate by answering rarely.

Ship only to a consented limited pilot when, across sensitivity scenarios: median questions are 5–8 and p90 <= 8; completion is at least 85% and no more than 5 percentage points below importance-only; VOI uses at least 40% fewer questions than ask-all; exact-level accuracy, useful@5, and ready@5 are each within 3 points of ask-all and not below importance-only; served improves by at least 15 points over the current incomplete-evidence flow; wrong-done is <=1% and no worse than ask-all; and hard-constraint/publication violations are zero. Also require no material (>5-point) FR/AR or major subgroup degradation without review. These are launch decision thresholds, not psychometric validity claims. Production evidence authority still waits for real pilot/calibration results.

## 9. Implementation sequence

| Step | Deliverable and independent test | Size |
|---|---|---:|
| 1 | Status/reason contracts plus oracle scenarios proving unknown never becomes L0/`goal_satisfied` and partial advice never bypasses prerequisites | S |
| 2 | Pure state machine: priors, Bayes update, VOI selector, conservative level, stability/budget stops; property tests and seeded replay; complete no-agent CLI fixture | M |
| 3 | Migration 058 and repository persistence; append-only guards, hash/version/checksum and replay/integrity DB tests | M |
| 4 | French data-analyst blueprints and 36–60 reviewed pilot items using existing draft/review gates; content QA and exposure tests | L |
| 5 | Optional agent adapter, schema validator, template fallback, consent/transfer controls, red-team injection tests; then three-policy simulation and pilot dashboard | M |

Steps 1–3 produce a useful template/button interview without any model. Step 4 supplies governed content. Step 5 may improve conversation but cannot change the reference decisions.

## 10. Risks, open questions, and recommendation

| Risk/open question | Required answer or control |
|---|---|
| Uncalibrated probabilities look scientific | Label as screening, version/sensitivity-test policy assumptions, conservative lower bounds, abstain, never call it IRT |
| Partial advice hides an important unknown | Persistent unknown banner/handoff; no `goal_satisfied`; unknown prerequisites hard-block |
| Agent changes meaning or is injected | Immutable scored UI, allowlisted IDs, validation, confirmation, no tools/keys/decisions, template fallback |
| French/Arabic translation or DIF | Separate reviewed forms and metrics; no on-the-fly scored translation; hold back weak subgroups |
| External processing violates learner expectations or Law 09-08 | Local/template default, explicit choice, minimization, vendor/transfer review, CNDP formalities, retention/deletion controls |
| Small bank is exposed or memorized | Per-item exposure caps, rotation, security review, new immutable versions |
| Conservative screening underestimates experts | Offer practical/human validation and later calibrated assessment; never infer L4 |
| Product policy | Confirm whether partial ranking may include only known gaps (recommended), retention duration, approved model locations, and who signs SME/language/bias reviews |

**Recommendation:** implement the deterministic no-agent path first for the French data-analyst role, simulate it against ask-all/importance baselines, and launch only as a low-confidence consented pilot. Add the agent afterward as a replaceable language layer. Do not use it to score mastery, manufacture item difficulty, infer L4, clear prerequisites, or declare the goal satisfied. This scope is small enough for one developer because it extends the existing session, evidence, item-governance, recommender, and simulation primitives instead of creating a second engine.
