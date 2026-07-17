# Install the PCL Automation Worker so it starts automatically at every logon
# and keeps running in the background forever, waiting for jobs.
#
#   Run once (normal PowerShell, no admin needed):
#     powershell -ExecutionPolicy Bypass -File install_worker_autostart.ps1
#
#   Remove it later:
#     schtasks /Delete /TN "PCL Automation Worker" /F
#
# NOTE: the task runs *in your logged-on session* on purpose — the Management
# report drives real Excel (xlwings), which needs an interactive desktop. A
# "run whether logged on or not" service task would break Excel automation.

$ErrorActionPreference = "Stop"
$TaskName = "PCL Automation Worker"
$Dir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bat      = Join-Path $Dir "run_worker.bat"

if (-not (Test-Path $Bat)) { throw "run_worker.bat not found next to this script ($Bat)" }

# Hidden window wrapper so no console pops up at logon
$Vbs = Join-Path $Dir "run_worker_hidden.vbs"
@"
Set s = CreateObject("WScript.Shell")
s.Run """$Bat""", 0, False
"@ | Set-Content -Path $Vbs -Encoding ASCII

# remove any previous copy (ignore "not found" on a first install)
cmd /c "schtasks /Delete /TN ""$TaskName"" /F >nul 2>&1"

$action  = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$Vbs`"" -WorkingDirectory $Dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)     # never time out

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Runs the PCL Management report on this PC when the live site queues a job." | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "  starts at every logon, restarts itself if it ever stops"
Write-Host "  log: $(Join-Path $Dir 'worker.log')"
Write-Host ""
Write-Host "Starting it now..."
cmd /c "schtasks /Run /TN ""$TaskName"" >nul 2>&1"
Start-Sleep -Seconds 5
cmd /c "schtasks /Query /TN ""$TaskName"" /FO LIST" | Select-String "TaskName|Status|Last Run"
