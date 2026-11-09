# Weekly: retrain the model, then update the forward paper ledger. Log: research-out/weekly-model.log (gitignored).
# Registered as Task Scheduler task "Meridian Weekly Model" (Saturdays 10:00).
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$logDir = Join-Path $repo "research-out"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "weekly-model.log"
function Log($m) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) }

Log "=== weekly model run start ==="
$fail = $false
# model:train refreshes the bar cache; paper:update then reuses it
$steps = @(
  @{ name = "model:train"; args = "run model:train -- --refresh" },
  @{ name = "paper:update"; args = "run paper:update -- --cached" }
)
foreach ($s in $steps) {
  Log "step $($s.name) start"
  $out = & cmd.exe /c "npm $($s.args) 2>&1"
  $code = $LASTEXITCODE
  $tail = ($out | Select-Object -Last 12) -join "`n"
  Add-Content -Path $log -Value $tail
  if ($code -eq 0) { Log "step $($s.name) OK" } else { Log "step $($s.name) FAILED (exit $code)"; $fail = $true; break }
}
if ($fail) { Log "=== weekly model run FAILED ==="; exit 1 }
Log "=== weekly model run OK ==="
