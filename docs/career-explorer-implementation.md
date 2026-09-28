# Career exploration implementation

## Decisions — 26 September 2026

- Work in the standalone repository and preserve existing uncommitted work.
- Learner inputs remain database-backed selections; no new free-text intake.
- **France and Morocco need separate progression frameworks**, confirmed by the user during implementation. Do not reuse a French level classification as evidence of a Moroccan level.
- A selected professional domain is a hard scope. Banque and Finance remain separate selections. Broader or adjacent exploration must be explicit in a future interface.
- Publish role-level claims only with a reviewed framework. A source occupation, a managerial flag or a job title is not a Senior/Lead/Staff competency framework.

## First working increment

- Complete candidate retrieval replaces the repository's former eight-per-source cap. The six-item priority overview is separate from the full explorer.
- Full domain coverage includes the learner's current occupation when it belongs to that domain.
- Occupation profiles and requirements load in batches instead of per-occupation queries.
- `buildCareerGraph` projects the complete candidate set into bounded graph pages. Nodes and edges retain source references and requirement states. No inferred prerequisites or level edges.
- `POST /api/exploration/graph` accepts page, pageSize, expandedIds, skillPage, skillState, skillKind and filter. It uses the authenticated learner, same-origin/CSRF checks and candidate membership checks; it accepts no learner ID or arbitrary SQL.
- Interactive SVG graph: up to three expanded occupations, shared requirements, source inspection, zoom/pan, requirement filters and pagination. Occupation and requirement tables provide the same facts without needing the canvas.
- Expansions stay visible when moving between career pages. All skill pages are reachable. Shared-skill counts refer to the full candidate scope, not only the visible page.
- Evidence states remain self-reported practice / development needed / unknown / conflicting. No readiness percentage is generated.

## Career levels — implemented 27 September 2026

- User decision: **keep France and Morocco content as drafts for now**. No real framework has been reviewed or published. Pilot content is limited to Banque and Finance, not all catalogue occupations.
- Migration 066 adds country/track catalogues, versioned occupation-family frameworks, explicit occupation-level applicability, requirements, assessment criteria, source references and directed transitions.
- Draft → reviewed → retired lifecycle: independent reviewer, recorded decision and content hash; published content is immutable. A later revision requires a new framework version. Publication rejects missing applicability/evidence criteria, out-of-family mappings, incorrect transition kinds and cycles.
- `CareerLevelRepository` keeps country, track and occupation scopes separate. The learner declares a current level and selects a target from reviewed database options. Selecting a goal creates no skill evidence, readiness score, or cross-market equivalence. Goals remain separate per occupation/country. Retired or filtered-out goals are marked unavailable.
- App country/track selectors, level details, explicit progression graph plus accessible transition table, goal save/clear controls, and source/limitation panels are implemented. Drafts never appear in learner endpoints, graph coverage or target choices.
- Four draft proposals (France/Maroc × Banque/Finance), 24 proposed levels, 96 requirements and 96 evidence criteria. Editorial proposals are identified separately from source context. See [review pack](career-level-framework-review.md) and its structured JSON exports.
- Operator seeding: `npm run career:drafts` after importing source occupations. Existing drafts are not overwritten. Review is an operator-only service, with no learner publication route. Do not approve the drafts until a later explicit decision and actual specialist review.
- Verification: unit suite; database lifecycle/country/goal isolation tests; HTTP session/CSRF/candidate checks; fresh-schema migration before source ingestion; live unavailable-state UI; reviewed UI simulated in memory only, without publishing database drafts.
- Migration 066 was refined during this unreleased development turn to allow an empty source catalogue. The two local development databases already had the same seeded families, so only this turn's recorded 066 checksum was reconciled after checking its previous hash and family rows. Earlier migrations were untouched.

## Remaining validation and content work

The planned engineering stages are implemented. Live provider quality comparisons, independent learner-usefulness review, specialist-agent experiments justified by that review, and reviewed content beyond the current pilot remain pending.

