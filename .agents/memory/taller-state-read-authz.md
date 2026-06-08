---
name: taller-state read authorization
description: Why GET /taller/state intentionally returns ALL sections to any authenticated user
---

# Read authorization for taller_state

`GET /taller/state` returns the full state document (equipos, gpvList, tecnicos,
layout, licencias) to ANY authenticated user. Authorization is enforced only on
writes (`PUT`): each changed section is checked against module permissions.
Module visibility is enforced client-side (the frontend hides nav tabs the user
lacks permission for).

**Why:** This is the app's established, app-wide design — not specific to one
section. The "availability today" feature (is a technician on leave?) must show
licencia status to taller/venta users who do NOT have the `licencias` module.
Redacting `licencias` (or any section) from the GET would break cross-module
features that read another section's data. This is an internal workshop tool;
leave balances are operational data, not externally-shared PII.

**How to apply:** Do not add per-section read filtering to `GET /taller/state`
without first confirming no cross-module feature depends on that data. A code
reviewer flagging this as "broken access control" is evaluating it as a generic
SaaS app; here it is intentional and load-bearing.
