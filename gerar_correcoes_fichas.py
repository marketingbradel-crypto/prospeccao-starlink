# -*- coding: utf-8 -*-
"""Gera correcoes SOBRESCRITA para fichas ja cadastradas cujos campos de
identidade entraram errados (deslocamento do formulario de 2 blocos).

Casa o arquivo CORRIGIDO com o snapshot de producao por TELEFONE (coluna
confiavel). So sobrescreve campo que esta REALMENTE divergente e nao-vazio no
corrigido. Match ambiguo (telefone em >1 ficha) sem desempate claro por nome
NAO gera UPDATE -> vai pro CSV de revisao.

Saidas (na raiz do projeto):
  - correcoes_fichas.sql      UPDATEs de alta confianca (WHERE codigo=...)
  - correcoes_revisar.csv     casos ambiguos/duvidosos p/ decisao manual
"""
import json, re, csv, unicodedata, openpyxl

BASE = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink"
PROD = BASE + r"\_prod_empresas.json"
CORR = BASE + r"\import_credenciamento_CORRIGIDO.xlsx"
OUT_SQL = BASE + r"\correcoes_fichas.sql"
OUT_CSV = BASE + r"\correcoes_revisar.csv"

def digits(s): return re.sub(r"\D", "", str(s or ""))
def phones(s):
    out = set()
    for part in re.split(r"[\/;,]| ou ", str(s or "")):
        d = digits(part)
        if len(d) >= 10:
            out.add(d[-11:]); out.add(d[-10:])
    return out
def strip_acc(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c))
def nname(s):
    s = strip_acc(s).upper(); s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\b(LTDA|ME|MEI|EIRELI|EPP|SA|EI|CIA|COMERCIO|COMERCIAL)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()
