$ErrorActionPreference = "Stop"

$expectedSiteId = "3f63f461-cc29-4195-bd6e-ef6f6aa85d7d"
$expectedSiteUrl = "https://scanner-insights-fslc.netlify.app"
$expectedTitle = "Scanner Insights"
$repoRoot = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $repoRoot "public\index.html"

if (-not (Test-Path $indexPath)) {
  throw "Expected public\index.html under $repoRoot."
}

$indexHtml = Get-Content $indexPath -Raw
if ($indexHtml -notmatch "<title>$([regex]::Escape($expectedTitle))</title>") {
  throw "Refusing deploy: public\index.html is not $expectedTitle."
}

$gitRoot = (git -C $repoRoot rev-parse --show-toplevel).Trim()
$normalizedGitRoot = [System.IO.Path]::GetFullPath($gitRoot)
$normalizedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
if ($normalizedGitRoot -ne $normalizedRepoRoot) {
  throw "Refusing deploy: repo root mismatch. Expected $repoRoot, got $gitRoot."
}

npx.cmd netlify-cli@latest deploy `
  --prod `
  --build `
  --site $expectedSiteId `
  --message "Scanner Insights guarded deploy"

$cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$response = Invoke-WebRequest -UseBasicParsing "$expectedSiteUrl/?v=$cacheBust"
if ($response.Content -notmatch "<title>$([regex]::Escape($expectedTitle))</title>") {
  throw "Deploy verification failed: $expectedSiteUrl is not serving $expectedTitle."
}

Write-Host "Verified $expectedTitle at $expectedSiteUrl"
