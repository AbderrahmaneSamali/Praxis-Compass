# PRAXIS diagnostic and fastest credible MVP plan

Date: 24 September 2026. Scope: the `praxis-engine-standalone` repository in this workspace. This does not certify another application, the sibling PRE-PRAXIS repository, or a deployed service.

**Executive assessment**

PRAXIS has a substantial, tested recommendation and evidence engine, but its learner product remains a local preview. The fastest route to a useful MVP is to connect one narrow learner journey to a small, verified course catalog, reduce onboarding friction, and collect real feedback. Expanding the research architecture is unlikely to be the critical path.

The core promise should be: “Tell us your goal and experience; get a credible next learning step that fits your time, language, and budget, with a clear explanation.” Start with one audience and two or three adjacent roles. Data analytics is a plausible starting hypothesis because it already appears in the local examples; validate demand and available course coverage before choosing it.

**1. What was actually verified**

| Check | Result | What it establishes |
|---|---|---|
| `npm run typecheck` | Passed | Covered TypeScript sources, examples, and migration runner typecheck |
| `npm test` | 110 passed, zero failed/skipped | Build and algorithm/unit contracts pass; some repository tests use doubles |
| `node simulation/run.mjs --learners 300 --seed 20260919` | Completed, 15 scenarios | 4,500 synthetic scenario runs; no reported hard-constraint/publication violations |
| Direct invocation of CV extractor/evaluator on local pilot | Completed | Reproduced the small held-out pilot's weak extraction/linking metrics |
| Read-only database connection using `.env` | `ECONNREFUSED` | Configured database was unreachable from this session |
| Docker engine probe | Unavailable | Could not obtain a running Docker engine; configuration access warning also occurred |
| Direct learner server start | Failed with missing `DATABASE_URL` | The learner entry point does not load `.env`, although the migration runner does |
| Database and learner integration suites | Not run | Dedicated test database variables were absent and configured database unreachable |
| Browser rendering, mobile interaction, load testing | Not verified | No functioning database-backed application available for these checks |

Node used: v24.11.0. Database secrets and CV text were not printed. No application code or schema was changed. This report and regenerated ignored simulation outputs are the audit artifacts.

Passing tests does not establish production recommendation quality, safe deployment, complete migration reproducibility, or actual learning gains. The database outage is an environment observation, not proof of defective SQL.

**2. What is working or substantially implemented**

| Component | Evidence and value | Boundary |
|---|---|---|
| Recommendation engine | Tests cover budget, language, workload, prerequisites, publication, ranking, and candidate handling | Real utility depends on course data and learner evidence |
| Learning-path planner | Tests cover prerequisite chains, cycles, cumulative budget, schedule ordering, and bounded search | Course outcomes are projected, not proof that the learner acquired a skill |
| Evidence resolution | Unknown differs from explicit zero; stronger evidence wins; contradictions and stale evidence are handled | Self-report may still be confidently wrong |
| Provenance and impressions | Replay snapshots, hashes, transactional persistence contracts, mutation rejection | Live SQL and operational retention were not validated here |
| Career Compass | Weighted occupation overlap and bridge-skill logic exist | Complete active taxonomy availability was not verified |
| Learner preview | Goal, constraints, level declarations, work examples, courses, and plans are wired in source | Local anonymous sessions; live journey unverified |
| Local security controls | HttpOnly/SameSite cookies, CSRF and origin checks, host allowlist, CSP, body limit, parameterized SQL | These are local-preview controls, not a completed public deployment design |
| CV confirmation | Confirm/correct/reject/unsure and explicit level attestation are tested | Not exposed as a complete CV-to-profile learner flow |
| IRT, item drafting, labor-market correction, crosswalks, experiments | Implemented contracts and unit tests with explicit review/uncertainty boundaries | No demonstrated end-to-end production services or validated field outcomes |

Preserve these strengths. A framework rewrite is not required to test the product hypothesis.

**3. Prioritized problems and solutions**

Priorities refer to the proposed pilot: P0 blocks a credible pilot, P1 should be resolved during pilot preparation, P2 can follow validation.

