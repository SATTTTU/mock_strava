param(
  # Falls back to the env var so `npm run db:apply` works once it is exported.
  # Kept as a parameter so the token can be passed inline without persisting it.
  [string]$Token = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ProjectRef = 'syrmaeukkrmsbqynyjik',
  [string]$Directory = './supabase/migrations',
  [switch]$DryRun
)

# Applies every migration in filename order to a linked Supabase project, using
# the Management API rather than `supabase db push`.
#
# `supabase db push` authenticates to Postgres with the database role password,
# which is a separate credential from the sbp_ personal access token. This
# script exists so migrations can be applied with the access token alone.
#
# Migrations are plain SQL with no psql meta-commands, so they can be replayed
# anywhere. Nothing records what has already run: this is not a substitute for
# migration history. Once you have the database password, prefer
# `supabase db push`, which keeps supabase_migrations.schema_migrations accurate.

$ErrorActionPreference = 'Stop'

if (-not $Token) {
  'No access token. Generate one at Account -> Access Tokens in the Supabase'
  'dashboard (must start with sbp_), then either:'
  ''
  '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # then: npm run db:apply'
  '  npm run db:apply -- -Token sbp_...'
  exit 1
}

$migrations = @(Get-ChildItem -LiteralPath $Directory -Filter '*.sql' | Sort-Object Name)

if ($migrations.Count -eq 0) {
  "No .sql files found in $Directory"
  exit 1
}

foreach ($migration in $migrations) {
  if ($DryRun) {
    "would apply: $($migration.Name)"
    continue
  }

  & "$PSScriptRoot\apply-migration.ps1" `
    -File $migration.FullName `
    -Token $Token `
    -ProjectRef $ProjectRef

  if ($LASTEXITCODE -ne 0) {
    "aborting at $($migration.Name); later migrations were not applied"
    exit 1
  }
}

if (-not $DryRun) {
  ''
  "applied $($migrations.Count) migration(s)"
  'run `npm run db:test-rls` to verify the privacy properties'
}