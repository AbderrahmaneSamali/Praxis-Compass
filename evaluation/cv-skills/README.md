# CV skill extraction and linking benchmark

This is evaluation infrastructure, not a trained extractor or a measured improvement. The demo files are synthetic. There are no annotated real CVs in this benchmark yet.

## Collect and annotate

Start with 30–50 consented, de-identified CVs, including French, Arabic and mixed text. Keep the original extracted text unchanged after annotation: offsets refer to that exact text. Exclude contact details and identifiers; use anonymous document and subject IDs. Keep all CV versions from one person in the same split. Freeze a catalog export/version before annotation and resolve IDs against that export.

Use about two thirds for development and one third for a frozen test set, balancing languages. A second reviewer should independently annotate at least 20% and resolve disagreements before scoring. This initial sample is a diagnostic pilot; it does not establish general performance.

Annotate explicit skill mentions, including skills expressed within experience descriptions. Mark the smallest complete skill phrase, excluding surrounding punctuation. Do not annotate job titles as skills. Include a mention when it describes an actual skill even if there is no suitable catalog concept: set `skillId` to `null` (NIL). Do not invent mastery levels, resolve ambiguous mentions from job titles alone, or choose a broader concept solely to avoid NIL. Record ambiguity in a separate reviewer log and adjudicate consistently. Nested skill phrases may be annotated if each denotes a distinct explicit skill; identical spans must have one adjudicated concept.

Gold JSONL has one object per document:

```json
{"documentId":"anonymous-01","subjectId":"person-01","language":"fr","split":"test","catalogVersion":"frozen-export-id","text":"Analyse de données","annotations":[{"start":0,"end":18,"skillId":"catalog-skill-id"}]}
```

Offsets count Unicode code points, starting at zero, with an exclusive end. In JavaScript, slice `Array.from(text)`, not the UTF-16 string. Store raw text without Unicode normalization after annotation. This matters for Arabic combining marks and emoji.

Predictions JSONL:

```json
{"documentId":"anonymous-01","spans":[{"start":0,"end":18,"skillId":"catalog-skill-id","candidates":["catalog-skill-id","another-candidate"]}]}
```

Candidates are distinct catalog IDs, best first, at most ten. `skillId` is the selected ID (which must appear in candidates), or `null` for NIL. Omitted documents and empty predictions count as misses. Unknown documents, duplicate spans and out-of-range offsets are rejected. The validator cannot check membership against a catalog export; reviewers must do that when preparing gold and model outputs.

## Run and interpret

```powershell
node evaluation/cv-skills/evaluate.mjs path/to/gold.jsonl path/to/predictions.jsonl test
```

Compare a baseline and candidate extractor on the same frozen test set after tuning only on dev. Report per-language results, document and mention counts, exact-span extraction precision/recall/F1, exact-span plus concept linking precision/recall/F1, matched-span linking accuracy, ranked retrieval recall@1/3/5 and NIL precision/recall. Matched-span retrieval excludes extraction misses; use end-to-end linking to judge the complete pipeline. Undefined ratios are `null`, not perfect scores. No overlap-based partial credit is awarded.

Synthetic smoke check (never report as real CV performance):

```powershell
node evaluation/cv-skills/evaluate.mjs evaluation/cv-skills/demo.gold.jsonl evaluation/cv-skills/demo.predictions.jsonl dev
```

Track missed paraphrases, wrong concept specificity, Arabic segmentation, mixed-language mentions and false skill mentions. Extraction/linking probabilities describe model uncertainty; they must not become learner mastery or assessment confidence. When ingested as evidence, unconfirmed extracted CV skills remain unusable alone under the evidence adapter.

## Real local pilot

A separate [real-CV excerpt pilot](pilot/README.md) is available. Run `npm run cv:benchmark` from the root to reproduce its subject-separated baseline comparison. Its annotations are provisional; the synthetic files above remain synthetic.
