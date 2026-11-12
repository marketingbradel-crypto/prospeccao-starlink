# Mapa Estratégico de Prospecção — Bradel · Starlink

Plataforma web para **mapear, cadastrar e gerenciar lojistas/parceiros potenciais da Starlink**
nas regiões de atuação da Bradel (PA, TO, MA, GO). Mapa offline por microrregião/município,
cadastro completo, funil de status, dashboard e importação/exportação em Excel.

Roda **localmente** no seu computador (Flask + SQLite). Não precisa de internet.

---

## Como rodar

1. Instale as dependências (uma única vez):

   ```
   pip install -r requirements.txt
   ```

2. Inicie a plataforma:

   - **Windows:** dê duplo clique em **`run.bat`**
   - ou, no terminal: `python run.py`

3. O navegador abre sozinho em **http://localhost:8000**.
   Para parar, feche a janela do terminal (ou Ctrl+C).

Na **primeira execução**, o banco é criado e as revendas da planilha
`Gestao_Prospeccao_Revendas_Starlink.xlsx` são importadas automaticamente.

---

## O que dá para fazer

- **Mapa** das 4 UFs com concentração de empresas por microrregião e marcadores por status
  (verde = credenciado, azul = potencial, amarelo = negociação, laranja = documentação,
  vermelho = perdido/sem retorno).
- **Cadastro completo** do lojista: dados da empresa, responsável, perfil comercial,
  classificação, filiais e histórico de contatos.
- **Filtros** por estado, microrregião, segmento, status, responsável, canal, além de
  "só credenciados", "só potenciais" e "internet/telecom", e **busca** por nome/CNPJ/cidade.
- **Dashboard** com indicadores (total, potenciais, credenciados, em negociação, municípios
  alcançados, taxa de conversão) e gráficos por status, estado e segmento.
- **Importar/Exportar Excel** — baixe o **Modelo**, preencha e importe. O **CNPJ** é o
  identificador único: registros existentes são atualizados, não duplicados.

---

## Onde ficam os dados

- Banco: **`data/prospeccao.db`** (SQLite). Faça backup deste arquivo para guardar tudo.
- Para recomeçar do zero, apague `data/prospeccao.db` e rode de novo (reimporta a planilha).

---

## Estrutura do projeto

```
run.py                     inicia o servidor (seed + Flask)
run.bat                    atalho de inicialização no Windows
requirements.txt           dependências (Flask, openpyxl)
app/
  server.py                API Flask (empresas, mapa, dashboard, import/export)
  db.py                    banco SQLite + schema
  listas.py                enumerações e regras de classificação/cores
  geo.py                   inteligência geográfica (município → microrregião, geometria)
  excel_io.py              seed/import/export Excel
  templates/index.html     página da plataforma
  static/
    app.js                 aplicação (SPA)
    styles.css             estilos
    geo.json               geometria do mapa (gerada a partir do painel)
tools/
  extract_geo.py           regera o geo.json a partir de "Painel Starlink Regional.html"
data/prospeccao.db         banco de dados (criado ao rodar)
```

---

## Observações

- O mapa é **offline** (geometria embutida em `app/static/geo.json`), portanto não depende
  de serviços externos nem de chave de API.
- Microrregião e responsável comercial são preenchidos **automaticamente** a partir do
  município cadastrado (tabela de territórios por responsável).
- Dados sensíveis (`.env`, acessos do portal Vivensis) **não** fazem parte da plataforma e
  continuam protegidos pelo `.gitignore`.
