$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$latest = Get-Content -Raw (Join-Path $workspace '.data/experiments/latest-map-pptx.json') | ConvertFrom-Json
$directory = [IO.Path]::GetFullPath((Join-Path $workspace $latest.directory))
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.data/experiments/runs')) + [IO.Path]::DirectorySeparatorChar
if (-not $directory.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Experiment directory is outside the expected root' }
$alreadyRunning = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$application = $null
$presentation = $null
$originalAlerts = $null
$originalSecurity = $null
$records = @()
try {
    $application = New-Object -ComObject PowerPoint.Application
    $originalAlerts = $application.DisplayAlerts
    $originalSecurity = $application.AutomationSecurity
    $application.DisplayAlerts = 1
    $application.AutomationSecurity = 3
    foreach ($name in @('baseline', 'updated-1', 'updated-2')) {
        $file = Join-Path $directory ($name + '.pptx')
        # Read-only, no separate editor window. Never save changes to the input.
        $presentation = $application.Presentations.Open($file, -1, 0, 0)
        if ($presentation.Slides.Count -ne 1) { throw 'Expected one slide' }
        $slide = $presentation.Slides.Item(1)
        if ($slide.Shapes.Count -ne 1) { throw 'Expected one map picture' }
        $shape = $slide.Shapes.Item(1)
        $png = Join-Path $directory ($name + '-powerpoint.png')
        $slide.Export($png, 'PNG', 1600, 900)
        if (-not (Test-Path -LiteralPath $png)) { throw 'PowerPoint did not export the slide' }
        $records += [pscustomobject]@{
            input = ($name + '.pptx')
            output = ($name + '-powerpoint.png')
            slides = $presentation.Slides.Count
            shapes = $slide.Shapes.Count
            imageBoundsPoints = [pscustomobject]@{left=$shape.Left;top=$shape.Top;width=$shape.Width;height=$shape.Height}
        }
        $presentation.Close()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($slide)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)
        $presentation = $null
    }
    $result = [pscustomobject]@{
        executedAt = [DateTime]::UtcNow.ToString('o')
        renderer = 'Microsoft PowerPoint'
        version = $application.Version
        readOnly = $true
        records = $records
    }
    [IO.File]::WriteAllText((Join-Path $directory 'powerpoint-result.json'), ($result | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    $result | ConvertTo-Json -Depth 5
} finally {
    if ($null -ne $presentation) { $presentation.Close(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
    if ($null -ne $application) {
        if ($null -ne $originalAlerts) { $application.DisplayAlerts = $originalAlerts }
        if ($null -ne $originalSecurity) { $application.AutomationSecurity = $originalSecurity }
        if (-not $alreadyRunning) { $application.Quit() }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)
    }
}
