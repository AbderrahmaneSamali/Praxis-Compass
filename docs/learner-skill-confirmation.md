# Learner confirmation of CV-extracted skills

The confirmation workflow is a trust boundary between probabilistic CV extraction and learner evidence. The host application must authenticate the learner; never accept a learner ID chosen by the browser. Build requests on the server from linked extraction proposals and the same frozen ESCO catalog used by the extractor.

`buildLearnerSkillConfirmationRequest()` groups repeated mentions of one skill into a single card, retains source snippets for learner review, and omits retrieval/ranking scores. The learner must respond to every card with one of four actions:

| Action | Meaning | Mastery evidence |
|---|---|---|
| `confirm` | The suggested catalog skill is correct. | Only when the learner separately selects and attests an L1–L4 level. |
| `reject` | The text does not represent this learner's skill. | None. |
| `correct` | A different skill from the frozen catalog is correct. | Only with a separately attested level. |
| `unsure` | The learner cannot decide. | None. Route to review or assessment. |

Confirmation of presence does not imply L1, and rejection does not imply L0. An absent response is neither rejection nor confirmation. When a confirmed or corrected skill has no level, the result lists it in `needsLevelSkillIds` and creates no `SkillEvidence` draft.

A declared level must reference the exact displayed `praxis-mastery-rubric-v1` rubric and include `levelAttestation: true`. Host applications need reviewed French and Arabic presentations of that rubric; they must not silently substitute machine-translated anchors. The resulting `cv_extracted_confirmed` evidence remains low-authority self-report, not assessed mastery.

Requests and results carry deterministic integrity hashes. Applying a response rejects stale catalog versions, changed request cards, foreign learner IDs, duplicate or missing answers, invalid corrections, unattested levels, and multiple cards resolving to the same skill. Evidence provenance excludes CV snippets and records the request, card, source proposal/evidence IDs, catalog, algorithm and rubric versions.

The domain function returns evidence drafts rather than writing them automatically. A trusted host can call `engine.confirmations.record(result)` to persist the decision and append any evidence atomically. Migration `052_learner_skill_confirmation.sql` stores all four actions in append-only records, resolves ESCO URIs to local skills, verifies referenced raw evidence belongs to the authenticated learner, supersedes confirmed raw evidence, and uses `idempotencyKey` to prevent duplicate evidence. Use `engine.confirmations.decidedProposalIds(learnerId)` to remove already answered proposals from later requests. Rejections and uncertain responses are retained so the learner is not repeatedly prompted about the same extraction. Persisted snapshots exclude raw CV snippets.
