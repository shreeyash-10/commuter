# Commute Monitor

Google Apps Script commute alerts using Google Routes live traffic for motorized two-wheelers and Discord.

Checks every five minutes, Monday–Friday, 09:45–11:00 and 18:30–19:45 Asia/Kolkata. Morning is A → B; evening is B → A. Sends one alert per window per day after one qualifying reading. The threshold comparison is strictly below. API failures reset confirmation. Delivered alerts suppress further Maps requests for that window.

## Configure and activate

1. Create an Apps Script project, put `Code.gs` in the editor, and use the included `appsscript.json` manifest (enable manifest visibility in Project Settings).
2. Add these Script Properties in Project Settings:

| Property | Value |
| --- | --- |
| LOCATION_A | Starting address or coordinates accepted as an address |
| LOCATION_B | Destination address |
| MORNING_THRESHOLD_MIN | Positive minutes; defaults to 24 |
| EVENING_THRESHOLD_MIN | Positive minutes; defaults to 27 |
| MAPS_API_KEY | API key restricted to Routes API |
| DISCORD_WEBHOOK_URL | Discord channel webhook URL |

3. Enable Routes API in a billing-enabled Google Cloud project. Configure API quotas separately. Never commit keys, webhooks, or private locations.
4. Run `validateConfiguration`, then `testGoogleMaps` and `testDiscord`. Google will request authorization. The Maps test sends your route to Google; Discord alerts include a directions link containing the route.
5. Run `installTrigger` once to activate monitoring. Run `uninstallTrigger` to stop it. A web-app deployment is unnecessary for this scheduled script.

## Operations

The trigger executes throughout the day but returns outside monitoring windows without calling Maps. Time-driven triggers are approximate. Review Apps Script Executions for failures; errors are allowed to surface rather than being silently swallowed.

A 1,500-request monthly cap includes tests and failed requests. Usage state resets by calendar month in Asia/Kolkata; it is an application safeguard, not a billing guarantee. Maximum scheduled usage is approximately 30 requests per weekday before alerts suppress later checks. Google Maps billing and free allowances depend on your account and other usage.

State is bounded to three Script Properties: `STATE_morning`, `STATE_evening`, and `MAPS_USAGE`. `LockService` serializes route checks and tests. A crash between Discord delivery and storing success can cause a duplicate; exactly-once delivery is not guaranteed across two independent services.

## Local checks

Run `node tests/monitor.cjs`. No packages or live credentials are required.

## Travel mode and diagnostics

Requests use TWO_WHEELER with TRAFFIC_AWARE_OPTIMAL. Google bills two-wheeler routing under Compute Routes Enterprise. Check the applicable billing-account allowance; the 1,500-request cap is not a billing guarantee. Two-wheeler routes are in beta and may not always choose optimal paths; use caution. Directions links explicitly select two-wheeler mode.

Successful checks log the period, mode, exact ETA seconds, threshold and qualifying-reading count without keys or addresses. The latest ETA is also stored in the per-window state. A mode change resets confirmation and previous alert status for that window.
