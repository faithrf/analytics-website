# Daily: save today's ARK holdings and derive the day's trades. Log: research-out/daily-funds.log (gitignored).
# Not registered by default. To register (weekdays 23:30 local, after ARK posts its files):
#   schtasks /Create /TN "Meridian Daily Funds" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 23:30 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"<repo>\scripts\daily-funds.ps1\""
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$logDir = Join-Path $repo "research-out"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "daily-funds.log"
function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) }

Log "=== daily funds run start ==="
$fail = $false
$steps = @(
  @{ name = "funds:snapshot"; args = "run funds:snapshot" }
)
foreach ($s in $steps) {
  Log "step $($s.name) start"
  $out = & cmd.exe /c "npm $($s.args) 2>&1"
  $code = $LASTEXITCODE
  $tail = ($out | Select-Object -Last 12) -join "`n"
  Add-Content -Path $log -Value $tail
  if ($code -eq 0) { Log "step $($s.name) OK" } else { Log "step $($s.name) FAILED (exit $code)"; $fail = $true; break }
}
if ($fail) { Log "=== daily funds run FAILED ==="; exit 1 }
Log "=== daily funds run OK ==="