| Priority | Finding | Consequence | Concrete solution and acceptance check |
|---|---|---|---|
| P0 | Startup configuration mismatch | Copying `.env` is insufficient for the learner command in a fresh shell | Load configuration consistently at entry points; validate it before startup. A clean shell starts the app using the documented procedure |
| P0 | Database unavailable here | Live persistence and migration checks remain unproven | Restore a reachable local/test database, run all 57 migrations on a disposable database with required taxonomy prerequisites, then run both integration suites |
| P0 | Public hosting is not implemented by the learner server | It binds loopback, permits local hosts only, and checks an HTTP origin | Define canonical deployment origin, HTTPS handling, secure cookies, server binding, and proxy trust. Test deployed-origin CSRF and session isolation; do not simply remove host checks |
| P0 | Verified, actionable course coverage is unproven | A correct engine can return nothing useful | Curate an initial 15–30 real offers across 2–3 roles, subject to review capacity. Measure eligible coverage by budget/language/level; publish only with verified links, prerequisites and supported outcomes |
| P0 | One missing target skill clears the ranking skill set | Incomplete profiles lose all direct advice | Add an explicit partial-profile result that preserves unknowns. Recommend only where known gaps and verified prerequisites justify it; ask the next highest-value question. Never report the whole goal satisfied while target skills remain unknown |
| P1 | Self-report can overstate readiness | Learners may get unsuitable courses or false completion signals | Show evidence source/confidence; distinguish “requirements covered by your declarations” from demonstrated readiness. Add a short practical check or human review for pivotal prerequisites |
| P1 | CV workflow absent from learner app | Main input automation is unavailable | Start with pasted experience or extracted CV text, proposed skills, user confirmation, then existing evidence pipeline. Add PDF/OCR upload only when it materially improves completion |
| P1 | Lexical CV extraction has low recall | CV-first onboarding alone will leave most skills unknown | Add model-based mention detection, bounded ESCO retrieval/linking, NIL/abstention, and confirmation. Evaluate on independently reviewed held-out examples before reliance |
| P1 | Assessment delivery is external and disconnected by default | IRT code does not provide a runnable quiz experience | For the first pilot, use reviewed practical prompts with human assessment or clearly labeled self-report. Later integrate authenticated launch, delivery, scoring and reconciliation; do not call uncalibrated quizzes validated IRT |
| P1 | Learner UI lacks outcome reporting | Engine outcome priors cannot improve from this screen's activity | Add course-link events, enrollment intent, completion/dropout and usefulness feedback. Tie events to impressions; distinguish reported completion from assessed learning |
| P1 | Anonymous cookie identity only | Clearing cookies or changing devices loses profile access | For an invited pilot, choose explicit ephemeral sessions or add recoverable accounts. Provide deletion and retention behavior before collecting real CV data |
| P1 | Process-local CSRF/result maps have no global expiry | Memory grows with sessions; restarts and multiple instances lose state | Add expiry/bounds, explicit result expiry UX, and shared durable state or stateless CSRF design when deploying multiple instances |
| P1 | Explanations exist in engine but are not shown in course cards | Users cannot inspect why a course fits | Render skill gaps addressed, relevant prerequisites, constraints, uncertainties and verification date from structured engine outputs |
| P1 | Contact-only offers lack an actionable contact UI | Eligible courses without application URLs display a generic “contact provider” message | Return/display the validated email, phone or provider website matching the catalog contact route |
| P1 | Testing leaves important application gaps | Green unit tests can coexist with broken setup or UI | Add automated fresh-database migration checks, dedicated DB integration and a few browser journeys. Current `typecheck` excludes learner `.mjs`/`.js` files; add JS checking or typed boundaries |
| P1 | No CI/deployment workflow found in inspected repository | Verification is manual and deployment reproducibility is unproven | Establish a repeatable CI pipeline, health checks, structured error reporting, backups and a restore rehearsal for the pilot |
| P2 | French-only learner interface; no Arabic course selector | Backend language allowance does not mean Arabic product readiness | Start with French deliberately. Add translation, RTL and native Arabic evaluation as a separate measured release |
| P2 | Setup documentation has drift | Learner guide says 51 migrations while repository contains 57 | Generate/check migration count, document prerequisites and test exact clean-install commands |
| P2 | Catalog administration absent from learner product | Maintenance relies on scripts/SQL and specialist knowledge | Begin with a validated import command and review queue; add a small admin screen if catalog throughput warrants it |

Other operational work before public exposure: request throttling and abuse limits, database connection/query timeouts, redacted logs, session expiry cleanup, access controls, and dependency/security review. No full penetration test or dependency vulnerability audit was performed here. These are readiness gaps, not claims of confirmed exploitation.

The clean database path deserves special attention: the local bootstrap intentionally supplies only a partial, inactive ESCO release. It is not a production full-taxonomy import. The database integration test constructs a reduced schema and applies selected migration logic, so it does not substitute for replaying every migration on a fresh instance.

**4. What the measured results mean**

Simulation used seed 20260919 and 300 learners per scenario. It models hidden true skills and assumed evidence behaviors; these figures must not be used as customer performance claims.

