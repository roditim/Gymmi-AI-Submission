import json
import os
from pathlib import Path
import uuid
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from gymmi.contracts import VisitHistory
from gymmi.flow import run,REQUIRED_OUTPUTS
from gymmi.artifact_status import require_ready,ArtifactError
from gymmi.prediction import predict

ROOT=Path(__file__).parent
RUNS_ROOT=Path(os.environ.get('GYMMI_RUNS_DIR',str(ROOT/'runs')))
st.set_page_config(page_title='Gymmi AI',page_icon='🏋️',layout='wide')
st.title('Gymmi AI · ביקור בחדר הכושר בשבוע הבא')
st.caption('Data Analyst Crew + Data Scientist Crew · חוזה נתונים לפני אימון')
st.warning('הדגמה לימודית מנתוני מחקר Zenodo ברישיון CC BY 4.0. אין הוכחה לעצמאות בין משתתפים או להתאמה לחדר כושר חדש.')
paths=sorted(RUNS_ROOT.glob('*/run_manifest.json')) if RUNS_ROOT.exists() else []
if not paths and 'GYMMI_RUNS_DIR' not in os.environ:
    paths=sorted((ROOT/'artifacts').glob('*/run_manifest.json'))
if not paths:
    st.info('הרץ תחילה run.py --download לפי README.');st.stop()
selected=st.selectbox('ריצה',paths,index=next((i for i,p in enumerate(paths) if p.parent.name=='verified'),0),format_func=lambda p:p.parent.name)
folder=Path(selected).parent
try:
    manifest=json.loads(Path(selected).read_text(encoding='utf-8'))
    if not isinstance(manifest,dict):manifest={}
except (OSError,ValueError):
    manifest={}
try:
    require_ready(folder)
    prediction_ready=True
    readiness_error=''
except ArtifactError as exc:
    prediction_ready=False
    readiness_error=str(exc)
st.write('סטטוס: '+('הושלם ואומת לחיזוי' if prediction_ready else 'חיזוי חסום — התוצרים לא אומתו'))
st.caption('מצב סוכנים: '+str(manifest.get('mode') or 'לא ידוע'))
if manifest.get('live_llm_completed'):
    st.caption('צוותים שהשלימו משימות LLM חיות בריצה זו: '+', '.join(manifest.get('live_crews_completed',[])))
tabs=st.tabs(['סקירה','EDA ותובנות','חוזה ובדיקת כשל','מודלים ותוצרים','תחזית'])
with tabs[0]:
    st.write('צוות הניתוח מפיק נתונים נקיים, דוח EDA, תובנות וחוזה. שער האימות בודק אותם לפני שצוות מדע הנתונים מכין מאפיינים ומאמן מודלים.')
    if manifest.get('error'):st.error(manifest['error'])
    events=manifest.get('events',[])
    st.dataframe(pd.DataFrame(events if isinstance(events,list) else []),hide_index=True)
    for crew_name in ['analyst','scientist']:
        review_path=folder/f'{crew_name}_review.json'
        if review_path.exists():
            with st.expander(f'ניתוח מובנה — {crew_name}'):
                st.caption('טענות נבדקות מול ראיות הכלים. פרשנות איכותנית עדיין דורשת בדיקה אנושית; מצב offline אינו הרצת LLM חי.')
                try:st.json(json.loads(review_path.read_text(encoding='utf-8')))
                except (OSError,ValueError):st.warning('קובץ הסקירה אינו קריא; החיזוי יישאר חסום.')
with tabs[1]:
    if (folder/'eda_report.html').exists():components.html((folder/'eda_report.html').read_text(encoding='utf-8'),height=950,scrolling=True)
    if (folder/'insights.md').exists():st.markdown((folder/'insights.md').read_text(encoding='utf-8'))
with tabs[2]:
    contract_path=folder/'dataset_contract.json'
    if contract_path.exists():
        try:st.json(json.loads(contract_path.read_text(encoding='utf-8')))
        except (OSError,ValueError):st.warning('חוזה הנתונים אינו קריא; יש ליצור ריצה חדשה.')
    st.write('הדגמת כשל משתמשת בהעתק של ארבעת תוצרי הניתוח. היא מכפילה את ספירת הביקורים פי 100, ומשאירה את המקור כפי שהוא.')
    if st.button('הדגם שינוי יחידות ועצירה לפני אימון'):
        output=RUNS_ROOT/f'unit-demo-{uuid.uuid4().hex[:8]}'
        try:
            run(output,handoff_dir=folder,break_case='units')
            st.error('בדיקת הכשל לא עצרה כמצופה.')
        except Exception as exc:
            status=json.loads((output/'run_manifest.json').read_text(encoding='utf-8'))
            st.success('ה־Flow עצר לפני צוות מדע הנתונים והאימון.')
            st.code(str(exc))
            st.json({'validation_passed':status['validation_passed'],'model_created':(output/'model.joblib').exists()})
with tabs[3]:
    for filename in ['evaluation_report.md','model_card.md']:
        if (folder/filename).exists():st.markdown((folder/filename).read_text(encoding='utf-8'))
    st.subheader('שמונת התוצרים הנדרשים')
    for name in REQUIRED_OUTPUTS:
        file=folder/name
        if file.exists():st.download_button(name,file.read_bytes(),name,key=name)
        else:st.caption(name+' — לא נוצר בריצה זו')
with tabs[4]:
    if not prediction_ready:
        st.warning('החיזוי חסום. יש ליצור ריצה חדשה ולהשלים את כל הבדיקות.')
        st.code(readiness_error)
    else:
        with st.form('history'):
            values={name:st.number_input(label,min_value=0,max_value=100,value=1,step=1)
                for name,label in [('prewk1','ביקורים בשבוע מקדים ראשון'),('prewk2','ביקורים בשבוע מקדים שני'),
                    ('prewk3','ביקורים בשבוע מקדים שלישי'),('week1','ביקורים בשבוע הראשון') ]}
            submit=st.form_submit_button('חשב הסתברות')
        if submit:
            history=VisitHistory(**values)
            try:
                probability=predict(folder,history)
                st.metric('הסתברות משוערת לביקור בשבוע הבא',f'{probability:.1%}')
                st.caption('חישוב לימודי במודל השמור. ההסתברות לא כוילה לאוכלוסייה חדשה.')
            except (ArtifactError,OSError,ValueError) as exc:
                st.error('החיזוי נעצר: התוצרים השתנו או אינם תקינים. יש ליצור ריצה חדשה.')
                st.code(str(exc))
