# Gymmi AI

פרויקט גמר: חיזוי ביקור בחדר הכושר בשבוע הבא באמצעות שני צוותי CrewAI וחוזה נתונים מאומת. הקוד משתמש ב־Python, pandas, scikit-learn, Pydantic, Matplotlib ו־Streamlit. ללא RPG או תשתית נוספת.

## הפעלה ממחשב חדש

נדרש Python 3.12. פותחים את התיקייה ב־Cursor או באמצעות Gymmi.code-workspace. ב־PowerShell:

```powershell
git clone https://github.com/roditim/Gymmi-AI-Submission.git
cd Gymmi-AI-Submission
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHONIOENCODING='utf-8'
.\.venv\Scripts\python.exe run.py --download --output runs/verified
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m streamlit run app.py
```

כל ריצה דורשת תיקיית פלט חדשה. אם לא נוצרו ריצות מקומיות, הממשק מציג את התוצרים השמורים ב־artifacts. כדי לבדוק LLM אמיתי הגדירו מקומית `.env` לפי `.env.example`; ראו [הוראות live](docs/LIVE_SETUP_HE.md). המפתח אינו חלק מהריפו, וקריאות לספק עשויות להיות בתשלום. offline מפעיל כלים אמיתיים עם תשובות סוכנים כתובות מראש — הוא אינו קריאת LLM.

## הנתונים ושאלת המחקר

מקור: [Gym Use Behavioral Economics Experiment, Zenodo v1](https://doi.org/10.5281/zenodo.18866086), רישיון CC BY 4.0. ייחוס, checksum ושינויים: [DATA_ATTRIBUTION.md](DATA_ATTRIBUTION.md).

389 רשומות ו־71 עמודות מקור. נבחרו רק prewk1, prewk2, prewk3 ו־week1; היעד הוא attended_next_week = int(week2 > 0). בקלט שנבחר אין חסרים. 207 רשומות ללא ביקור ו־182 עם ביקור. דמוגרפיה, GPA, טיפולים, תגמולים וביקורים עתידיים אינם קלט. קובץ המקור מורד מקומית ואינו נשמר ב־Git.

המשימה השתנתה במפורש מהרעיון המקורי של אי־הגעה לשיעור מוזמן. אין כאן נתוני הזמנות. תיאור המקור מציין 245 משתתפים; הפער מול 389 רשומות אינו מוסבר, ואין מזהה אדם או תאריכים מלאים.

## שני הצוותים ושמונת התוצרים

| צוות | תפקידי הסוכנים | תוצרים |
|---|---|---|
| Analyst | ניקוי, EDA, פרסום חוזה | clean_data.csv, eda_report.html, insights.md, dataset_contract.json |
| Scientist | מאפיינים, השוואת מודלים, כרטיס מודל | features.csv, model.joblib, evaluation_report.md, model_card.md |

Scientist מקבל רק clean_data.csv והחוזה. ה־Flow בודק אותם לפני הכנת המאפיינים, ובודק שוב את מטריצת התכונות לפני fit. המודל נבחר לפי validation AP והסף לפי validation F1. חתימות והשלמת כל התוצרים נבדקות לפני כל חיזוי. המסירה בין הצוותים וכללי הכשל הם עיקר הפרויקט.

## תוצאות שנמדדו

היסטוריות זהות נשארות באותו חלק: train=182, validation=64, test=143, seed=42. preprocessing מותאם לאימון בלבד. נבחר Logistic Regression לפי validation AP.

| מודל | Validation AP | Test AUC | Test AP | Test F1 |
|---|---:|---:|---:|---:|
| Logistic | 0.8646 | 0.8651 | 0.7868 | 0.8065 |
| Random Forest | 0.8504 | 0.8664 | 0.7925 | 0.3933 |
| Dummy | 0.5938 | 0.5000 | 0.2448 | 0.3933 |

[ריצה מקומית עם fixtures](artifacts/weekly-baseline) ו־[ריצת LLM אמיתית](artifacts/weekly-live) מכילות את שמונת התוצרים ואת הראיות המקוריות. שני ניסיונות live קודמים נעצרו בבדיקת הסקירה; הם מתועדים ב־verification/weekly-live-check.json. אין לנו עלות חיוב מדויקת.

## בדיקות ומגבלות

112 בדיקות עברו בפיתוח המקור. העותק הנקי הוריד את המקור, הריץ את ה־Flow ועבר את אותן 112 בדיקות. GitHub Actions אינו פעיל: לחיבור הפרסום חסרה הרשאת workflow. תבנית מוכנה נמצאת ב־docs/ci-tests.example.yml, ומי שרשאי להפעיל אותה יוכל להעתיק אותה ל־.github/workflows/tests.yml. בדיקות מכסות אי־התאמה לחוזה, שגיאות בתכונות, תוצרים חסרים/ישנים/משונים, טענות לא מבוססות וממשק.

הקבוצות הן דפוסי היסטוריה ולא אנשים; גדלי החלקים ושכיחות היעד שונים. הסדר השבועי הוא הנחה לפי שמות העמודות. אין הוכחת הפרדה בין משתתפים, הכללה לאוכלוסייה חדשה, כיול, הוגנות או השפעה סיבתית. דמיון בין validation ל־test אינו מוכיח שאין overfitting. ראו [סקירת הפרשנות](docs/SEMANTIC_REVIEW.md).

## עבודה והגשה

זהו ייצוא נקי של פרויקט שפותח קודם בריפו פרטי. ההיסטוריה הציבורית מתחילה בייבוא מסומן, ללא שחזור של תאריכים, משתתפים או ביקורות. EXPORT_PROVENANCE.json מתעד את מקור הייצוא. נעזרנו בעוזר קוד; [מדריך ההסבר](docs/PROJECT_EXPLAINED_HE.md) מיועד להבנת המימוש, לא לטענה שנכתב ללא עזרה.

[מצגת בעברית](https://roditim.github.io/Gymmi-AI-Submission/) · [קובץ מצגת לפתיחה מקומית](docs/index.html) · [הערות למגיש](docs/PRESENTER_NOTES_HE.md) · [הדגמת הצלחה וכשל](docs/DEMO_HE.md)

[בדיקת דרישות ההגשה](docs/SUBMISSION_CHECKLIST.md) · [הנחיות פיתוח](docs/DEVELOPMENT.md).
הגשת קישור למרצה ואישור נושא/הרכב צוות הם שלבים נפרדים; אין כאן טענה שכבר התקבלו. לא נשלחה הודעת הגשה.
