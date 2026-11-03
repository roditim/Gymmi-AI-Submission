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
The file metrics.json includes confusion matrices, no-show F1, log loss and a conditional bootstrap interval.

## Structured agent review (offline_author_written_fixture)
Qualitative statements still require human review. Numeric claims are checked against scoped evidence.

### train_compare
Offline author-written analysis fixture grounded in the scoped tool evidence; no live reasoning is claimed.
- Model selection uses validation evidence rather than the final test ranking.
- The majority reference makes accuracy alone inadequate for comparison.
- CC BY attribution is required; future generalization and person independence remain unproven.
- Evidence `selected_model`: `"logistic"`
- Evidence `selection_metric`: `"validation_average_precision"`
