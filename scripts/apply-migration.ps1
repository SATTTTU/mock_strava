param(
  [Parameter(Mandatory = $true)][string]$File,
  # Falls back to the env var so callers such as `npm run db:test-rls` do not
  # have to thread the token through. Kept as a parameter so it can be passed
  # inline without persisting it anywhere.
  [string]$Token = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ProjectRef = 'syrmaeukkrmsbqynyjik'
)

# Applies a SQL file to a linked Supabase project through the Management API.
#
# This exists because `supabase db push` authenticates to Postgres with the
# database role password, which is a different credential from the sbp_
# personal access token. The Management API's /database/query endpoint executes
# SQL as the project owner, so migrations can be applied without that password.
#
# Requires an sbp_ token from Account -> Access Tokens, not the sb_secret_
# database key, and not the sb_publishable_ app key.

$ErrorActionPreference = 'Stop'

if (-not $Token) {
  'No access token. Generate one at Account -> Access Tokens in the Supabase'
  'dashboard (must start with sbp_), then either:'
  ''
  '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # then: npm run db:test-rls'
  '  npm run db:test-rls -- -Token sbp_...'
  exit 1
}

$sql = [string](Get-Content -LiteralPath $File -Raw)

# psql meta-commands (\set, \if, ...) are client-side, not SQL, and the API
# rejects them as syntax errors. Stripped so the same file can be used for both
# a local psql run and a hosted apply.
$lines = $sql -split "`r?`n"
$sql = ($lines | Where-Object { $_ -notmatch '^\s*\\' }) -join "`n"

# The request body is assembled by hand rather than via ConvertTo-Json on a
# hashtable. PowerShell wraps a file-read string in a PSObject, so the hashtable
# route serialises the query as {"query":{"value":"..."}} and the API rejects it
# with "expected string, received object". Quoting the scalar on its own first
# produces a correctly escaped JSON string.
$json = '{"query":' + ($sql | ConvertTo-Json -Compress) + '}'

$uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"

$request = [System.Net.HttpWebRequest]::Create($uri)
$request.Method = 'POST'
$request.ContentType = 'application/json'
$request.Headers.Add('Authorization', "Bearer $Token")
$request.Timeout = 300000

$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$request.ContentLength = $bytes.Length

$stream = $request.GetRequestStream()
$stream.Write($bytes, 0, $bytes.Length)
$stream.Close()

try {
  $response = $request.GetResponse()
  $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
  $body = $reader.ReadToEnd()
  '{0}: applied ({1} bytes of SQL)' -f (Split-Path $File -Leaf), $sql.Length
}
catch [System.Net.WebException] {
  $errorResponse = $_.Exception.Response
  $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
  $detail = $reader.ReadToEnd()

  'FAILED: {0}' -f (Split-Path $File -Leaf)
  'HTTP {0}' -f [int]$errorResponse.StatusCode
  $detail
  exit 1
}