# AI-assisted assessment-item drafting

Stage 5 treats generative AI as a drafting assistant, never as an item publisher, psychometric calibrator, or learner scorer. The workflow accepts output from any model provider, validates its structure, records its provenance, and creates only `draft` / `uncalibrated` items.

## Workflow

1. A trusted author supplies a reviewed blueprint cell, learning objective, locale, and identified source material to `buildItemGenerationRequest()`.
2. The host sends the returned model-neutral prompt to its configured model. Source text is explicitly treated as untrusted content, not instructions.
3. The host parses the model's JSON and calls `validateGeneratedItemCompletion()`. Invalid candidates remain visible as rejected validation records; they never become items.
4. `engine.itemAuthoring.recordDraftBatch(authenticatedAuthorId, batch)` stores immutable model and prompt-template provenance. Accepted candidates enter `assessment_item` only as AI-assisted, uncalibrated drafts.
5. An independent subject-matter expert reviews factual accuracy, the single best answer, distractors, objective alignment, language, bias/accessibility, and source grounding. `recordExpertReview()` stores the signed checklist and rationale.
6. Only after the latest review is an approved independent expert attestation may an AI-assisted draft move to `pilot`. Publication still requires real-response calibration and all existing blueprint/item-bank gates.

The host supplies the model adapter deliberately; this package does not silently send source material to an external service.

## Generation contract

Each candidate must contain one 20-600 character stem, exactly four renderer-neutral unique options, a single answer-key index, rationales for the answer and every option, and one or more source IDs from the request. Executable/embedded markup is rejected. The audit snapshot keeps source identifiers, titles, and content hashes but not source text.

Deterministic validation cannot establish truth, fairness, language quality, or difficulty. Every accepted draft therefore carries explicit flags for expert semantic, bias, and language review and for later pilot calibration. The requested L1-L3 level is an authoring target, not an IRT difficulty estimate.

## Mandatory review gate

Migration `054_ai_assisted_item_drafting.sql` makes generation runs, candidates, and review records append-only. It also replaces the historical “any approval exists” publication check with a latest-review check. For an AI-assisted item, promotion to `pilot` or `published` requires:

- latest decision `approved`;
- reviewer role `subject_matter_expert` with explicit attestation;
- a reviewer different from the generation requester;
- every checklist field set to true.

A later rejection or revision request invalidates an earlier approval. Published items still require calibrated difficulty/discrimination parameters and a completed blueprint association. Model-generated difficulty claims are never written into calibration fields.

## Example

```ts
const request = buildItemGenerationRequest(specification);
const modelJson = await configuredModel.generate(request.prompt);
const batch = validateGeneratedItemCompletion(request, modelJson);
const recorded = await engine.itemAuthoring.recordDraftBatch(authorId, batch);

await engine.itemAuthoring.recordExpertReview(recorded.itemIds[0], expertReview);
// Promotion to pilot is a separate action and is enforced again by PostgreSQL.
```

The checked-in question-generation study found that fluent/relevant outputs were not uniformly answerable and that subjective difficulty agreement was especially weak. That evidence is why expert review and real-response calibration are separate mandatory stages here.
