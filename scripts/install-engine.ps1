$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$radarRoot = Split-Path -Parent $PSScriptRoot
$engineDirectory = Join-Path $radarRoot '.tools\iii-0.24.5'
$archivePath = Join-Path $engineDirectory 'iii.zip'
$expectedHash = 'd0c30501460b4256a35b384739d776e74864212410325abeb6bf0deb9a0f1cf5'
New-Item -ItemType Directory -Path $engineDirectory -Force | Out-Null
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/iii-hq/iii/releases/tags/iii%2Fv0.24.5' -Headers @{ 'User-Agent'='opportunity-radar-setup' } -TimeoutSec 20
$asset = $release.assets | Where-Object name -EQ 'iii-x86_64-pc-windows-msvc.zip'
if (-not $asset) { throw 'Official Windows x64 release asset was not found' }
if ($asset.digest -and $asset.digest -ne "sha256:$expectedHash") { throw 'Official release digest differs from the pinned digest' }
# Use the official API, which can work when the github.com web domain is unreachable.
$downloaded = $false
foreach ($address in @('') + @(Resolve-DnsName release-assets.githubusercontent.com -Type A | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress)) {
  $curlArguments = @('--ssl-revoke-best-effort','--fail','--location','--silent','--show-error','--connect-timeout','5','--max-time','45','-H','Accept: application/octet-stream','-H','User-Agent: opportunity-radar-setup')
  if ($address) { $curlArguments += @('--resolve',"release-assets.githubusercontent.com:443:$address") }
  $curlArguments += @("$($asset.url)?download=1",'--output',$archivePath)
  & curl.exe @curlArguments
  if ($LASTEXITCODE -eq 0 -and (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -eq $expectedHash) { $downloaded = $true; break }
}
if (-not $downloaded) { throw 'Could not download an Engine archive matching the official pinned SHA-256' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $engineDirectory -Force
& (Join-Path $engineDirectory 'iii.exe') --version
Write-Output 'iii Engine installed and checksum verified.'
