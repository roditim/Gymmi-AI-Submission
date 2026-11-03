import json
from pathlib import Path
import numpy as np
import pandas as pd
from gymmi.data import load_clean, PRIMARY, SHA256, LICENSE
from gymmi.boundary import sha256


def test_target_is_next_week_and_only_history_is_exposed():
    raw,clean=load_clean('data/fitness_clean_deid.csv')
    assert sha256('data/fitness_clean_deid.csv')==SHA256
    assert LICENSE=='CC-BY-4.0'
    assert clean.columns.tolist()==['record_id',*PRIMARY,'attended_next_week']
    np.testing.assert_array_equal(clean.attended_next_week,(raw.week2>0).astype(int))
    assert clean.record_id.is_unique
    assert len(clean)==389 and len(raw.columns)==71


def test_licensed_contract_does_not_claim_person_independence():
    c=json.loads(Path('runs/verified/dataset_contract.json').read_text())
    assert c['source']['raw_sha256']==SHA256
    assert c['source']['doi']=='10.5281/zenodo.18866086'
    assert c['license_status']=='CC-BY-4.0'
    assert c['features']['numeric']==PRIMARY and not c['features']['categorical']
    assert any('245' in text and '389' in text for text in c['assumptions'])


def test_versioned_baseline_is_complete_and_current():
    from gymmi.artifact_status import require_ready
    seal=require_ready(Path('artifacts/weekly-baseline'))
    assert seal['version']==2
