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

- Demographic and protected-attribute source columns are excluded from this modelling interface. No fairness claim is made.
- Predicted probabilities have not been separately calibrated. Brier and log loss do not prove calibration in a new club.
- No contact or operational action is performed. Human review would be required for any downstream use.
- Contract checks detect missing columns, invalid values, ranges and post-publication edits. They cannot prove that a plausible value has the correct real-world meaning or that a source field was collected before the outcome.
- Derived outputs use the licensed source with attribution and modifications documented in DATA_ATTRIBUTION.md; no new-population performance claim is licensed by that fact.

## Execution disclosure
Live LLM mode was selected for this Scientist crew. Deterministic tools perform the data and model work. The final run_manifest.json records whether the requested live crews completed; scientist_review.json records validated provider-generated notes.


## Structured agent review (live_llm)
Qualitative statements still require human review. Numeric claims are checked against scoped evidence.

### card
The card step completed and produced a selected model with validation-based choice. The evidence supports a narrow interpretation: the selected model is logistic, the split is not chronological or member-based, and refitting on validation or test did not occur. Validation and test evidence both show stronger ranking than the baseline, while class-specific behavior differs across splits. Overfitting cannot be assessed from validation/test similarity alone.
- The selected model is logistic and was chosen by validation average precision.
- The split is not chronological or member-based, and there was no refit on validation or test.
- Validation evidence favors the selected model over the baseline on ranking and calibration-oriented measures.
- Test evidence shows stronger ranking than the baseline, but class-specific behavior differs across models and splits.
- This evidence does not establish deployment readiness, because it reports comparison metrics rather than operational outcomes.
- Missingness, leakage, and intended-use alignment are not resolved by this artifact alone.
- Evidence `selected_model`: `"logistic"`
- Evidence `selection_metric`: `"validation_average_precision"`
- Evidence `split_sizes.train`: `182`
- Evidence `split_sizes.validation`: `64`
- Evidence `split_sizes.test`: `143`
- Evidence `chronological_or_member_split`: `false`
- Evidence `refit_on_validation_or_test`: `false`
- Evidence `validation.logistic.average_precision`: `0.8645938535385378`