Content review and wider occupation coverage remain separate pending work: the pilot draft descriptors are not yet a validated progression framework for either market.

## Development activities — implemented 27 September 2026

- Migration 067 extends the title-only action registry with immutable activity versions, explicit country/occupation scopes, source skill links, supplied case data, ordered task steps, prerequisites, assessment criteria and database-backed answer options.
- Lifecycle: draft, pilot, independently reviewed, retired. Pilot enablement has its own recorded decision and is not represented as an independent review. Six original exercises are testable as labelled pilots. The four career frameworks remain drafts.
- Pilot scope: C1202/C1214 credit preparation and a cash-flow scenario; C1301/C1302 operation reconciliation and a controlled correction; C1207 team allocation; C1302 quality indicators. France and Morocco are explicitly listed. The fictional rules do not assert either country's regulations or an equivalence of career levels.
- A named predecessor exercise can be required, or practice can explicitly need confirmation. Unknown/conflicting practice remains unknown. Taxonomy parenthood, a selected career level or a similar title cannot create a prerequisite or satisfy one.
- Learner flow replaces the generated generic cards with concrete catalogue exercises for source occupations. It shows materials, steps, required predecessors, criteria, selectable answers, feedback and retry state. Uncovered occupations get an explicit unavailable state.
- Results are deterministic outcomes of the fictional case, not verified professional competence. No activity route writes to skill evidence, confirmations or career-level goals. Published framework links are shown only for the matching reviewed framework, occupation and country; draft links remain hidden.
- Completion attempts are append-only and record the exact version, content hash, prerequisite snapshot, per-criterion choices/results and an idempotency key. Retries cannot duplicate a submission. A successful exercise unlocks only the explicit successor in the same occupation and country. Withdrawal blocks further use but retains history. Normal learner erasure can cascade.
- Unit checks cover arithmetic/case keys, malformed submissions, prerequisite states and content hashes. PostgreSQL/HTTP checks cover publication guards, immutable content, versioned outcomes, source-free migration, scope isolation, no mastery side effects, concurrent retries and learner erasure. Browser QA used a separate test learner/database, completed a partial attempt, retried successfully and opened the newly available sequel; the user's learning history was untouched.
- [Pilot catalogue and review requirements](development-activity-review.md). `npm run activities:drafts` prepares content without exposing it; `npm run activities:pilots` enables original cases for testing. `npm run test:activities` uses `PRAXIS_LEARNER_TEST_DATABASE_URL` pointing to a migrated/source-loaded dedicated `_test` database. Independent pedagogical/market review is still needed before promoting pilots to reviewed content.

## Gap analysis and milestones — implemented 27 September 2026

