param([switch]$Offline, [switch]$IncludeLocalHandbook)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$radarRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$radarWork=Join-Path $radarRoot '.data/experiments/pdf-real-corpus'
New-Item -Path $radarWork -ItemType Directory -Force | Out-Null
$radarHeaders=@{'User-Agent'='opportunity-radar-public-corpus';'Accept'='application/vnd.github+json'}
if(-not $Offline -and (Test-Path (Join-Path $radarRoot '.env'))){
 $radarTokenEntry=Get-Content (Join-Path $radarRoot '.env') | Where-Object {$_ -match '^GITHUB_TOKEN='} | Select-Object -First 1
 if($radarTokenEntry){$radarHeaders.Authorization='Bearer '+$radarTokenEntry.Substring(13).Trim().Trim('"').Trim("'")}
}
$radarRepo='opendataloader-project/opendataloader-pdf'
$radarCommit='a8d35e93675be2581ee0213b31727f023d8a5ea8'
# Reuse the complete tree saved before the TLS failure, keeping the corpus
# commit separate from the fixed binary release used by the experiment.
$radarTree=Get-Content (Join-Path $radarRoot '.data/research/opendataloader-pdf-tree.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($radarTree.truncated){throw 'Corpus tree is incomplete'}
$radarPaths=@(
 'samples/pdf/1901.03003.pdf',
 'samples/pdf/2408.02509v1.pdf',
 'samples/pdf/chinese_scan.pdf',
 'samples/pdf/pdfua-1-reference-suite-1-1/PDFUA-Ref-2-02_Invoice.pdf',
 'samples/pdf/pdfua-1-reference-suite-1-1/PDFUA-Ref-2-03_AcademicAbstract.pdf',
 'samples/pdf/pdfua-1-reference-suite-1-1/PDFUA-Ref-2-04_Presentation.pdf',
 'samples/pdf/pdfua-1-reference-suite-1-1/PDFUA-Ref-2-05_BookChapter-german.pdf',
 'samples/pdf/pdfua-1-reference-suite-1-1/PDFUA-Ref-2-06_Brochure.pdf',
 'samples/pdf/pdfua-1-reference-suite-1-1/PDFUA-Ref-2-10_Form.pdf'
)
$radarSources=@()
$radarNetworkFailure=$null
foreach($radarPath in $radarPaths){
 $radarEntry=$radarTree.tree | Where-Object path -EQ $radarPath | Select-Object -First 1
 if(-not $radarEntry -or $radarEntry.size -gt 5MB){throw "Missing or oversized public corpus file: $radarPath"}
 $radarRelative='upstream/'+$radarPath.Substring('samples/pdf/'.Length)
 $radarTarget=Join-Path (Join-Path $radarWork 'input') $radarRelative
 New-Item -Path (Split-Path -Parent $radarTarget) -ItemType Directory -Force | Out-Null
 $radarSource=@{path=$radarRelative;url="https://github.com/$radarRepo/blob/$radarCommit/$radarPath";repositoryCommit=$radarCommit;gitBlob=$radarEntry.sha}
 if(-not (Test-Path -LiteralPath $radarTarget)){
  if($Offline -or $radarNetworkFailure){$radarSource.status=if($Offline){'not-attempted-offline'}else{'not-attempted-after-network-failure'};$radarSources+=,$radarSource;continue}
  try{$radarBlob=Invoke-RestMethod "https://api.github.com/repos/$radarRepo/git/blobs/$($radarEntry.sha)" -Headers $radarHeaders -TimeoutSec 25}catch{$radarNetworkFailure=$_.Exception.Message;$radarSource.status='failed';$radarSource.fetchError=$radarNetworkFailure;$radarSources+=,$radarSource;continue}
  if($radarBlob.encoding -ne 'base64'){throw 'Unexpected GitHub blob encoding'}
  $radarDecoded=[Convert]::FromBase64String($radarBlob.content)
  if($radarDecoded.Length -ne $radarEntry.size -or $radarDecoded.Length -gt 5MB -or $radarDecoded.Length -lt 5 -or [System.Text.Encoding]::ASCII.GetString($radarDecoded,0,5) -ne '%PDF-'){throw 'Unexpected public corpus size or file type'}
  [System.IO.File]::WriteAllBytes($radarTarget,$radarDecoded)
 }
 $radarBytes=[System.IO.File]::ReadAllBytes($radarTarget)
 $radarPrefix=[System.Text.Encoding]::ASCII.GetBytes("blob $($radarBytes.Length)`0")
 $radarSha1=[System.Security.Cryptography.SHA1]::Create()
 try{$radarActual=[BitConverter]::ToString($radarSha1.ComputeHash($radarPrefix+$radarBytes)).Replace('-','').ToLowerInvariant()}finally{$radarSha1.Dispose()}
 if($radarActual -ne $radarEntry.sha){throw "Public corpus Git blob mismatch: $radarPath"}
 $radarKind=if($radarPath -match 'reference-suite'){'PDF/UA reference control'}elseif($radarPath -match 'chinese_scan'){'upstream scan sample'}else{'public research paper mirrored upstream'}
 $radarSources+=@{path=$radarRelative;status='available';kind=$radarKind;url="https://github.com/$radarRepo/blob/$radarCommit/$radarPath";repositoryCommit=$radarCommit;gitBlob=$radarEntry.sha;sha256=(Get-FileHash -LiteralPath $radarTarget -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$radarBytes.Length}
 Write-Output "Verified $radarRelative ($($radarBytes.Length) bytes)"
}
foreach($radarName in @('fw9','f1040')){
 $radarUrl="https://www.irs.gov/pub/irs-pdf/$radarName.pdf"
 $radarRelative="government/irs/$radarName.pdf"
 $radarTarget=Join-Path (Join-Path $radarWork 'input') $radarRelative
 New-Item -Path (Split-Path -Parent $radarTarget) -ItemType Directory -Force | Out-Null
 if(-not (Test-Path -LiteralPath $radarTarget) -and ($Offline -or $radarNetworkFailure)){
  $radarSources+=@{path=$radarRelative;kind='public government form';url=$radarUrl;status=$(if($Offline){'not-attempted-offline'}else{'not-attempted-after-network-failure'})};continue
 }
 try{
  if(-not (Test-Path -LiteralPath $radarTarget)){Invoke-WebRequest $radarUrl -OutFile $radarTarget -UseBasicParsing -TimeoutSec 30}
  $radarBytes=[System.IO.File]::ReadAllBytes($radarTarget)
  if($radarBytes.Length -gt 5MB -or [System.Text.Encoding]::ASCII.GetString($radarBytes,0,[Math]::Min(5,$radarBytes.Length)) -ne '%PDF-'){throw 'Response is not a bounded PDF'}
  $radarSources+=@{path=$radarRelative;status='available';kind='public government form';url=$radarUrl;sha256=(Get-FileHash -LiteralPath $radarTarget -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$radarBytes.Length}
  Write-Output "Fetched $radarRelative ($($radarBytes.Length) bytes)"
 }catch{
  $radarNetworkFailure=$_.Exception.Message
  $radarSources+=@{path=$radarRelative;status='failed';kind='public government form';url=$radarUrl;fetchError=$_.Exception.Message}
  Write-Output "Government source unavailable: $radarName; retained acquisition failure"
 }
}
if($IncludeLocalHandbook){
 $radarLocal=Join-Path (Split-Path -Parent $radarRoot) 'iii/sdk/test-assets/handbook.pdf'
 $radarBytes=[System.IO.File]::ReadAllBytes($radarLocal)
 if($radarBytes.Length -gt 25MB){throw 'Local sample exceeds 25 MiB experiment bound'}
 $radarPrefix=[System.Text.Encoding]::ASCII.GetBytes("blob $($radarBytes.Length)`0")
 $radarSha1=[System.Security.Cryptography.SHA1]::Create()
 try{$radarActual=[BitConverter]::ToString($radarSha1.ComputeHash($radarPrefix+$radarBytes)).Replace('-','').ToLowerInvariant()}finally{$radarSha1.Dispose()}
 if($radarActual -ne '4bf6e9edc87b21886d97684e2c942e162e409e7b'){throw 'Local iii sample differs from the pinned public Git blob'}
 $radarRelative='local-public-mirror/handbook.pdf'
 $radarTarget=Join-Path (Join-Path $radarWork 'input') $radarRelative
 New-Item -Path (Split-Path -Parent $radarTarget) -ItemType Directory -Force | Out-Null
 [System.IO.File]::WriteAllBytes($radarTarget,$radarBytes)
 $radarSources+=@{path=$radarRelative;status='available';kind='public RPG instructional handbook mirrored in iii';acquisition='already-cloned-public-git-blob';url='https://github.com/iii-hq/iii/blob/05440e1fb1b5080285c156ab6fd1a4def4310ae2/sdk/test-assets/handbook.pdf';repositoryCommit='05440e1fb1b5080285c156ab6fd1a4def4310ae2';gitBlob=$radarActual;sha256=(Get-FileHash -LiteralPath $radarTarget -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$radarBytes.Length;licenseNote='Basic Fantasy RPG 4th Edition, Chris Gonnerman. Text/maps CC BY-SA 4.0; artwork has separate restrictions. Local evaluation only: do not distribute the original or converted PDF in product artifacts.'}
}
$radarManifest=@{observedAt=[DateTime]::UtcNow.ToString('o');offline=[bool]$Offline;networkFailure=$radarNetworkFailure;sources=$radarSources;limitations=@('Purposive public sample; six planned controls come from the tool upstream and are selection-biased.','Only status=available entries are acquired inputs; unavailable documents are not validation results.','No real client files or user timing; IRS URLs are mutable and frozen by the downloaded SHA-256.','Existing reference documents are controls, not evidence that real customer documents are already compliant.','The optional local iii sample is a game handbook, not an institutional corpus; artwork permissions differ, so PDFs stay local.')}
[System.IO.File]::WriteAllText((Join-Path $radarWork 'sources.json'),($radarManifest|ConvertTo-Json -Depth 8),[System.Text.UTF8Encoding]::new($false))
Write-Output "Manifest: $(@($radarSources | Where-Object status -EQ 'available').Count) available / $($radarSources.Count) listed; offline=$Offline"
