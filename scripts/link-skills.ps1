# Links each skill in this repository into the skills folders of Codex, Claude Code, and Cursor.
# One link per skill, so skills from other repositories can sit beside them.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$SkillsPath = (Join-Path $PSScriptRoot '..\skills'),
    [string]$UserProfilePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$normalize = { param($p) [System.IO.Path]::GetFullPath($p).TrimEnd('\', '/') }
$source = & $normalize (Resolve-Path -LiteralPath $SkillsPath).Path
$skills = @(Get-ChildItem -Directory -LiteralPath $source | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') })
if ($skills.Count -eq 0) { throw "No skills were found under $source." }
$linkType = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }

foreach ($consumer in @{ Name = 'Codex'; Path = '.agents\skills' }, @{ Name = 'Claude Code'; Path = '.claude\skills' }, @{ Name = 'Cursor'; Path = '.cursor\skills' }) {
    $folder = Join-Path $UserProfilePath $consumer.Path
    if (Test-Path -LiteralPath $folder) {
        $item = Get-Item -Force -LiteralPath $folder
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Warning "$($consumer.Name): $folder is a single link to '$(@($item.Target)[0])'. Convert it to per-skill links with that repository's bootstrap script, then run this again. Nothing was changed."
            continue
        }
    } elseif ($PSCmdlet.ShouldProcess($folder, 'Create skills folder')) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }

    foreach ($skill in $skills) {
        $link = Join-Path $folder $skill.Name
        if (Test-Path -LiteralPath $link) {
            $existing = Get-Item -Force -LiteralPath $link
            $target = if ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { & $normalize ([string]@($existing.Target)[0]) } else { $null }
            if ($target -and $target.Equals($skill.FullName, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
            $owner = if ($target) { $target } else { 'a real folder' }
            Write-Warning "$($consumer.Name): kept existing '$($skill.Name)' ($owner); this repository's copy was not linked."
            continue
        }
        if ($PSCmdlet.ShouldProcess($link, "Create $linkType to $($skill.FullName)")) {
            New-Item -ItemType $linkType -Path $link -Target $skill.FullName | Out-Null
            Write-Output "$($consumer.Name): linked $($skill.Name)"
        }
    }
}
Write-Output "Checked $($skills.Count) skills from $source. Restart open agent sessions to pick up new skills."
