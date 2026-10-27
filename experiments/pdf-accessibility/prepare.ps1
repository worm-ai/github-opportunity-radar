$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$radarRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$radarWork = Join-Path $radarRoot '.data/experiments/pdf-accessibility'
New-Item -Path $radarWork -ItemType Directory -Force | Out-Null
$radarPackages = @(
    @{name='opendataloader_pdf-2.5.13-py3-none-any.whl';url='https://files.pythonhosted.org/packages/ee/52/07666c3511ee926f5bb0412394d7a937d6a592f0f462356f1be91a3cad8a/opendataloader_pdf-2.5.13-py3-none-any.whl';sha256='c60640bb33172ea83f35395da3277b18d575206337e2b56ceecea2c1f44e08ed'},
    @{name='pypdf-6.21.1-py3-none-any.whl';url='https://files.pythonhosted.org/packages/85/e6/24c944e473c34e818cf1b98085796fcd780465ecfe17663f2bf8fee1958b/pypdf-6.21.1-py3-none-any.whl';sha256='553e2d42f5bb3bb2a785a7d3de8ef90bb7df74b5413eff5a7b4388007ea9254b'},
    @{name='verapdf-greenfield-apps-1.28.2.jar';url='https://repo.maven.apache.org/maven2/org/verapdf/apps/greenfield-apps/1.28.2/greenfield-apps-1.28.2.jar';sha256='687d4d8bcfec48c9f7e931cf78ed061f1eeccfba55d4cdc000ba9b4d8aa46ce6'}
)
foreach ($radarPackage in $radarPackages) {
    $radarTarget = Join-Path $radarWork $radarPackage.name
    if (-not (Test-Path -LiteralPath $radarTarget)) { Invoke-WebRequest $radarPackage.url -OutFile $radarTarget -UseBasicParsing -TimeoutSec 60 }
    if ((Get-FileHash -LiteralPath $radarTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $radarPackage.sha256) { throw "Dependency hash mismatch: $($radarPackage.name)" }
}
$radarRuntime = @{packages=$radarPackages;sources=@(
    @{repository='opendataloader-project/opendataloader-pdf';tag='v2.5.13';commit='1f1b3e9c67e5052e35082d55e77ab90d2ed25d17'},
    @{repository='veraPDF/veraPDF-apps';tag='v1.28.2';commit='77e46c943af719be041f0462307fd43ff7dd41a6'}
);java='JBR 21.0.6; override RADAR_EXPERIMENT_JAVA with a Java 17+ java.exe path';python='Python 3.12.10 from the previous isolated experiment; no global packages changed'}
$radarRuntime | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $radarWork 'runtime.json') -Encoding utf8
$radarPython = Join-Path $radarRoot '.data/experiments/actual-ecommerce-noter/python/python.exe'
if (-not (Test-Path -LiteralPath $radarPython)) { throw 'Prepare the existing isolated Python runtime first, or extract the wheels with your Python 3.12 installation.' }
$radarUnpack = @'
from pathlib import Path
import sys, zipfile
root = Path(sys.argv[1])
for wheel in root.glob('*.whl'):
    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(root/'python')
print('Pinned dependencies verified and extracted; no global installation.')
'@
& $radarPython -c $radarUnpack $radarWork
if ($LASTEXITCODE -ne 0) { throw 'Wheel extraction failed' }
