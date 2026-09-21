# Task-network crosswalk proposals

Stage 7 creates auditable candidate links between task-like nodes in frozen ESCO, ROME, and O*NET releases. It does not modify a source taxonomy, create a canonical mapping automatically, infer learner proficiency, or add recommendation edges.

## Why task networks

Occupation titles and codes hide changes in actual work. The local paper *Enabling Workforce Intelligence through Occupational Taxonomy Alignment* models occupations as collections of tasks and reports that combining task-text semantics with task-network structure can recover useful top-k occupation alignments while retaining soft, many-to-many matches. It also documents systematic errors for occupations with unusually small task subnetworks. PRAXIS therefore preserves separate evidence components, ambiguity, and sparse-context flags rather than treating a nearest text match as truth.

The first implementation is intentionally deterministic and inspectable. It scores four versioned inputs supplied by the caller:

- same-language task text overlap;
- shared reviewed occupation anchors;
- shared governed skill anchors;
- shared versioned task-network context IDs.

No machine translation is performed implicitly. A translated text may be used only as a `parallel_translation` with its own provenance. Raw within-taxonomy neighbour IDs are not accepted as shared context because identical-looking local IDs do not establish cross-taxonomy equivalence.

## Decision contract

Every source node receives a top-k candidate list and exactly one outcome:

- `proposed`: the best candidate clears both the proposal score and ambiguity-margin policies;
- `nil`: no candidate clears the minimum plausibility threshold;
- `abstained`: evidence is plausible but weak or ambiguous.

All thresholds and component weights are caller-supplied, versioned, validated, and stored in the immutable input snapshot. The function has no hidden threshold defaults. Candidate relation labels (`equivalent`, `source_narrower`, `source_broader`, or `related`) are suggestions only. `source_narrower` means the source task's governed scope anchors form a strict subset of the target's; a human must still confirm semantics and direction.

```ts
const batch = proposeTaskNetworkCrosswalk({
  sourceNodes,
  targetNodes,
  computedAt: new Date(),
  policy: {
    version: 'task-crosswalk-pilot-v1',
    topK: 5,
    minimumCandidateScore: 0.35,
    minimumProposalScore: 0.72,
    minimumProposalMargin: 0.12,
    minimumTextScoreForDirectionalSuggestion: 0.6,
    weights: { text: 0.5, occupationContext: 0.2, skillContext: 0.2, networkContext: 0.1 },
  },
});

await engine.taskCrosswalks.recordBatch('task-crosswalk-generator-v1', batch);
```

## Human adjudication

The migration stores frozen source nodes, the full ranked candidate set, explicit NIL/abstention outcomes, score components, evidence, hashes, and the generation principal. All records are append-only.

Reviewers use `praxis.task_network_crosswalk_blinded_review_queue`. It deliberately hides model rank, score, and suggested relation to reduce automation bias. Approval requires an independent reviewer, a reviewer-selected relation, rationale, release verification, and completed semantic-scope, occupational-context, and direction checks. The reviewed view is many-to-many and directional. Nothing promotes it into the skill catalog or recommender automatically.

Before using these judgments in Stage 8 experiments, evaluate precision/recall by relation, taxonomy pair, language, occupation family, task-network size, and missing-context flags against a separately adjudicated sample. Keep experimental graph edges isolated from production recommendations until real learner outcome evidence and prospective evaluation exist.