- Migration 068 stores immutable development cases: normalized input facts, full calculated plan, source release, exact exercise/framework versions, direct confirmation IDs, exercise attempt IDs, accepted/ignored evidence references, algorithm/schema versions, and SHA-256 input/output hashes. Deleting a learner can erase their cases through the existing cascade.
- `DevelopmentPlanRepository` captures membership, requirements, current country/track/goal, direct confirmations, evidence and activity results in one repeatable-read transaction. Identical captures deduplicate; concurrent conflicts retry the complete capture. Replaying a case uses only its frozen facts, rejects changed hashes or an unsupported version, and compares the calculated output hash. Replay does not re-grade exercises or re-run the evidence adapter: their recorded results and adapter version form the normalized inputs.
- The pure `buildDevelopmentPlan` separates unknown practice, declared practice, declared development needs, contradictions and available assessed evidence. Source catalogue requirements have no numerical mastery target. Reviewed career requirements have explicit behavior/criteria but no connected criterion-validation service yet. Neither successful exercises nor a selected/current level establish mastery or readiness.
- Evidence uses exact IDs only; no PRAXIS/ESCO-to-source crosswalk is invented. Inferred CV evidence does not become declared practice; an explicit zero remains a development need. Direct source confirmations must come from the active release. Assessed evidence and resolved disagreements remain visible without asserting equivalence to a career-level behavior.
- Exercise milestones follow only stored prerequisites, include necessary predecessor exercises, and preserve unknown/unavailable entry requirements. Any passing attempt of the exact active version in the same occupation/country can complete that exercise milestone. Failed later attempts remain in the case. Withdrawn predecessors block future progression; historical cases still replay.
- A selected reviewed career goal contributes only its own explicit requirements and criteria. Level order and transition edges do not imply inherited requirements, equivalence, or readiness. Draft/retired/other-market goals never enter a new case. The four real France/Morocco frameworks remain drafts.
- Learner step 05 is now **Mon plan de développement**: a target summary, four prioritized next steps, exercise dependency cards, the complete filterable requirement table, gaps in exercise/assessment coverage, immutable history and a replay verification button. Existing selection-only confirmation and exercise controls are linked; completing an exercise refreshes the plan. Archived cases are labelled and contain no live action links.
- HTTP: `POST /api/development-plan` accepts only `codeRome`; POST `/api/development-plan/replay` accepts only `caseId`; GET `/api/development-plan/cases/:id` returns owner-only history; GET `/api/development-plan/history?codeRome=...&offset=...` provides pages of 20. The session determines ownership; mutations use existing same-origin/CSRF controls. No client-supplied score or learner ID is accepted.
- Development cases are the validated inputs to the complete multi-target report described below. No model calls are required.
- Verification: six pure-policy/replay tests, three database/HTTP tests (including an empty source schema and rollback-only reviewed framework), existing learner/activity integration checks, and the unit suite. Browser QA used an isolated test learner: exercise completion changed 0/3 to 1/3 and unlocked the explicit successor while 51 unknown requirements stayed unknown; filters, historical 0/3 state, current state and replay were checked.

## Complete reports — implemented 27 September 2026

- Migration 069 stores owner-scoped immutable `career-report-v1` snapshots. A report captures the complete candidate set in the selected domain, the six-item priority overview, source release, profile/context choices, and one to three learner-selected targets. Identical facts deduplicate by content hash; new facts create a new snapshot. Learner erasure cascades to reports.
- Each selected target includes its frozen development-plan input and output, every occupation requirement and evidence state, exercise dependencies, available concrete activities, and exact source/version references. The complete candidate appendix includes requirements for every candidate, not merely the six priority cards or the displayed graph page.
- The same verified block document renders the readable HTML and A4 PDF. Historical exports read only their saved snapshot; they do not silently substitute newer catalogue content. A replay check validates snapshot hashes, candidate scope, the exact plan calculation, requirement membership/states, and activity publication state.
- Learner step 06, **Mon rapport**, offers database-backed candidate checkboxes and accepts one to three targets. Saved reports have a history, HTML view, PDF download and verification action. Creation accepts only target codes; ownership follows the session and mutations require same-origin/CSRF controls.
- Career-level analysis is shown only when a reviewed country-specific framework and goal exist. The four France/Morocco pilot frameworks remain drafts, so current reports explicitly mark level analysis unavailable. Pilot exercises remain labelled as pilots. Neither a passing exercise nor a report establishes professional mastery or readiness.
- This stage is deterministic and makes no provider or agent calls. It prepares validated report facts for the later bounded NVIDIA coordinator.

## Bounded NVIDIA coordinator — implemented 27 September 2026

