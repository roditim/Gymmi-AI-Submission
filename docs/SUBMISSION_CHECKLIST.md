# מיפוי דרישות ההגשה

המסמך מתאר את המימוש ביחס לדרישות המרצים. חומרי ההוראה עצמם אינם מופצים כאן. הנחיות בקובצי הקורס שימשו דרישות לפרויקט, ואינן הרשאה לשלוח הודעות או לחשוף חומר פרטי.

| דרישה | איפה רואים |
|---|---|
| שני crews עם לפחות שלושה סוכנים בכל אחד | gymmi/crews.py, run_manifest.json |
| ארבעה תוצרי Analyst | artifacts/weekly-live ו־weekly-baseline |
| ארבעה תוצרי Scientist | אותן תיקיות; features.csv הוא המטריצה שאומנה |
| מסירה אוטומטית דרך Flow | gymmi/flow.py |
| Scientist מקבל רק clean + contract | ScientistWorkspace אינו מקבל raw_path |
| אימות חוזה לפני modeling | boundary.py, validation_gate ב־Flow |
| בדיקת תכונות לפני fit | feature_gate.py וקריאה מחייבת בתוך train_compare |
| שני מודלים נלמדים והשוואה | Logistic, Random Forest ו־Dummy להשוואה |
| שחזור, logging ותוצרים בגרסאות | seed, execution_log.jsonl, artifacts/ |
| כשל יזום ועצירה ברורה | --break units; בדיקות boundary ו־UI |
| ממשק Streamlit | app.py |
| GitHub ציבורי ו־PR אמיתי | ריפו זה ו־Pull Requests |
| מצגת קצרה | תתווסף בענף ההכנה להגשה |

פריסה לענן, Supabase, RAG וזיכרון אינם דרישות חובה ולכן לא נוספו. אין מסמך המעיד על אישור המרצה לשינוי הנושא או על אישור הרכב צוות אנושי; אין להציג את סוכני CrewAI כסטודנטים שותפים. יש להציג את הסיוע בקוד בכנות ולתרגל את ההסבר.

המקור ברישיון CC BY 4.0; ייחוס ושינויים ב־DATA_ATTRIBUTION.md. מסמכי הקורס, ההיסטוריה הפרטית, מפתחות, raw CSV והנתונים הישנים אינם חלק מהייצוא. יש להשתמש בשם ריצה חדש בכל הפעלה.
