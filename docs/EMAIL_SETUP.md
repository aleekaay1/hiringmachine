# Email (G Suite) setup for candidate emails

Emails are sent from the admin panel via a Supabase Edge Function that uses **SMTP**. Your G Suite address is used as the sender.

## 1. G Suite / Gmail: use SMTP (not “SMTP relay”)

- **You do not need** G Suite “SMTP relay service” (that’s for other mail servers relaying through Google).
- The app sends **directly as your G Suite user** using **Gmail’s SMTP**:
  - **Host:** `smtp.gmail.com`
  - **Port:** `587` (TLS)
  - **Secure:** `false` (TLS is negotiated on 587)

## 2. App password (recommended)

Google often blocks “less secure apps”. Use an **App Password** so the app can sign in without your main password:

1. Go to [Google Account](https://myaccount.google.com/) (while signed in as `talentacquisition@globelife-paz.com` or a G Suite admin).
2. **Security** → **2-Step Verification** (turn it on if needed).
3. **Security** → **2-Step Verification** → **App passwords**.
4. Create an app password (e.g. name: “Paz Hiring Portal”). Copy the 16-character password.
5. In the Edge Function secrets (below), set `SMTP_PASSWORD` to this app password (not your normal G Suite password).

If you cannot use 2-Step Verification (e.g. org policy), ask your G Suite admin whether “Less secure app access” is allowed for this account; the app will then use the normal account password (stored only in secrets, never in code).

## 3. Supabase Edge Function secrets

Do **not** put the real password (or app password) in the code. Store everything in **Supabase → Project → Edge Functions → Secrets**:

| Secret             | Value                                      |
|--------------------|--------------------------------------------|
| `SMTP_HOSTNAME`    | `smtp.gmail.com`                           |
| `SMTP_PORT`        | `587`                                      |
| `SMTP_SECURE`      | `false`                                    |
| `SMTP_USERNAME`    | `talentacquisition@globelife-paz.com`      |
| `SMTP_PASSWORD`    | Your app password (or account password)*   |
| `SMTP_FROM`        | `talentacquisition@globelife-paz.com` (or “Paz Talent <talentacquisition@globelife-paz.com>”) |

\* If the password was ever shared in chat or in a repo, change it in G Suite and use the new value in secrets.

## 4. Deploy the send-email function

From the project root:

```bash
supabase functions deploy send-email
```

Then open a candidate in the admin panel and use **Stage 2 / 3 / 5** emails or **Compose** → preview → **Send**. The email will be sent via G Suite and logged on the candidate.

## 5. Sending and receiving inside the app (optional later)

- **Sending:** Stage email buttons and Compose use the Edge Function above. Automated sends (check-in, post-assessment thank-you) are defined in `services/emailAutomation.ts` and stay disabled until you set `AUTOMATED_EMAILS_ENABLED` and wire triggers.
- **Receiving (inbox in app):** Would require either:
  - **Gmail API** with OAuth (user signs in with Google; we read/send via API), or
  - **IMAP** with credentials stored only on the server (e.g. another Edge Function that fetches inbox and returns JSON).  
Both need backend-only access; we can add this in a follow-up if you want an in-app webmail view.

## 6. Merge fields in templates

Templates support placeholders that are replaced with the candidate’s data:

- `{{firstName}}` – First name  
- `{{lastName}}` – Last name  
- `{{email}}` – Email  
- `{{phone}}` – Phone  
- `{{assessmentLookupUrl}}` – Full URL to `/assessment-lookup` (Stage 3 template; filled in admin when you open that template)