| Scenario | Observed diagnostic result | Product implication |
|---|---|---|
| Honest/assessed evidence | 100% useful and ready recommendations; 98% reachable gap recall@5 | Logic behaves well under idealized, correct evidence |
| Skipped answers | 70% asked for more information; 28% served among those with possible useful help | Profile completeness is a major activation risk |
| Overconfidence | 16% incorrectly told goal is satisfied; only 39% of returned courses truly startable | Input evidence quality can dominate ranking quality |
| Underconfidence | 53% useful recommendations | Understatement can send learners into unnecessary training |
| CV recall modeled at 0.3 | 15% served when useful help exists | Better parsing matters, but the all-or-nothing profile gate amplifies misses |
| Experimental partial advice at CV recall 0.3 | Served rises to 79%, but 9% wrongly told done | Partial advice needs a new status and preserved unknowns; the simulation shortcut is not safe to copy directly |
| Three pilot courses hypothetically published | Best plans close only 17% of true gaps | Offer coverage and learning depth matter more than publishing a few records |

Across all scenarios, the oracle reports zero hard-constraint/publication violations. Its constraints and usefulness metrics are separate: a course can satisfy declared-profile constraints while being unsuitable for a learner whose declaration was wrong.

CV evaluation used seven excerpts overall; only four held-out excerpts with 49 annotated mentions contribute to test metrics. Annotations remain provisional, produced by one agent without independent human adjudication. No native Arabic or full-document performance was tested.

| Test metric | Preferred labels | Expanded alternatives |
|---|---:|---:|
| Extraction recall | 14.3% | 20.4% |
| Extraction F1 | 24.1% | 32.3% |
| End-to-end linking F1 | 17.2% | 16.1% |
| NIL recall | 0% | 0% |

Expanded matching accepted five matched non-NIL links and got those five correct, while accepting only 55.6% of the nine eligible matched non-NIL spans. That tiny selective result is not “100% accurate CV understanding.” Most annotated mentions are still missed, and the dataset includes many NIL mentions the alias detector never discovers.

**5. Where AI should help first**

AI should reduce input and content-production work. Keep the engine responsible for eligibility, ranking, budget arithmetic and prerequisite enforcement.

| Use | Proposed implementation | How to judge it |
|---|---|---|
| Assisted onboarding | Convert experience text into structured skill proposals with source spans; learner confirms/corrects; ask a small number of targeted follow-up questions | Time to first useful recommendation, abandonment, missed skills and correction rate |
| Catalog preparation | Extract fields from approved provider pages; attach URL/date/evidence; propose skill mappings; produce a reviewable draft | Human review minutes per publishable offer, factual error rate, eligible coverage |
| Recommendation explanation | Explain structured reasons and constraints; templates are sufficient for the first version | Factual consistency and learner comprehension |
| Question drafting | Use existing draft/review contracts to propose practical questions and rubrics | Expert acceptance and time saved; separate calibration evidence |
| Development assistance | Implement narrowly specified fixes, create meaningful regression tests, investigate failures and prepare reviewable diffs | Accepted changes and defect/rework rate, not generated code volume |

For AI extraction: validate the schema, validate concept IDs against the frozen catalog, retain source spans, and handle refusal, ambiguity and malformed output. A CV mention must not silently become a proficiency level. Avoid forcing every technology or product into an ESCO concept; preserve NIL where appropriate.

Do not begin by training a bespoke model, building a vector platform for its own sake, or replacing the deterministic ranker with unconstrained generated course lists. First measure whether a simple model call plus bounded retrieval improves the onboarding benchmark.

**6. Where agentic AI is useful**

Ordinary AI can execute a bounded extraction or explanation. An agent can choose additional steps and tools in response to intermediate results. Use that autonomy where the work actually varies.

The highest-value first agent is likely an internal catalog assistant: visit an approved provider page, detect missing fields, inspect relevant syllabus/prerequisite pages, draft a sourced offer, validate it, and place it in a human review queue. A later maintenance job can flag changed prices, dates, dead links and stale verification. Neither should mark its own content human-verified.

For the learner, start with a bounded onboarding workflow. If a conversational assistant is added, expose a small tool set such as `get_profile`, `search_catalog`, `get_missing_evidence`, `recommend`, and `draft_profile_update`. The backend binds identity and enforces authorization. Profile writes follow explicit learner confirmation; the assistant cannot assert assessment completion, change catalog publication or bypass constraints.

