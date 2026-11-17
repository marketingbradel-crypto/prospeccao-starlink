# publicar.ps1 — faz TUDO de uma vez: commit + push + deploy na Cloudflare.
#
# Como usar (no terminal, dentro da pasta do projeto):
#   .\publicar.ps1 "sua mensagem de commit aqui"
#
# Se nao passar mensagem, usa uma padrao com a data/hora.
# Se nao houver nada pra commitar, pula o commit e vai direto pro deploy.

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Mensagem
)

$ErrorActionPreference = "Stop"
$ProjDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjDir

# Conta Cloudflare da Bradel (marketing.bradel) — necessaria em ambiente nao-interativo
$env:CLOUDFLARE_ACCOUNT_ID = "653bb4dc95bf8c3d4845f9aca64201ba"

function Passo($txt) { Write-Host "`n==> $txt" -ForegroundColor Cyan }

# Monta a mensagem de commit
$msg = ($Mensagem -join " ").Trim()
if ([string]::IsNullOrWhiteSpace($msg)) {
  $msg = "Atualizacao da plataforma ($(Get-Date -Format 'dd/MM/yyyy HH:mm'))"
}

# 0) CACHE-BUSTING: estampa uma versao nova nos assets (app.js/styles.css).
# Assim o navegador SEMPRE baixa a versao recem-publicada, em vez de usar o cache.
# Roda antes do commit para a versao ir junto no commit e valer tambem no deploy via GitHub.
Passo "Estampando versao dos assets (cache-busting)..."
$idx = Join-Path $ProjDir "cloudflare\public\index.html"
$ver = Get-Date -Format "yyyyMMddHHmm"
$txt = [System.IO.File]::ReadAllText($idx)
$txt = [regex]::Replace($txt, '(/static/(?:app\.js|styles\.css))\?v=[^"]*', "`${1}?v=$ver")
[System.IO.File]::WriteAllText($idx, $txt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Versao dos assets: $ver" -ForegroundColor Green

# 1) COMMIT (so se houver mudancas)
Passo "Verificando mudancas no git..."
$pendentes = git status --porcelain
if ($pendentes) {
  Passo "Commitando: $msg"
  git add -A
  git commit -m $msg
} else {
  Write-Host "Nada novo pra commitar." -ForegroundColor Yellow
}

# 2) PUSH (sincroniza o GitHub; tambem dispara o CI se estiver configurado)
Passo "Enviando pro GitHub (push)..."
git push

# 3) DEPLOY na Cloudflare (garante producao atualizada, independe do CI)
Passo "Publicando na Cloudflare (wrangler deploy)..."
Set-Location (Join-Path $ProjDir "cloudflare")
npx wrangler deploy
Set-Location $ProjDir

Passo "Pronto! Tudo publicado."
Write-Host "Producao: https://prospeccao-starlink.bradel.workers.dev" -ForegroundColor Green
