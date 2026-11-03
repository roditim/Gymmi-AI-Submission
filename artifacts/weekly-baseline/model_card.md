# Gymmi model card

## Purpose and intended use
Study whether any week2 gym visit is recorded, using prior visit history. This is not booked-class attendance, a causal incentive effect or authorization for an operational action.

## Training data and interface
389 cleaned study records, received exclusively through clean_data.csv and dataset_contract.json. Crew 2 never receives a raw dataset path. Target: attended_next_week, positive class 1. Fit uses 182 training records. Validation/test have 64/143 records. Selected model: logistic.

## Input features and preprocessing
Numeric: prewk1, prewk2, prewk3, week1. Categorical: . Training-only median imputation and scaling, and optional categorical encoding (no categorical inputs in this version). Identifiers, demographics, academic data and future/reward fields are excluded. features.csv contains the exact transformed numeric matrix plus explicitly labelled ID, target and split metadata, which are not model inputs.

## Evaluation
Selection uses validation average precision. Test ROC-AUC 0.8651, AP 0.7868, accuracy 0.9161, precision 0.9259, recall 0.7143, F1 0.8065, Brier 0.1176. See evaluation_report.md for logistic, random forest and dummy comparisons. No refit on validation or test.

## Limitations and ethics
- CC BY 4.0 requires attribution and identification of changes; see DATA_ATTRIBUTION.md.
- The source description says 245 participants but the file has 389 rows; no unique-person count is claimed.
- No participant identifiers or exact dates are available; equal-history groups do not prove person independence.
- Relative week ordering and availability of prewk1-prewk3 before week1/week2 are assumptions based on source names.
- The target is any week2 visit, not a booked-class no-show or a causal incentive effect.
- The grouped split is a conservative history-pattern stress test, not a temporal or participant-held-out evaluation.
- This small university experiment does not establish performance in a new gym.
- The test is descriptive after validation selection, not an independent external evaluation.

- The demographic and protected-attribute data needed for a fairness audit are absent. No fairness claim is made.
- Predicted probabilities have not been separately calibrated. Brier and log loss do not prove calibration in a new club.
- No contact or operational action is performed. Human review would be required for any downstream use.
- Contract checks detect missing columns, invalid values, ranges and post-publication edits. They cannot prove that a plausible value has the correct real-world meaning or that a source field was collected before the outcome.
- Derived outputs use the licensed source with attribution and modifications documented in DATA_ATTRIBUTION.md; no new-population performance claim is licensed by that fact.

## Execution disclosure
The CrewAI Flow and deterministic data/science tools execute locally. This run uses scripted LLM fixtures with author-written notes. It is not evidence of live generative-agent reasoning.


## Structured agent review (offline_author_written_fixture)
Qualitative statements still require human review. Numeric claims are checked against scoped evidence.

### card
Offline author-written analysis fixture grounded in the scoped tool evidence; no live reasoning is claimed.
- Predictions support an educational demonstration rather than operational cancellation.
- Saved holdout results are descriptive because earlier development exposed the holdout.
- CC BY attribution is required; future generalization and person independence remain unproven.
- Evidence `selected_model`: `"logistic"`
- Evidence `selection_metric`: `"validation_average_precision"`
