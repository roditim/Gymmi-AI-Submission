"""The scoring entry point verifies the complete artifact set on every call."""
import io
import json
from pathlib import Path

import joblib
import pandas as pd

from .artifact_status import ArtifactError, model_bytes, require_ready
from .contracts import VisitHistory


def predict(folder: Path, history: VisitHistory) -> float:
    folder = Path(folder)
    seal, payload = model_bytes(folder)
    bundle = joblib.load(io.BytesIO(payload))
    contract = json.loads((folder / 'dataset_contract.json').read_text(encoding='utf-8'))
    metrics = json.loads((folder / 'metrics.json').read_text(encoding='utf-8'))
    if bundle.get('run_id') != seal['dataset_run_id'] or bundle.get('contract') != contract or bundle.get('selected_model') != metrics['selected_model']:
        raise ArtifactError('Model bundle belongs to another handoff. Prediction blocked.')
    if require_ready(folder) != seal:
        raise ArtifactError('Run changed during model loading. Prediction blocked.')
    probability = float(bundle['pipeline'].predict_proba(pd.DataFrame([history.model_dump()]))[0, 1])
    if require_ready(folder) != seal:
        raise ArtifactError('Run changed during scoring. Prediction blocked.')
    return probability
