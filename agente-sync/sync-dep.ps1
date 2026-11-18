<#
.SYNOPSIS
  Agente local de sincronizacao da pasta de rede -> plataforma Prospeccao Starlink.

.DESCRIPTION
  O sistema roda num Cloudflare Worker (nuvem) que NAO enxerga a pasta de rede
  (U:\Matriz\Back office\Dep / \\192.168.172.145\Documentos\...). Este agente roda
  DENTRO da rede da Bradel, le a pasta, detecta se o arquivo-mestre
  (Cadastros Starlink - consolidado Oficial.xlsx) mudou e, se mudou, EMPURRA o
  arquivo para o Worker (/api/sync/ingest), que reimporta na base de forma
  incremental e nao-destrutiva. Terca e sexta as 12:00 (BRT), via Agendador de
  Tarefas do Windows (ver instalar-tarefa.ps1). Ver LEIA-ME.md.

  Incremental: so calcula o hash SHA-256 de arquivos cujo tamanho/data mudou
  (nao re-hasheia tudo) e so envia o mestre quando ele realmente muda. Resiliente:
  se a pasta estiver indisponivel, registra a falha no servidor, MANTEM o ultimo
  estado valido e sai (o Agendador re-tenta). Nenhum dado interno e sobrescrito
  sem validacao (o Worker faz merge nao-destrutivo + dedup).

.PARAMETER Now
  Execucao manual imediata (testes / necessidade extraordinaria). Marca origem='manual'.

.PARAMETER ConfigPath
  Caminho de um JSON de configuracao (padrao: config.local.json ao lado do script).
#>
[CmdletBinding()]
param(
  [switch]$Now,
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
# TLS 1.2 explicito (necessario no Windows PowerShell 5.1 para falar com o Worker).
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --------------------------------------------------------------------------
# Configuracao
# --------------------------------------------------------------------------
# Defaults (podem ser sobrescritos pelo config.local.json ou variaveis de ambiente).
$cfg = [ordered]@{
  # UNC e preferido: funciona mesmo quando o drive U: nao esta mapeado (ex.: tarefa
  # agendada rodando sem a sessao do usuario). O U: entra como fallback.
  PastaOrigem   = '\\192.168.172.145\Documentos\Matriz\Back office\Dep'
  PastaFallback = 'U:\Matriz\Back office\Dep'
  ArquivoMestre = 'Cadastros Starlink - consolidado Oficial.xlsx'
  ApiBase       = 'https://prospeccao-starlink.bradel.workers.dev'
  Token         = ''
}

if (-not $ConfigPath) { $ConfigPath = Join-Path $ScriptDir 'config.local.json' }
if (Test-Path -LiteralPath $ConfigPath) {
  try {
    $json = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @($cfg.Keys)) { if ($json.PSObject.Properties.Name -contains $k -and $json.$k) { $cfg[$k] = $json.$k } }
  } catch { Write-Warning "config.local.json invalido: $($_.Exception.Message)" }
}
# Variavel de ambiente tem a ultima palavra no token (nao fica em disco).
if ($env:SYNC_TOKEN) { $cfg.Token = $env:SYNC_TOKEN }

$Origem = if ($Now) { 'manual' } else { 'agendado' }