Use step/time/token budgets, limited retries, observable tool results, and a deterministic form fallback. Treat CV and provider-page content as untrusted data. Agents should not hold unrestricted SQL or shell access in the product. These controls follow the least-privilege and tool-validation principles in [OWASP's AI Agent Security guidance](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html).

A simple workflow is often easier to evaluate and operate than an open-ended agent. Increase autonomy only when it improves a measured task; this is consistent with [Anthropic's guidance on building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

Suggested flow:

```text
Experience text / optional CV
  -> AI proposes skills with source evidence
  -> learner confirms and supplies level evidence
  -> existing evidence resolver
  -> existing eligibility, ranking and path planner
  -> explained next step with verified course link
  -> learner feedback and learning outcomes

Approved provider sources
  -> catalog assistant drafts and validates
  -> human reviews
  -> published verified catalog
```

For AI cost control, cache catalog processing by content/version, process catalog work off the learner request path, avoid resending full CVs, and record cost and latency per successful journey. Choose providers/models using a task-specific evaluation. This audit does not establish vendor pricing, expected token use or an operating budget.

**7. Fastest credible delivery plan**

Planning estimate, not a commitment: a supervised demo in 3–5 working days; a narrow invited MVP in roughly 10–15 working days if one experienced developer and a daily available domain/catalog reviewer can work concurrently. Provider verification and review are major schedule dependencies. A solo builder or broader multilingual/assessment scope will take longer.

| Window | Deliverable | Completion condition |
|---|---|---|
| Days 1–2 | Reproducible setup and baseline | Clean database replay, integration tests, consistent environment loading, deployed preview works |
| Days 1–5, alongside engineering | Narrow catalog and role coverage | Reviewed role profiles and real offers; budget/language/prerequisite coverage matrix identifies gaps |
| Days 3–5 | Complete manual learner journey | Choose goal, answer focused questions, see explained next step, open a real course, return and give feedback |
| Days 5–8 | Better onboarding | Safe partial-profile handling and optional AI text intake with confirmation/fallback; meaningful regression tests |
| Days 8–10 | Pilot operations | Identity decision implemented, deletion/retention behavior, logging, error monitoring, backups, browser checks and basic load check |
| Days 11–15 | Observed pilot and fixes | 10–20 invited learners complete observed sessions; prioritize measured failures and confusion |

The first observed manual journey should not wait for PDF parsing or an autonomous agent. AI can be added behind the same confirmed-profile contract without rebuilding the recommendation engine.

Defer broad occupation coverage, full ESCO/ROME/O*NET research expansion, graph/sequential model training, production IRT calibration, labor-market correction products, multi-agent orchestration, payment flows, native mobile apps and comprehensive Arabic support unless a concrete pilot requirement makes one essential.

**8. MVP acceptance criteria and measurement**

These are proposed targets to negotiate after the first observed sessions, not existing performance claims:

- At least 80% of invited users complete the core flow without staff entering data for them.
- Median time to a useful next step below five minutes.
- At least 80% of in-scope pilot profiles get one genuinely actionable option; log catalog gaps separately from software failures.
- Every served course has a working enrollment/contact path and verified eligibility metadata.
- No missing skill is silently converted to zero; no incomplete target is marked fully satisfied.
- Every AI-proposed profile update is editable and explicitly confirmed.
- Engine constraint checks remain deterministic, with zero violations in regression tests.
- Record the funnel: start, goal selection, evidence completion, result display, course click, enrollment report, completion/dropout and usefulness feedback.
- Measure API/model latency, model failures, per-journey cost, human review time and catalog freshness.
- Keep self-reported satisfaction/completion separate from assessed skill gain.

A 10–20-person pilot is useful for usability and operational learning, not a statistically reliable demonstration of career or learning outcomes. Return visits and willingness to act on recommendations matter more initially than the number of AI features.

**9. File-level evidence map**

Repository-relative references below are for navigation within this report:

- `package.json`, `tsconfig.json`, `tsconfig.check.json`: available commands and checking scope.
- `learner/server.mjs`: local binding/host/origin constraints, anonymous sessions, CSRF/result maps, routes and configuration loading.
- `learner/public/app.js`, `learner/public/index.html`: French interface, forms, hidden results for incomplete profiles, course/contact rendering and absence of outcome capture.
- `src/engine/recommendation.repository.ts`, especially `recommendTarget`: any missing target skill produces an empty target skill set for ranking; persisted evidence, outcome priors and impression handling.
- `src/engine/recommendation-engine.ts`, `src/engine/learning-path-planner.ts`: ranking, eligibility, explanations and planning.
- `src/assessment/item-drafting.ts`: generation request/completion contracts and draft validation; not a bundled model-provider connection.
- `database/migrate.ts`, `database/bootstrap-local.mjs`, `database/local-esco-prerequisites.json`: migration checksums and partial taxonomy bootstrap.
- `database/migrations/047_online_learning_paths.sql`: reviewed offer eligibility requirements and learning-progress schema.
- `tests/postgres.integration.mjs`, `tests/learner.integration.mjs`: dedicated DB requirements and integration scope.
- `simulation/out/report.md`, `simulation/out/report.json`: regenerated synthetic results.
- `evaluation/cv-skills/pilot/README.md`, extractor/evaluator modules: pilot scope and reproduced metrics.
- `docs/learner-screen.md`, `README.md`: documented preview boundaries and known limitations.

**Recommended next implementation slice:** repair startup and establish a tested database; curate a narrow real catalog; deliver one complete manual journey with explanation and feedback; then add confirmed AI intake and safe partial recommendations. That sequence makes the app useful quickly while preserving its strongest engineering work.
