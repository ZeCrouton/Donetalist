# Deploiement de "Donetalist" sur Cloudflare (Worker + D1 + Assets)
# Usage (PowerShell, dans le dossier du projet) :  .\deploy.ps1
# Relancable sans risque : reutilise la base D1 si elle existe deja.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Run($cmd) {
  Write-Host ">> $cmd" -ForegroundColor Cyan
  $out = Invoke-Expression "$cmd 2>&1" | Out-String
  Write-Host $out
  return $out
}

# 0. Node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 18+ est requis (https://nodejs.org)." }

# 1. Connexion Cloudflare (ouvre le navigateur si besoin)
$who = Run "npx wrangler whoami"
if ($who -notmatch 'associated with the email|logged in') { Run "npx wrangler login" | Out-Null }

# 2. Coordonnees de la page de confidentialite (une seule fois)
$conf = Join-Path $PSScriptRoot 'public\confidentialite.html'
$html = [IO.File]::ReadAllText($conf, $utf8)
if ($html -match '\[VOTRE NOM OU PSEUDONYME\]') {
  $nom = Read-Host "Nom ou pseudonyme a afficher dans la page Confidentialite"
  $mail = Read-Host "Adresse e-mail de contact"
  $html = $html.Replace('[VOTRE NOM OU PSEUDONYME]', $nom).Replace('[VOTRE ADRESSE E-MAIL]', $mail)
  [IO.File]::WriteAllText($conf, $html, $utf8)
}

# 3. Base D1 : creation (ou recuperation si elle existe)
$toml = Join-Path $PSScriptRoot 'wrangler.toml'
$t = [IO.File]::ReadAllText($toml, $utf8)
if ($t -match 'REMPLACER_PAR_VOTRE_ID') {
  $id = $null
  try {
    $o = Run "npx wrangler d1 create donetalist"
    if ($o -match 'database_id"?\s*[:=]\s*"([0-9a-fA-F-]{36})"') { $id = $Matches[1] }
  } catch { }
  if (-not $id) {
    $json = (Invoke-Expression "npx wrangler d1 list --json 2>`$null" | Out-String)
    $db = ($json | ConvertFrom-Json) | Where-Object { $_.name -eq 'donetalist' } | Select-Object -First 1
    if ($db) { $id = $db.uuid }
  }
  if (-not $id) { throw "Impossible de recuperer le database_id. Copie-le a la main dans wrangler.toml." }
  $t = $t.Replace('REMPLACER_PAR_VOTRE_ID', $id)
  [IO.File]::WriteAllText($toml, $t, $utf8)
  Write-Host "database_id = $id" -ForegroundColor Green
}

# 4. Schema (CREATE TABLE IF NOT EXISTS : sans danger si deja applique)
Run "npx wrangler d1 execute donetalist --remote --file=schema.sql" | Out-Null

# 5. Deploiement
$res = Run "npx wrangler deploy"
if ($res -match 'https://\S+\.workers\.dev') { Write-Host "`nSite en ligne : $($Matches[0])" -ForegroundColor Green }