def tokens(s): return set(t for t in nname(s).split() if len(t) > 2)
def name_sim(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb: return 0.0
    if nname(a) == nname(b): return 1.0
    inter = ta & tb
    if inter == ta or inter == tb: return 0.9
    return len(inter) / len(ta | tb)
def sqlstr(s):
    return "'" + str(s).replace("'", "''") + "'"
def looks_cnpj_only(s):
    """valor que e so um CNPJ/numero (nao serve como razao/fantasia)."""
    d = digits(s)
    return len(d) >= 11 and len(d) >= len(str(s).replace(" ", "")) * 0.8

# ---------- prod ----------
prod = json.load(open(PROD, encoding="utf-8-sig"))[0]["results"]
by_phone = {}
by_cnpjnorm = {}
for p in prod:
    for ph in phones(p.get("telefone_comercial")) | phones(p.get("whatsapp")):
        by_phone.setdefault(ph, []).append(p)
    cn = digits(p.get("cnpj"))
    if len(cn) == 14:
        by_cnpjnorm.setdefault(cn, []).append(p)

# ---------- corrigido ----------
wb = openpyxl.load_workbook(CORR, data_only=True); ws = wb.active
rows = list(ws.iter_rows(min_row=1, values_only=True))
H = list(rows[0]); I = {k: i for i, k in enumerate(H)}
def c(r, k): return str(r[I[k]] or "").strip()

# campos a corrigir: (coluna do corrigido -> campo do banco)
CAMPOS = [
    ("Razão social", "razao_social"),
    ("Nome fantasia", "nome_fantasia"),
    ("CNPJ", "cnpj"),
    ("Inscrição estadual", "inscricao_estadual"),
]

updates = []      # (codigo, dict campo->valor, nota)
revisar = []      # linhas p/ CSV
cnpj_destino = {} # cnpj_norm -> codigo (detecta colisao entre updates)

for r in rows[1:]:
    tel = phones(c(r, "Telefone comercial")) | phones(c(r, "WhatsApp"))
    cands = []
    for ph in tel:
        for p in by_phone.get(ph, []):
            if p not in cands: cands.append(p)
    motivo = ""
    alvo = None
    if not cands:
        motivo = "sem match por telefone"
    elif len(cands) == 1:
        alvo = cands[0]
    else:
        # desempate por similaridade de nome (razao/fantasia/nome corrigido)
        nomes_corr = [c(r, "Razão social"), c(r, "Nome fantasia")]
        def score(p):
            return max(name_sim(nc, p.get("razao_social")) for nc in nomes_corr if nc) if any(nomes_corr) else 0.0, \
                   max(name_sim(nc, p.get("nome_fantasia")) for nc in nomes_corr if nc) if any(nomes_corr) else 0.0
        ranked = sorted(cands, key=lambda p: max(score(p)), reverse=True)
        best, second = ranked[0], ranked[1]
        sb, ss = max(score(best)), max(score(second))
        if sb >= 0.6 and sb - ss >= 0.2:
            alvo = best
            motivo = f"ambiguo({len(cands)}) resolvido por nome (score {sb:.2f})"
        else:
            motivo = f"ambiguo: telefone em {len(cands)} fichas, sem desempate por nome"

    if alvo is None:
        revisar.append({
            "motivo": motivo,
            "corr_razao": c(r, "Razão social"), "corr_fantasia": c(r, "Nome fantasia"),
            "corr_cnpj": c(r, "CNPJ"), "corr_tel": c(r, "Telefone comercial"),
            "candidatos_codigo": " | ".join(str(p.get("codigo")) for p in cands),
            "candidatos_fantasia": " | ".join(str(p.get("nome_fantasia")) for p in cands),
        })
        continue

    # monta SET so com campos realmente divergentes e corrigido nao-vazio
    sets = {}
    for col, campo in CAMPOS:
        novo = c(r, col)
        if not novo:
            continue
        # nunca gravar razao/fantasia que e so um CNPJ (anomalia de digitacao)
        if campo in ("razao_social", "nome_fantasia") and looks_cnpj_only(novo):
            continue
        atual = str(alvo.get(campo) or "").strip()
        if campo == "cnpj":
            if digits(novo) == digits(atual):
                continue
        else:
            if nname(novo) == nname(atual):
                continue
        sets[campo] = novo

    if not sets:
        continue  # ja estava correto, nada a sobrescrever

    # se vamos mudar o CNPJ, atualiza cnpj_norm junto e checa colisao
    if "cnpj" in sets:
        cn = digits(sets["cnpj"])
        sets["cnpj_norm"] = cn
        # colisao com outra ficha existente (que nao seja esta)?
        donos = [p for p in by_cnpjnorm.get(cn, []) if p.get("codigo") != alvo.get("codigo")]
        if donos or cn in cnpj_destino:
            revisar.append({
                "motivo": f"CNPJ {sets['cnpj']} colide com outra ficha ({', '.join(str(p.get('codigo')) for p in donos) or cnpj_destino.get(cn)})",
                "corr_razao": c(r, "Razão social"), "corr_fantasia": c(r, "Nome fantasia"),
                "corr_cnpj": c(r, "CNPJ"), "corr_tel": c(r, "Telefone comercial"),
                "candidatos_codigo": str(alvo.get("codigo")),
                "candidatos_fantasia": str(alvo.get("nome_fantasia")),
            })
            continue
        cnpj_destino[cn] = alvo.get("codigo")

    updates.append((alvo.get("id"), sets, motivo, alvo))

# ---------- escreve SQL ----------
with open(OUT_SQL, "w", encoding="utf-8") as f:
    f.write("-- Correcao de fichas com campos de identidade deslocados (form 2 blocos).\n")
    f.write("-- Base: snapshot _prod_empresas.json (regenerar antes de aplicar). Chave: id (UNICO; codigo NAO e unico - 67 grupos duplicados!).\n")
    f.write("-- Aplicar: wrangler d1 execute <DB> --remote --file=correcoes_fichas.sql\n")
    f.write("-- (D1 aplica o arquivo atomicamente; em falha, volta ao estado original)\n")
    f.write(f"-- Total de UPDATEs: {len(updates)}\n\n")
    for eid, sets, motivo, alvo in updates:
        campos_mud = [k for k in sets if k != "cnpj_norm"]
        f.write(f"-- id={eid} ({alvo.get('codigo')}): {', '.join(campos_mud)}"
                f"  [de: fant={str(alvo.get('nome_fantasia'))[:30]!r} cnpj={alvo.get('cnpj')}]  ({motivo})\n")
        set_sql = ", ".join(f"{k}={sqlstr(v)}" for k, v in sets.items())
        f.write(f"UPDATE empresas SET {set_sql}, atualizado_em=datetime('now') WHERE id={int(eid)};\n\n")

# ---------- escreve CSV revisao ----------
with open(OUT_CSV, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["motivo", "corr_razao", "corr_fantasia", "corr_cnpj",
                                      "corr_tel", "candidatos_codigo", "candidatos_fantasia"])
    w.writeheader()
    for row in revisar: w.writerow(row)

# ---------- resumo ----------
from collections import Counter
campoc = Counter()
for _, sets, _, _ in updates:
    for k in sets:
        if k != "cnpj_norm": campoc[k] += 1
print("UPDATEs de alta confianca:", len(updates))
print("  por campo:", dict(campoc))
print("Casos para revisar (CSV):", len(revisar))
print("Arquivos:", OUT_SQL, "|", OUT_CSV)
