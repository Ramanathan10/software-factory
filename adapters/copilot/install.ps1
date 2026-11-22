# Installs the Command Center extension and this repository's skills for the GitHub Copilot app.
param(
    [string]$Destination = (Join-Path $env:USERPROFILE '.copilot')
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$skillsSource = Join-Path $repo 'skills'

foreach ($tool in 'node', 'git') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Write-Warning "$tool was not found on PATH; install it before running Jarvis." }
}
if ((Get-Command node -ErrorAction SilentlyContinue) -and [int]((node --version).TrimStart('v').Split('.')[0]) -lt 22) {
    Write-Warning 'Node 22 or newer is required (Node 22 needs --experimental-sqlite; Node 24 does not).'
}

function Install-Folder([string]$Source, [string]$Target, [switch]$KeepExisting) {
    if (Test-Path $Target) {
        if ($KeepExisting) { Write-Host "Kept existing $Target"; return }
        $backup = "$Target.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Move-Item $Target $backup
        Write-Host "Backed up $Target -> $backup"
    }
    New-Item -ItemType Directory (Split-Path $Target) -Force | Out-Null
    Copy-Item $Source $Target -Recurse
    Write-Host "Installed $Target"
}

# The extension folder is assembled from this repository's parts so the app runs without the checkout.
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "ai-sdlc-console-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory $stage | Out-Null
try {
    Copy-Item (Join-Path $PSScriptRoot 'extension.mjs') $stage
    foreach ($part in 'command-center', 'mission-console', 'readiness-sync') {
        Copy-Item (Join-Path $repo $part) (Join-Path $stage $part) -Recurse
    }
    Install-Folder $stage (Join-Path $Destination 'extensions\ai-sdlc-console')
} finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($skill in Get-ChildItem -Directory $skillsSource) {
    Install-Folder $skill.FullName (Join-Path $Destination "skills\$($skill.Name)") -KeepExisting:($skill.Name -eq 'diagram-design')
}

Write-Host "`nDone. Restart the GitHub Copilot app, open a new chat and say: 'Be Jarvis. Run AI SDLC.'"
Write-Host 'The first run sets up the AI SDLC profiles (ai-sdlc-setup), then the Copilot adapter questions in adapters\copilot\setup.md.'
