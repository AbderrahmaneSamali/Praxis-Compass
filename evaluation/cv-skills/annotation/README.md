# French and Arabic CV annotation and adjudication

This workflow creates human-reviewed ESCO gold data without presenting model output to reviewers. It does not turn the existing provisional labels into human gold. Reviewer IDs should be opaque project identifiers, not names or email addresses.

## Collection gate

Use only CVs with recorded consent or another documented legal basis. De-identify them before creating a batch, keep every CV version from one subject in the same split, and retain only the text required for skill annotation. The batch records both `consentStatus` and `deidentificationStatus`; the readiness audit fails when either is unresolved.

Collect real French and native-Arabic CVs. Do not translate French CVs and count the translations as Arabic observations. Treat mixed Arabic/French/English CVs as `mixed`, not as substitutes for the native-Arabic stratum. Determine a defensible sample size for the intended evaluation; the workflow's default audit only enforces the minimal presence of both French and Arabic and is not a statistical power claim.

## Independent annotation

Give the same annotation-free batch to two qualified reviewers. They must work independently and without model suggestions, then declare `annotationMethod: "manual_blind"` and `independenceDeclaration: true` in separate submission files. Every submission includes every document, even a document with no skill mentions.

Use Unicode code-point offsets with an exclusive end. Preserve the source text byte-for-byte after annotation. This is especially important for Arabic combining marks, presentation forms, tatweel, bidirectional display, ligatures, and mixed Latin tokens. Annotate the smallest complete explicit skill phrase. Use `skillId: null` for a genuine skill mention with no adequate concept in the frozen ESCO export. Do not force a broad concept merely to avoid NIL. Set `needsAdjudication: true` and add a short note when the guideline does not settle a case.

Submission shape:

```json
{
  "schemaVersion": "praxis-cv-annotation-submission-v1",
  "submissionId": "submission-r1-v1",
  "reviewerId": "reviewer-r1",
  "annotatedAt": "2026-09-20T10:00:00Z",
  "catalogVersion": "ESCO-1.2.0-fr-en-ar-labels",
  "annotationMethod": "manual_blind",
  "independenceDeclaration": true,
  "documents": [
    {
      "documentId": "anonymous-01",
      "sourceSha256": "64-lowercase-hex-characters",
      "annotations": [{"start": 0, "end": 18, "skillId": "catalog-skill-id"}]
    }
  ]
}
```

## Commands

```powershell
npm run cv:annotation -- prepare INPUT_GOLD.jsonl BATCH.json
npm run cv:annotation -- start BATCH.json REVIEWER_ID SUBMISSION_ID REVIEWER.json
npm run cv:annotation -- validate BATCH.json REVIEWER_A.json CATALOG.json
npm run cv:annotation -- compare BATCH.json REVIEWER_A.json REVIEWER_B.json CATALOG.json QUEUE.json
npm run cv:annotation -- finalize BATCH.json REVIEWER_A.json REVIEWER_B.json CATALOG.json DECISIONS.json ADJUDICATED.jsonl
npm run cv:annotation -- audit BATCH.json ADJUDICATED.jsonl
```

`compare` reports symmetric exact-span F1 and concept agreement only on exact spans. It intentionally does not report character-level Cohen's kappa because unannotated characters are not meaningful independent negative units. It creates deterministic issues of type `concept`, `boundary`, `missing_mention`, or `flagged`.

`start` refuses to create reviewer files until consent/legal-basis and de-identification gates pass. The generated submission is intentionally incomplete: the reviewer must add annotations, set `annotatedAt`, and change `independenceDeclaration` to `true` only after finishing the blind review.

The adjudicator must resolve every issue explicitly. A decision chooses reviewer A, reviewer B, a replacement annotation set, or exclusion, and records one of the controlled rationale codes: `boundary`, `catalog_specificity`, `nil`, `not_a_skill`, `guideline`, or `other`. `finalize` rejects stale queues, missing decisions, unknown ESCO IDs, changed source hashes, and duplicate spans.

Decision shape:

```json
{
  "schemaVersion": "praxis-cv-adjudication-decisions-v1",
  "queueDigest": "digest-copied-from-QUEUE.json",
  "adjudicatorId": "adjudicator-01",
  "adjudicatedAt": "2026-09-21T10:00:00Z",
  "decisions": [
    {"issueId": "issue-...", "resolution": "reviewer_a", "rationale": "catalog_specificity"}
  ]
}
```

Keep raw CVs, reviewer submissions, queues, and adjudicated datasets in access-controlled storage. Do not commit identifiable CV content to the repository.
