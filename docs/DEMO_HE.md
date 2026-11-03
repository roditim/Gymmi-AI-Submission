# הדגמה קצרה למרצה

להכין מראש Python 3.12 עם requirements.txt. לא להריץ שוב לאותה תיקיית פלט. הממשק יכול להציג את artifacts גם לפני הורדת נתונים.

1. להפעיל `python -m streamlit run app.py` ולבחור weekly-live כשמוצגות הריצות השמורות. אם יש ריצות מקומיות, בחרו את הרצויה או הפעילו מסוף עם `GYMMI_RUNS_DIR=artifacts` לפי תחביר מערכת ההפעלה.
2. להראות EDA, את ארבעת קלטי החוזה, ואת טבלת המודלים. להסביר מדוע נבחר Logistic לפי האימות.
3. להזין ארבע ספירות בטופס ולחשב תחזית. ההסתברות היא לימודית ולא כוילה לאוכלוסייה חדשה.
4. להדגים כשל בהעתק בלבד:

```powershell
python run.py --handoff artifacts/weekly-live --break units --output runs/demo-units-new
```

מצופה exit code 2, הודעת חריגה מטווח ושמירת run_manifest עם validation_passed=false. אין model.joblib ואין תחילת Scientist. אם שם התיקייה קיים, לבחור שם חדש; אל תמחקו או תשנו את artifacts.

כדי לשחזר הצלחה מהמקור: `python run.py --download --output runs/demo-success-new`. זו ברירת מחדל offline: כלים אמיתיים עם תגובות סוכנים כתובות מראש. כדי להריץ LLM חי יש להגדיר .env מקומי ולהוסיף --live, עם תיקייה חדשה. אל תציגו מפתח על המסך. ראיות הריצה החיה שכבר בוצעה נמצאות ב־artifacts/weekly-live.

שאלות לתרגול: מה היעד? למה מזהה שורה אינו מזהה אדם? מה תפקיד החוזה? למה fit רק על train? למה אין מחליפים מודל לפי test? מה בדיוק נעצר בהדגמה? במה נעזרת בעוזר קוד ומה בדקת בעצמך?
