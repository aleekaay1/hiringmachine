# Multi-User Setup Handoff (Phase 1)

This document summarizes what has already been implemented, and exactly what you need to do next to activate it in Supabase.

## What Has Been Implemented

### 1) Role-based account system (Phase 1)
- Added role support for:
  - `admin`
  - `leadership`
  - `recruiter`
  - (existing legacy roles remain supported: `webinar`, `hr`, `viewer`)
- Added role mapping logic based on user email.
- Added points-ready profile fields for future gamification:
  - `points`
  - `points_updated_at`

### 2) Access restrictions and visibility
- Recruiters are restricted to operational pages (pipeline/calling flow).
- Leadership/Admin retain broad/full visibility.
- Route + navigation restrictions were applied so direct URL access is also guarded.

### 3) Recruiter data scoping
- Calls analytics and WebinarGeek are scoped so recruiters see only their own records.
- Leadership/Admin continue to see full data.

### 4) Pipeline source simplification
- Pipeline was simplified to manual-upload flow only (check-in CSV source flow removed from Pipeline view).

### 5) Login improvements
- Added Google sign-in support (OAuth button) across main staff login screens, while keeping email/password login.
- New shared helper:
  - `services/googleAuth.ts`

### 6) SQL enum error fix (`55P04`)
- Added safe 2-step SQL flow so enum update and usage do not fail in a single unsafe transaction.

---

## Files Added/Updated for This Rollout

### SQL / Migrations
- `supabase/sql/paste_multi_user_roles_phase1_step1_enum.sql` (run first if needed)
- `supabase/sql/paste_multi_user_roles_phase1.sql` (main setup)
- `supabase/migrations/20260529_220700_add_leadership_role_enum.sql`
- `supabase/migrations/20260529_220800_multi_user_roles_phase1.sql`

### Staff onboarding list
- `docs/staff-account-create-list.txt`

### Google login support
- `services/googleAuth.ts`

### Pages updated with Google login option
- `pages/AdminDashboard.tsx`
- `pages/Pipeline.tsx`
- `pages/CallsAnalytics.tsx`
- `pages/WebinarGeekDashboard.tsx`
- `pages/EmailLog.tsx`
- `pages/LiveSessionsDashboard.tsx`
- `pages/HRDashboard.tsx`
- `pages/SuperDashboard.tsx`

---

## What You Need To Do Next

## A) While Google credentials are being configured in Supabase
In Supabase Dashboard:
1. Go to `Authentication -> Providers -> Google`.
2. Enable Google provider.
3. Add Google Client ID + Secret from Google Cloud Console.
4. Confirm callback URL in Google Cloud Console includes:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Ensure your app Site URL and additional redirect URLs are correct.

## B) Create users in Supabase Auth (one by one)
Go to `Authentication -> Users -> Add user`, then create each email below.

Use your shared temporary password for all users (then force reset later).

### Admin
- reginald_bentajado@globelife-paz.com
- hr.licensing@globelife-paz.com

### Leadership
- akram@globelife-paz.com
- walid@globelife-paz.com
- nicolas@globelife-paz.com
- nita@globelife-paz.com
- raman@globelife-paz.com
- devanshi@globelife-paz.com
- emilio@globelife-paz.com

### Recruiters
- gamar_baghirli@globelife-paz.com
- herlyn_desingano@globelife-paz.com
- hasaan_khalid@globelife-paz.com
- jonalyn_manuel@globelife-paz.com

Important:
- Mark each email as confirmed (if creating manually).
- Use exact emails above so role mapping SQL matches.

## C) Run SQL in Supabase SQL Editor (order matters)
Run in this exact order:

1. `supabase/sql/paste_multi_user_roles_phase1_step1_enum.sql`
2. `supabase/sql/paste_multi_user_roles_phase1.sql`

This order prevents:
- `ERROR: 55P04 unsafe use of new value "leadership" of enum type app_role`

## D) Validate after setup
1. Login with a recruiter account:
   - Confirm restricted navigation and recruiter-scoped analytics/webinar data.
2. Login with leadership/admin:
   - Confirm full visibility.
3. Confirm staff directory loads under settings/admin context.
4. Confirm Google login button works with allowed domain emails.

---

## Recommended Immediate Follow-ups

1. Force password reset flow for all manually created users after first login.
2. Add explicit hierarchy seeds (RGA/MGA tree) once you provide mapping.
3. Start Phase 2 gamification:
   - points accrual events
   - profile leaderboard
   - redeem workflow

---

## Notes

- If a user is created after SQL has already run, rerun:
  - `supabase/sql/paste_multi_user_roles_phase1.sql`
  to map roles for newly created auth users by email.
- Keep email spellings exact; role assignment is email-based.
