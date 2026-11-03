import os
os.environ.setdefault('CREWAI_TELEMETRY_DISABLED','true')
os.environ.setdefault('OTEL_SDK_DISABLED','true')
import json
import uuid
import shutil
import platform
import importlib.metadata
from datetime import datetime,timezone
from pathlib import Path
from pydantic import BaseModel,Field
from crewai.flow.flow import Flow,start,listen
from .analyst import AnalystWorkspace
from .scientist import ScientistWorkspace
from .boundary import validate_boundary,sha256,ContractError
from .crews import execute_crew
from .util import write_json
from .artifact_status import REQUIRED_OUTPUTS,MARKERS,atomic_json,begin,fail,publish

ANALYST_OUTPUTS=['clean_data.csv','eda_report.html','insights.md','dataset_contract.json']
SCIENTIST_OUTPUTS=['features.csv','model.joblib','evaluation_report.md','model_card.md']

class State(BaseModel):
    run_id:str=Field(default_factory=lambda:str(uuid.uuid4()))
    stage:str='created'
    contract_sha256:str=''
    validation_passed:bool=False

class GymmiFlow(Flow[State]):
    def __init__(self,output,raw_path=None,handoff_dir=None,live=False,break_case=None):
        super().__init__()
        if bool(raw_path)==bool(handoff_dir):raise ValueError('Supply either raw_path or handoff_dir, exclusively.')
        self.raw_path=Path(raw_path) if raw_path else None
        self.handoff_dir=Path(handoff_dir) if handoff_dir else None
        self.output=Path(output)
        self.live=live
        self.break_case=break_case
        self.events=[]
        self.output.mkdir(parents=True,exist_ok=False)
        begin(self.output,self.state.run_id)

    def event(self,stage,**facts):
        self.state.stage=stage
        e={'utc':datetime.now(timezone.utc).isoformat(),'stage':stage,**facts}
        self.events.append(e)
        with (self.output/'execution_log.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(e,ensure_ascii=False)+'\n')

    @start()
    def analyst_crew(self):
        if self.handoff_dir:
            self.event('existing_handoff_loaded')
            for name in ANALYST_OUTPUTS:shutil.copy2(self.handoff_dir/name,self.output/name)
            original=self.handoff_dir/'dataset_contract.json'
            self.state.contract_sha256=sha256(original)
        else:
            self.event('analyst_crew_started')
            workspace=AnalystWorkspace(self.raw_path,self.output,self.state.run_id)
            trace=execute_crew('analyst',workspace,self.state.run_id,self.live)
            self.state.contract_sha256=sha256(self.output/'dataset_contract.json')
            self.event('analyst_crew_completed',**trace)
        return str(self.output/'dataset_contract.json')

    @listen(analyst_crew)
    def validation_gate(self,_):
        self.event('validation_gate_started')
        if self.break_case in {'units','column','contract'}:
            import pandas as pd
            clean=self.output/'clean_data.csv'
            df=pd.read_csv(clean,dtype={'record_id':str})
            if self.break_case=='units':
                df['prewk1']=df.prewk1*100
                df.to_csv(clean,index=False)
            elif self.break_case=='column':
                df.drop(columns=['prewk2']).to_csv(clean,index=False)
            elif self.break_case=='contract':
                path=self.output/'dataset_contract.json'
                obj=json.loads(path.read_text(encoding='utf-8'))
                obj['columns']=[c for c in obj['columns'] if c['name']!='prewk2']
                write_json(path,obj)
            self.event('fault_injected',case=self.break_case)
        df,contract=validate_boundary(self.output/'clean_data.csv',self.output/'dataset_contract.json',self.state.contract_sha256)
        self.state.validation_passed=True
        self.event('validation_gate_passed',rows=len(df),contract_version=contract.schema_version)
        return self.state.contract_sha256

    @listen(validation_gate)
    def scientist_crew(self,approved_contract_sha):
        if not self.state.validation_passed:raise ContractError('Validation gate not passed. Training blocked.')
        self.event('scientist_crew_started')
        # No raw data path or Analyst workspace is passed across this boundary.
        workspace=ScientistWorkspace(self.output/'clean_data.csv',self.output/'dataset_contract.json',self.output,approved_contract_sha,
            before_train=self.feature_gate,live=self.live)
        trace=execute_crew('scientist',workspace,self.state.run_id,self.live)
        self.event('scientist_crew_completed',**trace)
        return REQUIRED_OUTPUTS

    def feature_gate(self,workspace):
        self.event('feature_gate_started')
        if self.break_case in {'feature_values','feature_rows','feature_leakage'}:
            import pandas as pd
            path=self.output/'features.csv'
            features=pd.read_csv(path,dtype={'record_id':str})
            if self.break_case=='feature_values':features.iloc[0,1]+=1
            elif self.break_case=='feature_rows':features=features.iloc[::-1]
            else:features['leaked_target']=features['attended_next_week']
            features.to_csv(path,index=False,float_format='%.17g')
            self.event('fault_injected',case=self.break_case)
        report=workspace.validate_features()
        self.event('feature_gate_passed',rows=report['rows'],features_sha256=report['features_sha256'])

    @listen(scientist_crew)
    def finalize(self,_):
        missing=[name for name in REQUIRED_OUTPUTS if not (self.output/name).is_file()]
        if missing:raise ValueError(f'Missing required outputs: {missing}')
        self.event('completed')
        self.manifest(True)
        publish(self.output,self.state.run_id)
        return str(self.output)

    def manifest(self,success,error=None,failed_stage=None):
        live_crews={e['crew'] for e in self.events if e.get('mode')=='live_llm' and e.get('completed_tasks')==3}
        requested_crews={'scientist'} if self.handoff_dir else {'analyst','scientist'}
        atomic_json(self.output/'run_manifest.json',{
            'run_id':self.state.run_id,'success':success,'stage':self.state.stage,'failed_stage':failed_stage,
            'mode':'live_llm' if self.live else 'offline_scripted_tool_fixture',
            'live_llm_completed':bool(self.live and requested_crews.issubset(live_crews)),
            'live_crews_completed':sorted(live_crews),'analyst_handoff_reused':bool(self.handoff_dir),
            'validation_passed':self.state.validation_passed,'error':error,'events':self.events,
            'contract_sha256':self.state.contract_sha256,
            'required_outputs':REQUIRED_OUTPUTS,'artifacts_sha256':{
                p.name:sha256(p) for p in self.output.iterdir()
                if p.is_file() and p.name not in MARKERS|{'run_manifest.json'} and not p.name.endswith('.tmp')},
            'python':platform.python_version(),'versions':{m:importlib.metadata.version(m) for m in ['crewai','pandas','scikit-learn','matplotlib','streamlit']},
            'requirements_reviewed':True,'fully_submission_ready':False,
            'remaining':['independent semantic review remains','public release and human PR review pending',
                'publish only licensed outputs with attribution; the prior dataset stays private']})

def run(output,raw_path=None,handoff_dir=None,live=False,break_case=None):
    flow=GymmiFlow(output,raw_path,handoff_dir,live,break_case)
    try:flow.kickoff()
    except Exception as exc:
        failed_stage=flow.state.stage
        flow.event('failed',failed_stage=failed_stage,error=str(exc),error_type=type(exc).__name__)
        flow.manifest(False,str(exc),failed_stage)
        fail(flow.output,flow.state.run_id,str(exc))
        raise
    return flow
