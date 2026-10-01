param(
  [string]$Base = 'https://syrmaeukkrmsbqynyjik.supabase.co',
  [string]$Anon = 'sb_publishable_qamQ_VTGbc5sAd2FU-F-SA_JSjxg41Q',
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$ActivityId
)

$ErrorActionPreference = 'Stop'

function Invoke-Rest {
  param([string]$Method, [string]$Path, [string]$Body)

  $request = [System.Net.HttpWebRequest]::Create("$Base$Path")
  $request.Method = $Method
  $request.Headers.Add('apikey', $Anon)
  $request.Headers.Add('Authorization', "Bearer $Token")
  $request.Timeout = 120000

  if ($Body) {
    $request.ContentType = 'application/json'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }

  try {
    $response = $request.GetResponse()
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    return @{ Status = [int]$response.StatusCode; Body = $reader.ReadToEnd() }
  }
  catch [System.Net.WebException] {
    $errorResponse = $_.Exception.Response
    $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
    return @{ Status = [int]$errorResponse.StatusCode; Body = $reader.ReadToEnd() }
  }
}

# Eleven points, 10 s apart, 0.001 deg of latitude north per step (~111 m).
# Built as real objects and serialised with ConvertTo-Json rather than by string
# concatenation, which is how the earlier probe produced malformed JSON.
$points = 0..10 | ForEach-Object {
  [ordered]@{
    activity_id = $ActivityId
    seq         = $_
    recorded_at = ([datetime]::new(2026, 1, 1, 10, 0, 0).AddSeconds($_ * 10)).ToString('yyyy-MM-ddTHH:mm:ssZ')
    lat         = 51.5 + ($_ * 0.001)
    lng         = -0.12
    ele         = 10 + ($_ * 2.5)
  }
}

$insert = Invoke-Rest -Method 'POST' -Path '/rest/v1/track_points' -Body ($points | ConvertTo-Json -Compress -Depth 5)
"insert track_points => $($insert.Status) $($insert.Body)"

$recompute = Invoke-Rest -Method 'POST' -Path '/rest/v1/rpc/recompute_activity_stats' -Body (@{ p_activity_id = $ActivityId } | ConvertTo-Json -Compress)
"recompute => $($recompute.Status) $($recompute.Body)"

$read = Invoke-Rest -Method 'GET' -Path "/rest/v1/activities?select=distance_m,moving_time_s,elapsed_time_s,point_count,avg_speed_mps,max_speed_mps,elevation_gain_m&id=eq.$ActivityId" -Body $null
"read back => $($read.Status) $($read.Body)"