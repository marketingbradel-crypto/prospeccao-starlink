# Agente de sincronização da pasta de rede → Prospecção Starlink

Integra a pasta **`U:\Matriz\Back office\Dep`** com a plataforma (Cloudflare Worker),
reimportando os **arquivos oficiais** na base **em dias úteis (seg–sex) às 09:00, 13:00 e
17:00 (BRT)**, de forma **incremental** (só quando um arquivo muda) e **sem duplicar**.

> **Fonte de verdade = a planilha oficial.** Desde 19/11/2026 a planilha oficial PREVALECE
> nos dados **cadastrais** (razão/telefone/endereço/e-mail/UF/cidade...): uma correção na
> planilha **atualiza** a base. Já os dados **comerciais** feitos no app (status do funil,
> contatos, potencial, responsável, observações) ficam **protegidos** — a planilha nunca os
> apaga. CNPJ e razão social respeitam a trava cadastral (só admin desbloqueia).

## Por que existe um agente local?

O sistema roda num **Cloudflare Worker** (nuvem). Um Worker **não tem sistema de arquivos e não
alcança** `U:` nem `\\192.168.172.145` — esse caminho só existe dentro da rede da Bradel. Então:

```
  Pasta de rede  ──lê──►  AGENTE LOCAL (este script, numa máquina da rede)
                                  │  detecta se o arquivo-mestre mudou (hash)
                                  └──empurra──►  Worker /api/sync/ingest  ──►  base (D1)
```

O **agendamento** (seg–sex 09:00/13:00/17:00) fica no **Agendador de Tarefas do Windows** desta máquina.

## O que é sincronizado

Dois **arquivos oficiais** na raiz da pasta (cada um enviado só quando o **seu** hash muda):

1. **`Cadastros Starlink - consolidado Oficial.xlsx`** → importa as **fichas**. O cadastral da
   planilha **prevalece** (sobrescreve); o comercial/status do app fica protegido; dedup por
   CNPJ / ID VSM / nome+UF+cidade (não duplica).
2. **`Vivensis_Instaladores_Status_Bradel.xlsx`** → **ingestão por aba** (atualiza fichas já
   existentes, não cria novas):
   - **Capilaridade-vsm** → pendência VSM, vendas, instalações e "já vendeu" (dados do portal
     VSM, **autoritativos**);
   - **Status-cad parceiros-wfm** → status de cadastro Vivensis (APROVADO/reprovado + motivo);
   - **Instaladoras-wfm** → preenche contato/telefone **faltante** (não-destrutivo).
   - (A aba *Lead Bradel* é ignorada de propósito.)

Os demais arquivos (PDFs, Serasa, backups) são **varridos e contabilizados** (novos/modificados/
removidos/inalterados aparecem no histórico), mas **não são importados**. A varredura preserva a
estrutura de subpastas.

---

## Instalação (uma vez)

### 1. Gerar o token e configurá-lo no Worker

Gere um token forte (qualquer string longa e aleatória). Ex. em PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

Defina-o como secret do Worker (conta **marketing.bradel**):

```powershell
cd "..\cloudflare"
$env:CLOUDFLARE_ACCOUNT_ID = "653bb4dc95bf8c3d4845f9aca64201ba"
npx wrangler secret put SYNC_TOKEN   # cole o token quando pedir
```

### 2. Configurar o agente

Copie o exemplo e cole **o mesmo token**:

```powershell
cd "..\agente-sync"
Copy-Item config.exemplo.json config.local.json
notepad config.local.json   # preencha "Token"
```

`config.local.json` **não é versionado** (está no `.gitignore`). Alternativamente, em vez de pôr o
token no arquivo, defina a variável de ambiente `SYNC_TOKEN` (tem prioridade).

### 3. Aplicar a migration e publicar o Worker

```powershell
cd "..\cloudflare"
npx wrangler d1 migrations apply prospeccao-starlink --remote
npx wrangler deploy
```

### 4. Instalar a tarefa agendada

```powershell
cd "..\agente-sync"
powershell -ExecutionPolicy Bypass -File .\instalar-tarefa.ps1
```

Cria a tarefa **ProspeccaoStarlink-SyncDep** com gatilhos em **dias úteis (seg–sex) às 09:00,
13:00 e 17:00**.

---

## Uso

| Ação | Comando |
|------|---------|
| **Rodar agora (manual)** | `powershell -ExecutionPolicy Bypass -File .\sync-dep.ps1 -Now` |
| Disparar a tarefa agendada | `Start-ScheduledTask -TaskName ProspeccaoStarlink-SyncDep` |
| Ver próxima execução | `(Get-ScheduledTask -TaskName ProspeccaoStarlink-SyncDep \| Get-ScheduledTaskInfo).NextRunTime` |
| Ver o log | `Get-Content "$env:ProgramData\ProspeccaoStarlink\sync.log" -Tail 40` |
| Remover a tarefa | `powershell -ExecutionPolicy Bypass -File .\instalar-tarefa.ps1 -Remover` |

O **indicador visual** (última sincronização, próxima execução, contadores e histórico) aparece na
aba **Gerencial** do sistema.

## Como funciona por dentro (resumo técnico)

- **Estado** em `%ProgramData%\ProspeccaoStarlink\sync-state.json`: por arquivo, guarda
  `{tamanho, data de modificação, SHA-256}`. Só re-hasheia arquivos cujo tamanho/data mudou
  (não varre o conteúdo inteiro à toa).
- **Decisão de envio**: manda **cada arquivo oficial** só quando o SHA-256 **dele** muda. O Worker
  ainda confere o hash por arquivo (`sync_master_hash` para o mestre, `sync_hash:vivensis` para a
  planilha Vivensis) e, se for igual ao último, **não reprocessa** (registra `sem_alteracao`). Um
  envio que falha preserva o hash anterior **daquele** arquivo, para re-tentar na próxima execução.
- **Integridade**: o estado local só é salvo **depois** do `ack` do servidor — um envio que falhou é
  re-tentado na próxima execução.
- **Falhas** (pasta indisponível / sem permissão / sem rede): registradas em `/api/sync/run` com
  status `falha`; o agente **não derruba o sistema**, mantém o último estado e sai. O Agendador
  re-tenta (RestartCount) e, com `StartWhenAvailable`, recupera execuções perdidas.

## Solução de problemas

- **"SYNC_TOKEN não configurado"** → preencha `config.local.json` ou a variável de ambiente, e
  confirme que o secret `SYNC_TOKEN` existe no Worker (mesmo valor).
- **"Token de sincronização inválido" (401)** → o token do agente ≠ o secret do Worker.
- **"Pasta de rede indisponível"** → confirme acesso: `Test-Path '\\192.168.172.145\Documentos\Matriz\Back office\Dep'`.
  A tarefa roda só com o usuário logado; para os horários fixos serem confiáveis, mantenha **este PC
  ligado e logado** nos dias úteis. O agente prioriza o caminho UNC, que costuma funcionar
  mesmo sem o drive `U:` mapeado.
- **Testar apontando para o Worker local** (`wrangler dev`): rode
  `.\sync-dep.ps1 -Now` com um `config.local.json` cujo `ApiBase` seja `http://127.0.0.1:8787`.
