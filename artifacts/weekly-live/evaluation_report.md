# Evaluation report

Selected variation: **logistic**, selected by validation average precision only.
Positive class: attended_next_week=1. Split: 182 train / 64 validation / 143 test.
Exact normalized input duplicates share a split. This is not a temporal or participant-level split.
Preprocessing is fit on training only. F1 threshold grid .10-.90 step .01 uses validation only.

| Variation | Validation AP | Threshold | Test AUC | Test AP | Accuracy | Precision | Recall | F1 | Brier |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| logistic | 0.8646 | 0.36 | 0.8651 | 0.7868 | 0.9161 | 0.9259 | 0.7143 | 0.8065 | 0.1176 |
| random_forest | 0.8504 | 0.19 | 0.8664 | 0.7925 | 0.2448 | 0.2448 | 1.0000 | 0.3933 | 0.1144 |
| dummy | 0.5938 | 0.50 | 0.5000 | 0.2448 | 0.2448 | 0.2448 | 1.0000 | 0.3933 | 0.3103 |

The test is descriptive after validation selection. The result is conditional on this one dataset and split.
No production calibration, fairness, business benefit or causal reminder effect has been established.
The file metrics.json includes confusion matrices, no-visit F1, log loss and a conditional bootstrap interval.

## Structured agent review (live_llm)
Qualitative statements still require human review. Numeric claims are checked against scoped evidence.

### train_compare
The comparison step completed and produced a selected model with validation-based choice. The evidence supports a narrow interpretation: the selected model is logistic, the split is not chronological or member-based, and refitting on validation or test did not occur. Validation and test evidence both show stronger ranking than the baseline, while class-specific behavior differs across splits. Overfitting cannot be assessed from validation/test similarity alone.
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
