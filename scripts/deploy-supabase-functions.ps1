# Deploy all Edge Functions to Supabase project hlfufjrjztuknioydlut
# Requires: npx supabase CLI + auth (one of):
#   - Run: npx supabase login
#   - Or set env: $env:SUPABASE_ACCESS_TOKEN = "sbp_..."  (Dashboard → Account → Access Tokens)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$ProjectRef = "hlfufjrjztuknioydlut"
if (Test-Path "supabase\.temp\project-ref") {
  $ProjectRef = (Get-Content "supabase\.temp\project-ref" -Raw).Trim()
}

$CliVersion = "2.90.0"
if (Test-Path "supabase\.temp\cli-latest") {
  $CliVersion = (Get-Content "supabase\.temp\cli-latest" -Raw).Trim()
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "No SUPABASE_ACCESS_TOKEN in environment." -ForegroundColor Yellow
  Write-Host "Run:  npx supabase@$CliVersion login" -ForegroundColor Cyan
  Write-Host "  Or: `$env:SUPABASE_ACCESS_TOKEN = 'your-token-from-supabase-dashboard'" -ForegroundColor Cyan
}

$functions = @(
  "integrations-zoom-calendly",
  "sync-live-session-pipeline",
  "live-session-auto-assessment",
  "integrations-webinar-geek",
  "send-email",
  "send-candidate-email",
  "live-session-calendar",
  "send-assessment-email",
  "assessment-lookup",
  "send-leadership-assessment-reminders",
  "upload-resume",
  "hr-dashboard-data",
  "hr-rollup-jobs",
  "hr-automation-runner",
  "email-inbox-sync",
  "threecx-call-control",
  "threecx-call-webhook",
  "threecx-call-admin",
  "sync-live-session-outcomes",
  "pipeline-convert-resume",
  "pipeline-hr-leads"
)

Write-Host "Deploying $($functions.Count) functions to project $ProjectRef ..." -ForegroundColor Green

$failed = @()
foreach ($name in $functions) {
  $dir = "supabase\functions\$name"
  if (-not (Test-Path "$dir\index.ts")) {
    Write-Host "  skip $name (no index.ts)" -ForegroundColor DarkGray
    continue
  }
  Write-Host "  -> $name" -ForegroundColor Cyan
  npx --yes "supabase@$CliVersion" functions deploy $name --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) {
    $failed += $name
    Write-Host "  FAILED: $name (exit $LASTEXITCODE)" -ForegroundColor Red
  }
}

if ($failed.Count -gt 0) {
  Write-Host "`nFailed: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}

Write-Host "`nAll functions deployed." -ForegroundColor Green
