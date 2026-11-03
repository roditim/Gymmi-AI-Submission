import json
import shutil
from pathlib import Path
import pandas as pd
import pytest
from gymmi.boundary import validate_boundary,ContractError,sha256
from gymmi.flow import run,REQUIRED_OUTPUTS

RUN=Path('runs/verified')

@pytest.fixture
def handoff(tmp_path):
    for name in ['clean_data.csv','dataset_contract.json']:
        shutil.copy2(RUN/name,tmp_path/name)
    return tmp_path

def test_valid_boundary(handoff):
    df,c=validate_boundary(handoff/'clean_data.csv',handoff/'dataset_contract.json')
    assert len(df)==389 and c.schema_version=='3.0'

@pytest.mark.parametrize('case,match',[
    ('column','Column schema mismatch'),('units','Possible unit change'),
    ('unknown','forbidden value'),('null_target','null value'),('duplicate','duplicate identifier'),
    ('fraction','integer required'),('byte_change','checksum')])
def test_invalid_data(handoff,case,match):
    path=handoff/'clean_data.csv'
    df=pd.read_csv(path,dtype={'record_id':str})
    if case=='column':df=df.drop(columns=['prewk2'])
    elif case=='units':df['prewk1']=df.prewk1*100
    elif case=='unknown':df.loc[0,'attended_next_week']=2
    elif case=='null_target':df['attended_next_week']=df.attended_next_week.astype('float64');df.loc[0,'attended_next_week']=float('nan')
    elif case=='duplicate':df.loc[1,'record_id']=df.loc[0,'record_id']
    elif case=='fraction':df['prewk1']=df.prewk1.astype(float);df.loc[0,'prewk1']=1.5
    elif case=='byte_change':df.loc[0,'prewk1']=int(df.loc[0,'prewk1'])+1
    df.to_csv(path,index=False)
    with pytest.raises(ContractError,match=match):validate_boundary(path,handoff/'dataset_contract.json')

@pytest.mark.parametrize('case',['missing_contract_column','leaky_feature','contract_unit_change'])
def test_invalid_or_changed_contract(handoff,case):
    path=handoff/'dataset_contract.json'
    approved=sha256(path)
    c=json.loads(path.read_text(encoding='utf-8'))
    if case=='missing_contract_column':c['columns']=[x for x in c['columns'] if x['name']!='prewk2']
    elif case=='leaky_feature':c['features']['numeric'].append('attended_next_week')
    else:next(x for x in c['columns'] if x['name']=='prewk1')['unit']='visits_per_month'
    path.write_text(json.dumps(c),encoding='utf-8')
    with pytest.raises(ContractError,match='changed after Analyst approval'):
        validate_boundary(handoff/'clean_data.csv',path,approved)
    if case!='contract_unit_change':
        with pytest.raises(ContractError):validate_boundary(handoff/'clean_data.csv',path)

@pytest.mark.parametrize('case',['units','column','contract'])
def test_flow_stops_before_scientist_and_training(tmp_path,case):
    output=tmp_path/'failed'
    with pytest.raises(ContractError):run(output,handoff_dir=RUN,break_case=case)
    manifest=json.loads((output/'run_manifest.json').read_text(encoding='utf-8'))
    assert not manifest['success'] and not manifest['validation_passed']
    assert 'scientist_crew_started' not in [e['stage'] for e in manifest['events']]
    assert not (output/'model.joblib').exists()
    assert not (output/'features.csv').exists()

def test_consumer_needs_no_raw_data(tmp_path,monkeypatch):
    from gymmi.analyst import AnalystWorkspace
    def forbidden(*args,**kwargs):raise AssertionError('Raw ingest reached from consumer')
    monkeypatch.setattr(AnalystWorkspace,'ingest',forbidden)
    output=tmp_path/'consumer'
    flow=run(output,handoff_dir=RUN)
    assert flow.state.validation_passed
    assert all((output/name).exists() for name in REQUIRED_OUTPUTS)
