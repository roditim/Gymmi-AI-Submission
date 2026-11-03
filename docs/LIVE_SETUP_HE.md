# הרצה עם LLM אמיתי

העתיקו `.env.example` ל־`.env` והגדירו `GYMMI_MODEL` בפורמט provider/model ואת מפתח הספק המתאים. אל תשתפו את המפתח. `python run.py --check-live` בודק רק שקיימת הגדרה; הוא אינו מתקשר לספק או מוכיח יתרה.

לאחר הורדת הנתונים: `python run.py --live --output runs/live-new`. בחרו תיקיית פלט חדשה. כשל בספק או בסקירה עוצר את הריצה; אין מעבר שקט ל־offline. הרצה עשויה להיות בתשלום.

`artifacts/weekly-live` מכיל ריצה חיה אמיתית של שני הצוותים עם openai/gpt-5.4-mini. ראו verification/weekly-live-check.json ו־docs/SEMANTIC_REVIEW.md. שני ניסיונות קודמים נכשלו ונחשפו בתיעוד; עלות החיוב המדויקת אינה ידועה. הסקירות המקוריות נשמרו ולא תוקנו בדיעבד; הסתייגויות מהניסוחים מתועדות בנפרד.
