import json
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from gymmi.boundary import sha256
from gymmi.flow import REQUIRED_OUTPUTS

RUN=Path('runs/verified')

def test_eight_outputs_and_actual_crewai_tools():
    manifest=json.loads((RUN/'run_manifest.json').read_text())
    assert manifest['success']
    assert all((RUN/f).is_file() for f in REQUIRED_OUTPUTS)
    for name,digest in manifest['artifacts_sha256'].items():assert sha256(RUN/name)==digest
    traces=[e for e in manifest['events'] if e.get('crew')]
    assert [e['crew'] for e in traces]==['analyst','scientist']
    assert all(e['agents']==3 and e['completed_tasks']==3 and e['completed_tools']==3 for e in traces)

def test_feature_matrix_is_the_training_input_and_scaler_uses_train_only():
    data=pd.read_csv(RUN/'clean_data.csv',dtype={'record_id':str})
    features=pd.read_csv(RUN/'features.csv',dtype={'record_id':str})
    bundle=joblib.load(RUN/'model.joblib')
    metadata=json.loads((RUN/'feature_metadata.json').read_text())
    actual=bundle['pipeline'].named_steps['preprocess'].transform(data)
    np.testing.assert_allclose(actual,features[metadata['model_features']].to_numpy(),atol=1e-12)
    numeric=bundle['contract']['features']['numeric']
    means=bundle['pipeline'].named_steps['preprocess'].named_transformers_['num'].named_steps['scale'].mean_
    np.testing.assert_allclose(means,data.loc[features.split=='train',numeric].mean().to_numpy())
    assert bundle['features']==['prewk1','prewk2','prewk3','week1']

def test_two_predictive_variations_selected_using_validation_only():
    m=json.loads((RUN/'metrics.json').read_text())
    assert {'logistic','random_forest','dummy'}==set(m['test'])
    best=max(['logistic','random_forest'],key=lambda n:m['validation'][n]['average_precision'])
    assert m['selected_model']==best
    assert sum(m['split_sizes'].values())==389
    splits=m['split_record_ids']
    assert not set(splits['train'])&set(splits['test'])
    assert not set(splits['train'])&set(splits['validation'])
    assert not set(splits['validation'])&set(splits['test'])

def test_ui_prediction_and_failure_demo():
    from streamlit.testing.v1 import AppTest
    at=AppTest.from_file(Path('app.py').resolve()).run(timeout=60)
    assert not at.exception
    # Buttons include a deliberately explicit failure demonstration and a prediction form.
    next(b for b in at.button if b.label=='חשב הסתברות').click().run(timeout=60)
    assert not at.exception
    assert any('הסתברות' in m.label for m in at.metric)
    next(b for b in at.button if 'הדגם שינוי' in b.label).click().run(timeout=60)
    assert not at.exception
    assert any('עצר לפני' in s.value for s in at.success)
