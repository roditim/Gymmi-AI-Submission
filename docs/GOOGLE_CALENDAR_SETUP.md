# Google Calendar sync

Gymmi stores an optional Google link per signed-in Gymmi account. Google creates a secondary calendar named **Gymmi** under the consenting Google account. Gymmi writes workouts to that dedicated calendar and reads busy intervals from the primary calendar with the [calendar.app.created and calendar.freebusy scopes](https://developers.google.com/workspace/calendar/api/auth).

The published connect button reports availability from the backend. The production backend has no Google OAuth application credentials yet. Draft links and ICS export remain available.

## Activate the application

1. In the Gymmi Google Cloud project, enable **Google Calendar API**. Configure the OAuth consent screen and create an OAuth client of type **Web application**.
2. Set the exact authorized redirect URI to `https://roditim.github.io/Gymmi-AI-Submission/app/` with the trailing slash. Add `https://www.googleapis.com/auth/calendar.app.created` and `https://www.googleapis.com/auth/calendar.freebusy` to Data Access. For an External app in Testing, authorize a separate Google test account in Audience. [Google web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
3. Store the client ID and secret in Supabase Edge Function Secrets as `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`. Leave credentials out of the repository and browser. The token encryption secret `GOOGLE_CALENDAR_TOKEN_KEY` is a 32-byte AES key encoded as base64. The worker secret `GOOGLE_CALENDAR_WORKER_KEY` must match Vault entry `gymmi_google_calendar_worker`. Preserve the encryption key while links exist.
4. Apply the schema migration, deploy `google-calendar-sync` with gateway JWT verification enabled, and apply `supabase/google-calendar-cron.sql`. Store the legacy public anon JWT in Vault as `gymmi_google_calendar_gateway` for gateway compatibility. The function authenticates each browser request with Supabase Auth and requires a separate worker key for scheduled requests. The deployed schedule only makes an HTTP request when a connection is due.
5. Sign into a separate Gymmi test account, link the Google test account, confirm the new calendar appears in the Google Calendar app on the phone, and test create, move and delete in each direction. Check disconnect and keep the same calendar visible on the phone. External Testing refresh tokens expire after seven days. Review Google's publishing and verification requirements before opening it to general users. [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## Sync rules

- Gymmi syncs planned workouts with a start and end time in the dedicated calendar. Workouts without a start time remain all-day events, with a 30-minute duration on import. The dedicated calendar receives the name, schedule and a private mapping ID. Exercise notes and completion history stay in Gymmi.
- Add, rename, move or delete a matching event on either side. If both sides edited the same event between syncs, Gymmi's title and schedule win. Marking a linked workout complete or skipped removes its planned Google event. Recurring and invited events stay outside automatic changes.
- The dashboard, AI dialog and monthly calendar use the primary calendar’s FreeBusy response. The app reads intervals without event titles. OpenAI receives the busy intervals for the selected days. Gymmi checks them again before an AI save. An earlier link without the availability permission needs to reconnect.
- The worker runs every two minutes and syncs in bounded batches. It checks a complete Google snapshot before interpreting deletions. Database revision checks prevent an incoming change from overwriting a concurrent Gymmi save. Google ETags protect concurrent Google edits.
- The browser checks for fresh revisions while the connected app is visible and waits for unsaved drafts and AI previews to clear. The **Sync now** button requests an immediate round, with a short server cooldown.
- Disconnect removes the encrypted token and mappings from Gymmi. The Google calendar and its events stay in Google. Reconnect creates a new dedicated calendar. Google account settings can remove the app's authorization.

OAuth is initiated from a signed-in Gymmi session. A short-lived, single-use state and PKCE verifier bind the exchange to that account. The refresh token is encrypted with AES-GCM using the account ID as associated data. Only the service role can read connection data. On Node 24, run `node --experimental-transform-types --test tests/google_calendar_sync.test.mjs tests/google_calendar_edge.test.mjs`. Planner and simulated-provider runs do not establish real Google or mobile sync.
