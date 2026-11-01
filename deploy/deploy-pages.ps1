<#
  Build the frontend for GitHub Pages and publish it to the gh-pages branch.

  Default GitHub domain (https://<user>.github.io/<repo>/), API on Render:
    .\deploy\deploy-pages.ps1 -ApiBase https://ledger-api.onrender.com

  Custom domain sharing a parent with the API (enables cookie mode):
    .\deploy\deploy-pages.ps1 -ApiBase https://api.example.com -AppHost app.example.com

  On *.github.io + *.onrender.com the browser blocks the API's cookies, so the app is built in
  token mode (the Render service must have TOKEN_AUTH=true). Requires: node/npm, git, gh.
#>
param(
  [Parameter(Mandatory)][string]$ApiBase,
  [string]$AppHost = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$frontend = Join-Path $root 'frontend'
$out = Join-Path $frontend 'dist-pages'
$repo = (gh repo view --json nameWithOwner -q .nameWithOwner)
$owner, $name = $repo.Split('/')
$ApiBase = $ApiBase.TrimEnd('/')

Push-Location $frontend
try {
  $env:VITE_API_BASE = $ApiBase
  if ($AppHost) {
    $env:VITE_PAGES_CNAME = $AppHost
    $env:VITE_BASE = '/'
    $env:VITE_AUTH_MODE = 'cookie'
  } else {
    $env:VITE_BASE = "/$name/"
    $env:VITE_AUTH_MODE = 'token'
  }
  npx tsc --noEmit
  if ($LASTEXITCODE) { throw 'typecheck failed' }
  npx vite build --outDir dist-pages --emptyOutDir
  if ($LASTEXITCODE) { throw 'build failed' }
} finally {
  Remove-Item Env:VITE_API_BASE, Env:VITE_PAGES_CNAME, Env:VITE_BASE, Env:VITE_AUTH_MODE -ErrorAction SilentlyContinue
  Pop-Location
}

# Publish dist-pages as the single commit of an orphan gh-pages branch.
git -C $out init -q -b gh-pages
git -C $out add -A
git -C $out -c user.name="$(git -C $root config user.name)" -c user.email="$(git -C $root config user.email)" commit -q -m "Deploy app ($ApiBase)"
git -C $out push -q -f "https://github.com/$repo.git" gh-pages
Remove-Item -Recurse -Force (Join-Path $out '.git')

# Enable Pages from the gh-pages branch (first run) and set/clear the custom domain.
$null = gh api "repos/$repo/pages" 2>$null
if ($LASTEXITCODE) {
  gh api -X POST "repos/$repo/pages" -f "source[branch]=gh-pages" -f "source[path]=/" | Out-Null
}
if ($AppHost) {
  gh api -X PUT "repos/$repo/pages" -f "cname=$AppHost" | Out-Null
  Write-Host "Published https://$AppHost  (DNS: CNAME $AppHost -> $($owner.ToLower()).github.io)"
} else {
  Write-Host "Published https://$($owner.ToLower()).github.io/$name/"
}
