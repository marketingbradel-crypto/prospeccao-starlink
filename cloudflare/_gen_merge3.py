import json, sys, re

rows = json.load(open(sys.argv[1], encoding="utf-8"))[0]["results"]
by = {r["id"]: r for r in rows}
# (id_vsm, delete_.0, keep_inteiro)
pairs = [
    ("4276", 84, 615), ("4304", 118, 769), ("4361", 147, 568), ("4424", 158, 576),
    ("4511", 221, 591), ("4514", 225, 589), ("4635", 236, 684),            # Luis Carlos
    ("4299", 106, 490), ("4349", 90, 389), ("4350", 132, 498),
    ("4368", 140, 529), ("4584", 168, 508),                                 # Ronaldo
    ("4317", 73, 796), ("4774", 298, 899), ("4813", 356, 903), ("4944", 379, 912),  # Mateus
]
contatos_mig = {90: 389, 106: 490, 379: 912}  # del -> keep
CAD = ["inscricao_estadual", "whatsapp", "email_comercial", "site_instagram", "endereco", "cep",
       "resp_nome", "resp_cargo", "resp_telefone", "resp_whatsapp", "resp_email", "segmento",
       "produtos", "equipe_tecnica", "capacidade_vendas_mes", "interesse_parceiro",
       "nome_fantasia", "pendencia_cadastro", "pendencia_cadastro_obs"]

def src(f, d): return f"(SELECT {f} FROM empresas WHERE id={d})"
def fill(f, d): return f"{f}=CASE WHEN COALESCE(TRIM({f}),'')='' THEN {src(f, d)} ELSE {f} END"
def clean(e): return f"replace(replace(replace(replace({e},'.',''),'/',''),'-',''),' ','')"

out = []
warn = []
out.append("-- MERGE Luis Carlos + Ronaldo + Mateus (server-side). Backup: _backup_merge_lc_ronaldo_mateus.json")
for idv, d, keep in pairs:
    b = by[keep]
    sets = [fill(f, d) for f in CAD]
    sets.append(f"cnpj=CASE WHEN COALESCE(TRIM(cnpj),'')='' THEN {clean(src('cnpj', d))} ELSE cnpj END")
    sets.append(f"cnpj_norm=CASE WHEN COALESCE(TRIM(cnpj_norm),'')='' THEN {clean(src('cnpj', d))} ELSE cnpj_norm END")
    tag = ""
    rid = str(b.get("id_vsm") or "")
    m = re.match(r"^(\d+)", rid)
    if m and rid.strip() != m.group(1):
        # mantem so o numero; preserva o texto (so ascii alfanumerico/espaco) como tag
        suffix = re.sub(r"[^A-Za-z0-9 ]+", " ", rid[m.end():]).strip()
        tag = suffix
        sets.append(f"id_vsm='{idv}'")
        warn.append(f"id_vsm sujo #{keep}={rid!r}")
    tel = str(b.get("telefone_comercial") or "")
    if tel and not re.search(r"\d", tel):
        sets.append(f"telefone_comercial={src('telefone_comercial', d)}")
        warn.append(f"telefone lixo #{keep}={tel!r}")
        clean_tel = re.sub(r"[^A-Za-z0-9 ]+", " ", tel).strip()
        tag = (tag + " " + clean_tel).strip() if tag else clean_tel
    if tag:
        base = f"COALESCE(NULLIF(TRIM(observacoes),''),{src('observacoes', d)},'')"
        sets.append(f"observacoes=CASE WHEN {base}='' THEN '{tag}' ELSE {base}||' - {tag}' END")
    else:
        sets.append(fill("observacoes", d))
    sets.append("atualizado_em=datetime('now')")
    out.append(f"\n-- id_vsm {idv}: manter #{keep}, apagar #{d}")
    if d in contatos_mig:
        out.append(f"UPDATE contatos SET empresa_id={keep} WHERE empresa_id={d};  -- migra contato")
    out.append(f"UPDATE empresas SET {', '.join(sets)} WHERE id={keep};")
    out.append(f"DELETE FROM empresas WHERE id={d};")

open(sys.argv[2], "w", encoding="utf-8").write("\n".join(out) + "\n")
sys.stderr.write("AVISOS: " + ("; ".join(warn) if warn else "nenhum telefone-lixo/id sujo (todos limpos)") + "\n")
