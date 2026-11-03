# Interpretation review — 2026-11-03

Reviewer: the coding assistant during project development, not an independent human reviewer. This is a targeted review and rule-based regression protection, not proof that every possible false statement is detected.

## Previous live run
`runs/live-verified-20261103-193549` is preserved as captured. It ran both live crews using the old source. Its success marker describes that historical execution, not authorization to score with the new schema.

- The live prose inferred limited overfitting from similar validation/test results. That inference is unsupported: no train-error comparison was recorded and hidden participant dependence remains possible. Correct wording: **Overfitting cannot be assessed from validation/test similarity alone.**
- Counts written in English words bypassed the former digit-only prose rule. Quantities must now be exact typed claims bound to tool evidence; common English number words are rejected in narrative text too.
- Descriptive missingness and duplicate facts do not establish prospective usefulness, independence, calibration, fairness or causal benefit. Such conclusions require separate evidence.

## Changes and limits
The guard rejects common overfitting/generalization/calibration assertions and spelled-out quantities. It permits technical feature names and the explicit uncertainty sentence above. These checks are intentionally small and readable; paraphrases or other languages can evade a blacklist. A student must read the final notes and explain the assumptions.

The new task is weekly gym visits, not booked-class attendance. The source's 245 participants versus 389 records remains unresolved. Week order is inferred from field names. Identical-history grouping is a conservative stress test; a person-held-out test is impossible without person identifiers. License compliance does not establish predictive validity.

## Submission review
Check each final generated note against its scoped claims and model table, retain DATA_ATTRIBUTION.md, disclose AI assistance, and explain the target/split/limitations orally. Public release, final presentation and lecturer approval must be tracked separately from passing automated tests.


## New live run: weekly-live-final-20261103
Both crews completed provider calls with six accepted notes, both gates and all eight artifacts. Earlier attempts weekly-live-20261103 and weekly-live-reviewed-20261103 failed the guard (spelled-out quantity; unknown evidence key run_id). They remain captured locally and are not successful runs. Their API cost is not included in the successful run's usage.

Targeted semantic review of the successful run found wording to qualify, without rewriting sealed evidence:
- Engineer: “compact relative to the input representation” implies dimensionality reduction. There are four numeric inputs and four transformed features. Correct: **The representation retains the selected numeric input dimensions; scaling is not dimensionality reduction.**
- Train/card: “calibration-oriented measures” refers to probability scoring metrics. Correct: **Brier/log loss describe probability errors in these partitions; no separate calibration study was performed.**
- Publish: “Public distribution is approved” is a dataset-contract flag, not approval to publish the private repository history. Correct: **The selected Zenodo data can be redistributed under CC BY with attribution and change notices; private course materials remain excluded.**
- Analyst missingness, binary balance and repeated-history statements match measured evidence. The overfitting uncertainty sentence is appropriate. No independent human semantic sign-off is claimed.

The raw CSV was rechecked by the source-policy test: **71 columns**, not 69 as initially written in development notes. The selected clean file still has six columns (row key, four inputs, target); the correction does not change the fitted inputs or metrics.
