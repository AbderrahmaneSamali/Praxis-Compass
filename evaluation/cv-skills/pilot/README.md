# Real local CV excerpt pilot

Run `npm run cv:benchmark` from the project root. No model API, upload, or database is required. The command builds the engine, writes predictions for preferred-label and multilingual-alternative-label matching through the versioned retrieve/rank decision contract, and writes `results.json` with separate development and test metrics.

## Data card

- Seven real local CVs, seven distinct subjects, 92 manually annotated skill mentions.
- Three development subjects and four test subjects; no subject appears in both splits.
- Six French excerpts and one mixed French/English technical skills excerpt. There are no native Arabic CVs in this pilot.
- Only deidentified skill-section excerpts are included. Names, contacts, employment history, source paths and the original PDFs are excluded. Opaque source SHA-256 hashes preserve local source provenance. This is a local working dataset, not a public redistribution release.
- Annotations were produced by a single agent and are provisional. Independent human adjudication has not occurred. Test scores are descriptive pilot results, not a validated performance estimate for a population.
- Catalog: frozen official ESCO 1.2.0 French, English and Arabic preferred and alternative labels, with 14,696 skill concepts and 3,046 occupation concepts. Skills are linked using canonical concept URIs. Source archive SHA-256: `49526f51ea5a26126c866e010c5552e1af084ed3eb5a53e1a3602bc06957d66d`.
- Original extracted spelling and ligatures are preserved. Offsets use Unicode code points. Product names with no sufficiently exact catalog concept are marked NIL; broad concepts are not forced onto unsupported product names. Review broad soft-skill mappings and NIL decisions before using this as adjudicated gold.

## Measured test results

Four held-out excerpts contain 49 gold mentions. The current preferred-label baseline has extraction F1 24.1% and end-to-end linking F1 17.2%. Expanded multilingual alternatives have extraction F1 32.3%; ranked candidate retrieval reaches 100% recall@3 on the nine matched non-NIL spans. The conservative policy accepts five of those nine links (55.6% coverage), gets all five accepted links right, and abstains on six of thirteen total predictions; end-to-end linking F1 is 16.1%. Neither exact-alias detector discovers unknown mentions, so NIL recall remains zero. These are frozen-test diagnostic measurements, not threshold-tuning targets or evidence of production quality.

These baselines expose missing aliases, abbreviation recognition, product/NIL detection, and ambiguous links. The retrieval/ranking boundary is now ready for a trained detector, bi-encoder retriever, and cross-encoder ranker, but none is bundled yet. Any learned replacement must be developed on the development split and evaluated on a larger independently adjudicated test set. Do not infer learner proficiency from these mentions. Do not claim full-PDF or Arabic performance from this dataset.