# --------------------------------------------------------------------------
# Estado + log (persistem entre execucoes; sobrevivem a reinicios)
# --------------------------------------------------------------------------
$StateDir  = Join-Path $env:ProgramData 'ProspeccaoStarlink'
if (-not (Test-Path -LiteralPath $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
$StateFile = Join-Path $StateDir 'sync-state.json'
$LogFile   = Join-Path $StateDir 'sync.log'

function Write-Log {
  param([string]$Msg, [string]$Nivel = 'INFO')
  $linha = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Nivel, $Msg
  Write-Host $linha
  try {
    Add-Content -LiteralPath $LogFile -Value $linha -Encoding UTF8
    # Log rolante simples: trunca se passar de ~2 MB.
    if ((Get-Item -LiteralPath $LogFile).Length -gt 2MB) {
      $tail = Get-Content -LiteralPath $LogFile -Tail 500
      Set-Content -LiteralPath $LogFile -Value $tail -Encoding UTF8
    }
  } catch {}
}

function Load-State {
  if (Test-Path -LiteralPath $StateFile) {
    try {
      $raw = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $map = @{}
      foreach ($p in $raw.PSObject.Properties) { $map[$p.Name] = $p.Value }
      return $map
    } catch { Write-Log "sync-state.json ilegivel, recomecando do zero: $($_.Exception.Message)" 'WARN' }
  }
  return @{}
}

function Save-State {
  param([hashtable]$Map)
  # Salvo SO apos ack do servidor (integridade: um envio que falhou nao "consome"
  # a mudanca — na proxima execucao o agente tenta de novo).
  ($Map | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

# --------------------------------------------------------------------------
# HTTP (com retentativa) — §6 politica de retentativa
# --------------------------------------------------------------------------
function Invoke-WithRetry {
  param([scriptblock]$Acao, [int]$Tentativas = 3)
  for ($t = 1; $t -le $Tentativas; $t++) {
    try { return & $Acao }
    catch {
      if ($t -eq $Tentativas) { throw }
      $espera = [Math]::Pow(2, $t) # 2s, 4s
      Write-Log "Tentativa $t falhou ($($_.Exception.Message)). Nova tentativa em ${espera}s." 'WARN'
      Start-Sleep -Seconds $espera
    }
  }
}

function Post-Run {
  # Registra uma execucao SEM arquivo (falha / sem alteracao). Nunca lanca:
  # o monitoramento nao pode derrubar o agente nem o sistema (§6).
  param([hashtable]$Payload)
  try {
    $uri = ($cfg.ApiBase.TrimEnd('/')) + '/api/sync/run'
    Invoke-WithRetry { Invoke-RestMethod -Method Post -Uri $uri -Headers @{ 'X-Sync-Token' = $cfg.Token } `
        -ContentType 'application/json; charset=utf-8' -Body ($Payload | ConvertTo-Json -Compress) -TimeoutSec 60 } | Out-Null
    Write-Log "Execucao registrada no servidor (status=$($Payload.status))."
  } catch { Write-Log "Nao consegui registrar a execucao no servidor: $($_.Exception.Message)" 'WARN' }
}

# Le os bytes de um arquivo tolerando que ele esteja ABERTO por outro processo
# (ex.: o mestre aberto no Excel). FileShare.ReadWrite evita o erro "esta sendo
# usado por outro processo".
function Get-FileBytesShared {
  param([string]$Path)
  $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try { $ms = [System.IO.MemoryStream]::new(); $fs.CopyTo($ms); return $ms.ToArray() }
  finally { $fs.Dispose() }
}

function Get-Sha256 {
  param([string]$Path)
  $bytes = Get-FileBytesShared $Path
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLower() }
  finally { $sha.Dispose() }
}

function Post-Ingest {
  # Envia o arquivo-mestre (multipart) via System.Net.Http — funciona tanto no
  # Windows PowerShell 5.1 quanto no PowerShell 7+ (nao depende de -Form). Os nomes
  # das partes vao com ASPAS (name="x"), exigidas pelo parser de FormData do workerd.
  param([string]$FilePath, [string]$Sha, [hashtable]$Counts)
  Add-Type -AssemblyName System.Net.Http
  $uri = ($cfg.ApiBase.TrimEnd('/')) + '/api/sync/ingest'
  return Invoke-WithRetry {
    $client = [System.Net.Http.HttpClient]::new()
    try {
      $client.Timeout = [TimeSpan]::FromMinutes(5)
      $content = [System.Net.Http.MultipartFormDataContent]::new()
      $addCampo = {
        param($parte, $nome, $arquivo)
        $cd = [System.Net.Http.Headers.ContentDispositionHeaderValue]::new('form-data')
        $cd.Name = '"' + $nome + '"'
        if ($arquivo) { $cd.FileName = '"' + $arquivo + '"' }
        $parte.Headers.ContentDisposition = $cd
        $content.Add($parte)
      }
      $bytes = Get-FileBytesShared $FilePath
      $fc = [System.Net.Http.ByteArrayContent]::new($bytes)
      $fc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      & $addCampo $fc 'arquivo' ([System.IO.Path]::GetFileName($FilePath))
      & $addCampo ([System.Net.Http.StringContent]::new($Sha)) 'sha256' $null
      & $addCampo ([System.Net.Http.StringContent]::new($Origem)) 'origem' $null
      foreach ($k in $Counts.Keys) { & $addCampo ([System.Net.Http.StringContent]::new([string]$Counts[$k])) $k $null }
      $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $uri)
      $req.Headers.Add('X-Sync-Token', $cfg.Token)
      $req.Content = $content
      $resp = $client.SendAsync($req).GetAwaiter().GetResult()
      $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode): $body" }
      return $body
    } finally { $client.Dispose() }
  }
}

# --------------------------------------------------------------------------
# Execucao
# --------------------------------------------------------------------------
Write-Log "===== Sincronizacao ($Origem) ====="

if (-not $cfg.Token) {
  Write-Log "SYNC_TOKEN nao configurado (config.local.json ou variavel de ambiente). Abortando." 'ERROR'
  exit 2
}

# 1) Resolve a pasta (UNC -> fallback U:). Pasta indisponivel = falha registrada,
#    estado preservado, saida limpa (Agendador re-tenta). §6
$pasta = $null
foreach ($cand in @($cfg.PastaOrigem, $cfg.PastaFallback)) {
  if ($cand -and (Test-Path -LiteralPath $cand)) { $pasta = $cand; break }
}
if (-not $pasta) {
  $msg = "Pasta de rede indisponivel (tentei: $($cfg.PastaOrigem) e $($cfg.PastaFallback))."
  Write-Log $msg 'ERROR'
  Post-Run @{ origem = $Origem; status = 'falha'; mensagem = $msg }
  exit 1
}
Write-Log "Pasta: $pasta"

$estadoAnterior = Load-State
$estadoNovo = @{}
$novos = 0; $modificados = 0; $inalterados = 0

# 2) Varredura recursiva preservando a estrutura. Hash so do que mudou (incremental).
try {
  $arquivos = Get-ChildItem -LiteralPath $pasta -Recurse -File -Force -ErrorAction Stop
} catch {
  $msg = "Falha ao ler a pasta: $($_.Exception.Message)"
  Write-Log $msg 'ERROR'
  Post-Run @{ origem = $Origem; status = 'falha'; mensagem = $msg }
  exit 1
}

$prefixo = $pasta.TrimEnd('\') + '\'
foreach ($a in $arquivos) {
  # Ignora arquivos de bloqueio/temporarios do Office (~$...): transitorios e
  # normalmente inacessiveis; so geram ruido na varredura.
  if ($a.Name.StartsWith('~$')) { continue }
  $rel = $a.FullName
  if ($rel.StartsWith($prefixo, [StringComparison]::OrdinalIgnoreCase)) { $rel = $rel.Substring($prefixo.Length) }
  $mtime = $a.LastWriteTimeUtc.ToString('o')
  $size = $a.Length
  $ant = $estadoAnterior[$rel]
  $hash = $null
  if ($ant -and ([long]$ant.size -eq $size) -and ([string]$ant.mtime -eq $mtime) -and $ant.sha256) {
    $hash = [string]$ant.sha256   # inalterado: reaproveita hash (nao re-hasheia)
  } else {
    try { $hash = Get-Sha256 $a.FullName } catch { Write-Log "Nao consegui ler $rel ($($_.Exception.Message))" 'WARN'; continue }
  }
  if (-not $ant) { $novos++ }
  elseif ([string]$ant.sha256 -ne $hash) { $modificados++ }
  else { $inalterados++ }
  $estadoNovo[$rel] = [ordered]@{ size = $size; mtime = $mtime; sha256 = $hash }
}
# Removidos: estavam no estado anterior e nao aparecem agora.
$removidos = @($estadoAnterior.Keys | Where-Object { -not $estadoNovo.ContainsKey($_) }).Count
$encontrados = $estadoNovo.Count

$counts = @{
  arquivos_encontrados = $encontrados; novos = $novos; modificados = $modificados
  removidos = $removidos; inalterados = $inalterados
}
Write-Log ("Varredura: {0} arquivos | novos={1} modificados={2} removidos={3} inalterados={4}" -f `
    $encontrados, $novos, $modificados, $removidos, $inalterados)

# 3) Arquivo-mestre: envia so se mudou (hash != ultimo enviado). Casa SOMENTE o
#    arquivo na RAIZ da pasta (rel == nome do mestre), nunca homonimos em subpastas
#    (ex.: BKP\Cadastros Starlink - consolidado Oficial.xlsx).
$chaveMestre = $estadoNovo.Keys | Where-Object { $_ -ieq $cfg.ArquivoMestre } | Select-Object -First 1
if (-not $chaveMestre) {
  $msg = "Arquivo-mestre nao encontrado na pasta: $($cfg.ArquivoMestre)."
  Write-Log $msg 'WARN'
  Post-Run (@{ origem = $Origem; status = 'falha'; mensagem = $msg } + $counts)
  # Ainda assim salva o estado da varredura (os demais arquivos foram vistos).
  Save-State $estadoNovo
  exit 1
}

$hashMestreAtual = [string]$estadoNovo[$chaveMestre].sha256
$hashMestreAnterior = if ($estadoAnterior[$chaveMestre]) { [string]$estadoAnterior[$chaveMestre].sha256 } else { '' }
$caminhoMestre = Join-Path $pasta $chaveMestre

if ($hashMestreAtual -eq $hashMestreAnterior -and $hashMestreAnterior) {
  Write-Log "Arquivo-mestre sem alteracao (hash igual ao ultimo). Nada a importar."
  Post-Run (@{ origem = $Origem; status = 'sem_alteracao'; mensagem = 'Arquivo-mestre sem alteracao.' } + $counts)
  Save-State $estadoNovo
  Write-Log "===== Fim (sem alteracao) ====="
  exit 0
}

# 4) Mudou (ou primeira execucao): envia o arquivo cru. O Worker reimporta de forma
#    nao-destrutiva + dedup e ainda confere o hash (defesa dupla contra reprocesso).
Write-Log "Arquivo-mestre mudou. Enviando para importacao ($caminhoMestre)..."
try {
  $resp = Post-Ingest -FilePath $caminhoMestre -Sha $hashMestreAtual -Counts $counts
  Write-Log "Resposta do servidor: $resp"
  # So agora (apos ack) grava o estado — garante retry se o envio tivesse falhado.
  Save-State $estadoNovo
  Write-Log "===== Fim (importado) ====="
  exit 0
} catch {
  $msg = "Falha ao enviar/importar o arquivo-mestre: $($_.Exception.Message)"
  Write-Log $msg 'ERROR'
  Post-Run (@{ origem = $Origem; status = 'falha'; mensagem = $msg } + $counts)
  # NAO salva o estado: mantem o ultimo valido para re-tentar na proxima execucao.
  exit 1
}
