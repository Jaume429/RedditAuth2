# setup-task.ps1 - Create Windows Task Scheduler task for RedditAuth Daily Research

# Run as Administrator
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] 'Administrator')) {
    Write-Host "This script must be run as Administrator. Relaunching..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$taskName = "RedditAuth Daily Research"
$taskPath = "\"
$scriptPath = "C:\Users\jaume\Documents\RedditAuth2\run-research.bat"

# Check if task already exists and remove it
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task '$taskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Create trigger for logon
$trigger = New-ScheduledTaskTrigger -AtLogOn

# Create action to run the batch script
$action = New-ScheduledTaskAction -Execute $scriptPath

# Create settings for the task
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Register the task
Register-ScheduledTask `
    -TaskName $taskName `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Description "Runs daily Reddit research automation job at user logon" `
    -Force | Out-Null

Write-Host "Task '$taskName' created successfully!" -ForegroundColor Green
Write-Host "The task will run '$scriptPath' when you log in." -ForegroundColor Cyan
Write-Host ""
Write-Host "To view the task:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor Gray
Write-Host ""
Write-Host "To run manually:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor Gray
