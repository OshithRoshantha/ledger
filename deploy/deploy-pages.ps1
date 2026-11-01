<#
  Build the frontend for GitHub Pages and publish it to the gh-pages branch.

    .\deploy\deploy-pages.ps1 -AppHost money.example.com -ApiHost money-api.example.com

  The app and API must share a parent domain (same-site), so the HttpOnly session cookies
  work in iPhone Safari. Requires: node/npm, git, gh (logged in).
#>
param(
  [Parameter(Mandatory)][string]$AppHost,
  [Parameter(Mandatory)][string]$ApiHost
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$frontend = Join-Path $root 'frontend'
$out = Join-Path $frontend 'dist-pages'
$repo = (gh repo view --json nameWithOwner -q .nameWithOwner)

Push-Location $frontend
try {
  $env:VITE_API_BASE = "https://$ApiHost"
  $env:VITE_PAGES_CNAME = $AppHost
  npx tsc --noEmit
  if ($LASTEXITCODE) { throw 'typecheck failed' }
  npx vite build --outDir dist-pages --emptyOutDir
  if ($LASTEXITCODE) { throw 'build failed' }
} finally {
  Remove-Item Env:VITE_API_BASE, Env:VITE_PAGES_CNAME -ErrorAction SilentlyContinue
  Pop-Location
}

# Publish dist-pages as the single commit of an orphan gh-pages branch.
git -C $out init -q -b gh-pages
git -C $out add -A
git -C $out -c user.name="$(git -C $root config user.name)" -c user.email="$(git -C $root config user.email)" commit -q -m "Deploy app to $AppHost"
git -C $out push -f "https://github.com/$repo.git" gh-pages
Remove-Item -Recurse -Force (Join-Path $out '.git')

# Enable Pages from gh-pages (idempotent) and set the custom domain.
gh api -X POST "repos/$repo/pages" -f "source[branch]=gh-pages" -f "source[path]=/" 2>$null | Out-Null
gh api -X PUT "repos/$repo/pages" -f "cname=$AppHost" -F "source[branch]=gh-pages" -F "source[path]=/" | Out-Null
Write-Host "Published. DNS: CNAME $AppHost -> $($repo.Split('/')[0].ToLower()).github.io"
Write-Host "When the certificate is issued:  gh api -X PUT repos/$repo/pages -F https_enforced=true"
