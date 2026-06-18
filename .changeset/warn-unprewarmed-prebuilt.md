---
"eve": patch
---

Warn when a Vercel build skips sandbox template prewarming because `VERCEL_DEPLOYMENT_ID` is missing, and direct users away from deploying that output with `vercel deploy --prebuilt`.