- Migration 070 stores owner-scoped assistant runs, report/content hashes, status, model/tool call counts, a validated structured result and metadata-only events. Prompts, raw model responses, credentials and unrestricted profile text are never stored. An active-run uniqueness guard permits only one concurrent run per learner. Learner erasure cascades.
- A run begins only from a verified immutable report selected by the learner. Its tools read frozen report projections: target summaries, up to 12 requirements per target, activity paths and source references. There is no SQL, arbitrary URL, client-supplied prompt or browser-exposed tool execution.
- Gemma 4 31B IT uses the [NVIDIA chat completion endpoint](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer), including bounded [202 status polling](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-statuspolling). The model-specific reference does not list native `tools` or `tool_choice` fields, so this implementation uses a strict JSON request/response protocol managed by PRAXIS. A provider capability test is still required before changing to native function calling.
- Budgets: at most four model requests and three tool reads, 25 seconds per provider request and 60 seconds per run. Polling exposes progress; cancellation aborts the local provider request and leaves no result. Interrupted runs become failed after their deadline.
- The model can propose only an ordering of the one to three selected targets and one *ready* milestone per target. The tool presents the deterministic plan's four prioritized next steps first. Every identifier is checked against the saved report, then learner-facing text is rendered from the report's own labels, states and sources. A button opens the current exercise or confirmation screen when the historical target still belongs to the learner's present exploration. Raw model prose and invented readiness or seniority claims never reach the learner.
- `NVIDIA_API_KEY` is optional in `.env`; if absent, the assistant panel explains that it is unavailable while deterministic exploration, reports and PDFs remain usable. The API key is held server-side. The older `/api/agent-gateway/compare` remains a deterministic fixed chain.
- Tests include malformed model requests, out-of-scope tools and milestones, provider 202 polling, owner/session and CSRF isolation, success trace, concurrent-run guard, cancellation and call-budget failure using a simulated provider. A live NVIDIA invocation remains pending until a key is configured in this checkout.

## Market-specific journey evaluation — implemented 28 September 2026

- `npm run evaluate:career-journeys` runs six predefined fictional journeys through the real HTTP service, catalog, report capture and pilot exercise grading in a dedicated `_test` database. Temporary learners are erased after the run. Credentials, session cookies and learner identifiers are not exported.
- France and Morocco are evaluated separately for credit dossier preparation, team allocation and operations reconciliation. These mirrored cases test country separation, not independently reviewed local labor-market applicability. All source-domain occupations remain visible: 17 in Banque and 6 in Finance in the active source release.
- The first run exposed an ordering issue: only 2/6 starting occupations appeared in the first five recommendations. The direction policy now uses a declared starting occupation as an explicit signal after confirmed interests/practice, without admitting it outside the selected domain. The updated policy is registered as `praxis-direction-recommendations-v2`; starting visibility is now 6/6. This metric is about continuity visibility, not accuracy of career suitability.
- Final run: 80/80 source, action and claim checks; 22/22 boundary checks included in that total; 2/2 exercise progression episodes. The successor unlocks only in the same market; unknown requirements remain unknown; historical report state stays frozen; draft career goals and cross-domain reports are rejected; an absent market yields a country-choice milestone.
- The independent oracle has corruption tests for incorrect scope, missing candidates, wrong markets, unavailable actions, false mastery, and blocked successors. The full unit suite passed 160 tests with one optional source-archive test skipped. Build and typecheck passed.
- `--with-nvidia` optionally runs two bounded three-target Finance comparisons, with at most eight total model requests. It generates blind A/B review packets and a separate answer key. The default run makes zero model requests. Provider quality is not established until live runs and independently labelled usefulness reviews are available.
- Decision: do not introduce specialist agents yet. Passing catalog and safety checks does not establish a quality gain from more agents. France/Morocco career-level content remains draft. See the [evaluation runner, preset gates and review rubric](../evaluation/career-journeys/README.md); generated results are in `evaluation/career-journeys/out/`.

## Verification

- Unit coverage: complete candidate and skill pagination; current occupation; hard domain scope; real requirement edges; evidence state preservation; kind/state filters; expanded-target pinning; invalid options.
- Database integration: candidate count equals the source domain count (Banque), every candidate can be paged through, expansion returns sourced requirements, cross-session and invalid-scope expansion is rejected.
- The source archive integration test is optional and already accepts `ROME_SOURCE_ZIP`.
- Migrations 064/065 were already applied to the standalone database; their checksums were verified without editing or reapplying them.
