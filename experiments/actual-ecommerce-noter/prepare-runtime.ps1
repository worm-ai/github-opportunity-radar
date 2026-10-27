$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskRuntime = Join-Path $taskRoot '.data/experiments/actual-ecommerce-noter/python'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$runtimeUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
$runtimeHash = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
$runtimeZip = Join-Path $taskRuntime 'python-3.12.10-embed-amd64.zip'
if (!(Test-Path -LiteralPath $runtimeZip)) {
    Invoke-WebRequest -Uri $runtimeUrl -OutFile $runtimeZip -UseBasicParsing -TimeoutSec 60
}
if ((Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeHash) {
    throw 'Python archive differs from the pinned observed SHA-256'
}
if (!(Test-Path -LiteralPath (Join-Path $taskRuntime 'python.exe'))) {
    Expand-Archive -LiteralPath $runtimeZip -DestinationPath $taskRuntime
}
$taskSite = Join-Path $taskRuntime 'site-packages'
New-Item -ItemType Directory -Path $taskSite -Force | Out-Null
& node (Join-Path $PSScriptRoot 'prepare-wheels.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Wheel download failed' }
$taskManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $taskRuntime 'runtime.json') | ConvertFrom-Json
foreach ($taskWheel in $taskManifest.wheels) {
    $wheelZip = Join-Path $taskRuntime ($taskWheel.filename + '.zip')
    Expand-Archive -LiteralPath $wheelZip -DestinationPath $taskSite -Force
}
[System.IO.File]::WriteAllText((Join-Path $taskRuntime 'python312._pth'), "python312.zip`n.`nsite-packages`n", [System.Text.UTF8Encoding]::new($false))
& (Join-Path $taskRuntime 'python.exe') -c 'import sys, requests; print(sys.version); print(requests.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'Isolated Python runtime failed' }
