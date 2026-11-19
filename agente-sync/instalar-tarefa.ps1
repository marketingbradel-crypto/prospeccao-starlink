<#
.SYNOPSIS
  Instala/atualiza a tarefa agendada que roda o agente de sincronizacao da pasta
  de rede em dias uteis (SEG a SEX) as 09:00, 13:00 e 17:00 (horario local = BRT).

.DESCRIPTION
  Cria a tarefa "ProspeccaoStarlink-SyncDep" no Agendador de Tarefas do Windows.
  Idempotente: se a tarefa ja existir, e recriada. Sobrevive a reinicios (o
  Agendador persiste a tarefa). StartWhenAvailable=true faz a tarefa "correr
  atrasada" se a maquina estava desligada no horario. RestartCount aplica a
  politica de retentativa em caso de falha.

  Observacao: por padrao a tarefa roda SOMENTE quando o usuario esta logado
  (-LogonType Interactive), porque o drive U: so existe na sessao do usuario.
  O agente ja prioriza o caminho UNC (\\192.168.172.145\...), que normalmente
  funciona mesmo sem o drive mapeado; ainda assim, para os horarios fixos serem
  confiaveis, mantenha o PC ligado e com a sessao iniciada nos dias uteis.

.PARAMETER Remover
  Remove a tarefa em vez de instalar.
#>
[CmdletBinding()]
param([switch]$Remover)

$ErrorActionPreference = 'Stop'
$NomeTarefa = 'ProspeccaoStarlink-SyncDep'
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Agente     = Join-Path $ScriptDir 'sync-dep.ps1'

if ($Remover) {
  if (Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false
    Write-Host "Tarefa '$NomeTarefa' removida."
  } else { Write-Host "Tarefa '$NomeTarefa' nao existe." }
  return
}

if (-not (Test-Path -LiteralPath $Agente)) { throw "Nao encontrei o agente em $Agente" }

# Usa pwsh (PowerShell 7+) se disponivel; senao Windows PowerShell 5.1.
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
$exe  = if ($pwsh) { $pwsh.Source } else { Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }

$acao = New-ScheduledTaskAction -Execute $exe `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Agente`""

# Tres gatilhos diarios em dias uteis (seg-sex): 09:00, 13:00 e 17:00 (horario
# local da maquina = BRT). O agente so ENVIA quando um arquivo oficial muda, entao
# execucoes "a seco" sao baratas (so varrem a pasta e saem).
$diasUteis = @('Monday','Tuesday','Wednesday','Thursday','Friday')
$gat09 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $diasUteis -At '09:00'
$gat13 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $diasUteis -At '13:00'
$gat17 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $diasUteis -At '17:00'

$cfg = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew `
  -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

# Roda como o usuario atual, so quando logado (ver nota no cabecalho).
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false
}
Register-ScheduledTask -TaskName $NomeTarefa `
  -Description 'Sincroniza a pasta U:\Matriz\Back office\Dep com a plataforma Prospeccao Starlink (seg-sex 09:00, 13:00 e 17:00).' `
  -Action $acao -Trigger @($gat09, $gat13, $gat17) -Settings $cfg -Principal $principal | Out-Null

Write-Host "Tarefa '$NomeTarefa' instalada."
Write-Host "  Executavel : $exe"
Write-Host "  Agente     : $Agente"
Write-Host "  Gatilhos   : Seg-Sex as 09:00, 13:00 e 17:00 (horario local)"
Write-Host ""
Write-Host "Testar agora:  Start-ScheduledTask -TaskName '$NomeTarefa'"
Write-Host "Ver proxima:   (Get-ScheduledTask -TaskName '$NomeTarefa' | Get-ScheduledTaskInfo).NextRunTime"
