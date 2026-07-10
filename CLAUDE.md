# PM Dashboard

Stack: Next.js (frontend) + Supabase (Postgres, Auth, RLS). FastAPI planned
later for JIRA sync — not part of v1.

Full specs live in /specs/, in dependency order:
01 (data model) → 02 (calculations) → 03 (access control/RLS) →
04-08 (functional specs, can build in any order once 01-03 are done).

Read the relevant spec file(s) before implementing any feature. Spec 01
and 03 define the Postgres schema and RLS policies exactly — implement
those literally, don't improvise field names or policy logic.