"""Consumer workspace receives ONLY clean data and its public contract interface."""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.dummy import DummyClassifier
from sklearn.metrics import (accuracy_score,balanced_accuracy_score,precision_score,recall_score,
    f1_score,roc_auc_score,average_precision_score,brier_score_loss,log_loss,confusion_matrix)
from .boundary import validate_boundary,ContractError,sha256
from .util import write_json
from .feature_gate import build_design,feature_metadata,validate_features
from .artifact_status import ensure_incomplete,fail

def metrics(y,p,t):
    pred=(p>=t).astype(int)
    return {'accuracy':float(accuracy_score(y,pred)),
        'balanced_accuracy':float(balanced_accuracy_score(y,pred)),
        'precision':float(precision_score(y,pred,zero_division=0)),
        'recall':float(recall_score(y,pred,zero_division=0)),
        'f1':float(f1_score(y,pred,zero_division=0)),
        'roc_auc':float(roc_auc_score(y,p)),
        'average_precision':float(average_precision_score(y,p)),
        'brier_score':float(brier_score_loss(y,p)),
        'log_loss':float(log_loss(y,p)),
        'f1_no_visit':float(f1_score(1-y,1-pred,zero_division=0)),
        'confusion_matrix_labels_0_1':confusion_matrix(y,pred,labels=[0,1]).tolist()}

class ScientistWorkspace:
    def __init__(self,clean_path,contract_path,output,approved_contract_sha,before_train=None,live=False):
        self.clean_path=Path(clean_path)
        self.contract_path=Path(contract_path)
        self.output=Path(output)
        self.approved_contract_sha=approved_contract_sha
        self.before_train=before_train
        self.live=live

    def engineer(self):
        ensure_incomplete(self.output)
        self.df,self.contract=validate_boundary(self.clean_path,self.contract_path,self.approved_contract_sha)
        c=self.contract
        design=build_design(self.df,c)
        self.splits=design.splits
        self.pre=design.preprocessor
        self.x=design.values
        self.feature_names=design.names
        y=self.df[c.split.target]
        engineered=pd.DataFrame(self.x,columns=self.feature_names)
        engineered.insert(0,c.split.id_column,self.df[c.split.id_column].to_numpy())
        engineered[c.split.target]=y.to_numpy()
        engineered['split']=''
        for name,idx in self.splits.items():engineered.loc[idx,'split']=name
        engineered.to_csv(self.output/'features.csv',index=False,float_format='%.17g')
        write_json(self.output/'feature_metadata.json',feature_metadata(design,self.contract_path))
        return ['features.csv']

    def validate_features(self):
        design,report=validate_features(self.clean_path,self.contract_path,
            self.output/'features.csv',self.output/'feature_metadata.json',self.approved_contract_sha)
        self.df,self.contract=design.data,design.contract
        self.splits,self.pre=design.splits,design.preprocessor
        self.x,self.feature_names=design.values,design.names
        write_json(self.output/'feature_validation.json',report)
        return report

    def train_compare(self):
        run_id=ensure_incomplete(self.output)
        try:
            return self._train_compare()
        except Exception as exc:
            fail(self.output,run_id,str(exc))
            raise

    def _train_compare(self):
        if self.before_train:
            self.before_train(self)
        # The trainer always enforces the gate, including fresh direct invocations.
        self.validate_features()
        c=self.contract
        y=self.df[c.split.target].to_numpy()
        tr,va,te=[self.splits[k] for k in ['train','validation','test']]
        candidates={
            'logistic':LogisticRegression(max_iter=2000,random_state=c.split.seed),
            'random_forest':RandomForestClassifier(n_estimators=200,max_depth=8,min_samples_leaf=5,
                random_state=c.split.seed,n_jobs=1),
            'dummy':DummyClassifier(strategy='prior'),
        }
        validation={}
        thresholds={}
        grid=np.round(np.arange(.1,.901,.01),2)
        for name,estimator in candidates.items():
            estimator.fit(self.x[tr],y[tr])
            p=estimator.predict_proba(self.x[va])[:,1]
            t=.5 if name=='dummy' else float(grid[np.argmax([f1_score(y[va],p>=t) for t in grid])])
            thresholds[name]=t
            validation[name]=metrics(y[va],p,t)
        selected=max(['logistic','random_forest'],key=lambda n:validation[n]['average_precision'])
        tests={name:metrics(y[te],est.predict_proba(self.x[te])[:,1],thresholds[name]) for name,est in candidates.items()}
        estimator=candidates[selected]
        p=estimator.predict_proba(self.x[te])[:,1]
        rng=np.random.default_rng(c.split.seed)
        aucs=[]
        for _ in range(1000):
            idx=rng.integers(0,len(te),len(te))
            if len(np.unique(y[te][idx]))==2:aucs.append(roc_auc_score(y[te][idx],p[idx]))
        bundle={'pipeline':Pipeline([('preprocess',self.pre),('model',estimator)]),
            'threshold':thresholds[selected],'selected_model':selected,
            'features':c.features.numeric+c.features.categorical,'contract':c.model_dump(),
            'run_id':c.run_id,'schema_version':'3.0'}
        joblib.dump(bundle,self.output/'model.joblib')
        report={'run_id':c.run_id,'seed':c.split.seed,'positive_class':f'{c.split.target}=1',
            'split_sizes':{k:len(v) for k,v in self.splits.items()},
            'split_record_ids':{k:self.df.iloc[v][c.split.id_column].tolist() for k,v in self.splits.items()},
            'group_columns':c.split.group_columns,'feature_group_overlap':0,
            'chronological_or_member_split':False,'selection_metric':c.split.selection_metric,
            'selected_model':selected,'thresholds':thresholds,'validation':validation,'test':tests,
            'selected_roc_auc_bootstrap_95_ci':np.quantile(aucs,[.025,.975]).tolist(),
            'bootstrap_caveat':'Conditional row bootstrap; hidden participant dependence and distribution shift not covered.',
            'test_reuse_disclosure':'The holdout was used in the current dataset development. No blind external test is claimed.',
            'refit_on_validation_or_test':False,'input_contract_sha256':sha256(self.contract_path),
            'model_parameters':{n:e.get_params() for n,e in candidates.items()}}
        write_json(self.output/'metrics.json',report)
        lines=['# Evaluation report','',f'Selected variation: **{selected}**, selected by validation average precision only.',
            f'Positive class: {c.split.target}=1. Split: {len(tr)} train / {len(va)} validation / {len(te)} test.',
            'Exact normalized input duplicates share a split. This is not a temporal or participant-level split.',
            'Preprocessing is fit on training only. F1 threshold grid .10-.90 step .01 uses validation only.',
            '','| Variation | Validation AP | Threshold | Test AUC | Test AP | Accuracy | Precision | Recall | F1 | Brier |',
            '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for n,m in tests.items():
            lines.append(f"| {n} | {validation[n]['average_precision']:.4f} | {thresholds[n]:.2f} | {m['roc_auc']:.4f} | {m['average_precision']:.4f} | {m['accuracy']:.4f} | {m['precision']:.4f} | {m['recall']:.4f} | {m['f1']:.4f} | {m['brier_score']:.4f} |")
        lines+=['','The test is descriptive after validation selection. The result is conditional on this one dataset and split.',
            'No production calibration, fairness, business benefit or causal reminder effect has been established.',
            'The file metrics.json includes confusion matrices, no-visit F1, log loss and a conditional bootstrap interval.']
        (self.output/'evaluation_report.md').write_text('\n'.join(lines),encoding='utf-8')
        return ['model.joblib','evaluation_report.md']

    def card(self):
        c=self.contract
        m=json.loads((self.output/'metrics.json').read_text(encoding='utf-8'))
        selected=m['selected_model']; scores=m['test'][selected]
        execution=('Live LLM mode was selected for this Scientist crew. Deterministic tools perform the data and model work. '
            'The final run_manifest.json records whether the requested live crews completed; scientist_review.json records validated provider-generated notes.'
            if self.live else 'The CrewAI Flow and deterministic data/science tools execute locally. '
            'This run uses scripted LLM fixtures with author-written notes. It is not evidence of live generative-agent reasoning.')
        text=f'''# Gymmi model card

## Purpose and intended use
Study whether any week2 gym visit is recorded, using prior visit history. This is not booked-class attendance, a causal incentive effect or authorization for an operational action.

## Training data and interface
{c.rows} cleaned study records, received exclusively through clean_data.csv and dataset_contract.json. Crew 2 never receives a raw dataset path. Target: {c.split.target}, positive class 1. Fit uses {m['split_sizes']['train']} training records. Validation/test have {m['split_sizes']['validation']}/{m['split_sizes']['test']} records. Selected model: {selected}.

## Input features and preprocessing
Numeric: {', '.join(c.features.numeric)}. Categorical: {', '.join(c.features.categorical)}. Training-only median imputation and scaling, and optional categorical encoding (no categorical inputs in this version). Identifiers, demographics, academic data and future/reward fields are excluded. features.csv contains the exact transformed numeric matrix plus explicitly labelled ID, target and split metadata, which are not model inputs.

## Evaluation
Selection uses validation average precision. Test ROC-AUC {scores['roc_auc']:.4f}, AP {scores['average_precision']:.4f}, accuracy {scores['accuracy']:.4f}, precision {scores['precision']:.4f}, recall {scores['recall']:.4f}, F1 {scores['f1']:.4f}, Brier {scores['brier_score']:.4f}. See evaluation_report.md for logistic, random forest and dummy comparisons. No refit on validation or test.

## Limitations and ethics
'''+ '\n'.join('- '+x for x in c.assumptions)+f'''

- Demographic and protected-attribute source columns are excluded from this modelling interface. No fairness claim is made.
- Predicted probabilities have not been separately calibrated. Brier and log loss do not prove calibration in a new club.
- No contact or operational action is performed. Human review would be required for any downstream use.
- Contract checks detect missing columns, invalid values, ranges and post-publication edits. They cannot prove that a plausible value has the correct real-world meaning or that a source field was collected before the outcome.
- Derived outputs use the licensed source with attribution and modifications documented in DATA_ATTRIBUTION.md; no new-population performance claim is licensed by that fact.

## Execution disclosure
{execution}
'''
        (self.output/'model_card.md').write_text(text,encoding='utf-8')
        return ['model_card.md']
