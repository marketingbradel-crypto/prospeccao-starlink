# -*- coding: utf-8 -*-
"""Merge em lote dos 20 pares duplicados confirmados (ativa Formulario/Inbound +
gemea VSM; CNPJ igual ou nome forte). survivor=ativa; herda id_vsm/capilaridade/
campos vazios da gemea; move contatos/filiais; remove a gemea. Chave: id."""
import json, re
BASE = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink"
OUT = BASE + r"\merge_lote_duplicatas.sql"
res = json.loads(open(BASE + r"\_merge_lote.json", encoding="utf-8-sig").read())[0]["results"]
by = {r["id"]: r for r in res}

# (survivor ativa, victim VSM) — do classificador
PARES = [(50,322),(63,870),(64,700),(66,792),(73,796),(103,91),(111,101),(238,110),
         (165,122),(123,312),(132,498),(133,628),(147,568),(158,576),(168,508),
         (196,280),(225,589),(236,684),(285,882),(356,903)]
NUNCA = {"id","codigo","criado_em"}
def vazio(v): return v is None or str(v).strip()==""
def sqlval(v):
    if v is None: return "NULL"
    if isinstance(v,(int,float)) and not isinstance(v,bool):
        return str(int(v)) if float(v).is_integer() else repr(v)
    return "'"+str(v).replace("'","''")+"'"
def vsm_int(v):
    m=re.match(r"^\s*(\d+)",str(v or "")); return m.group(1) if m else None

L=["-- Merge em lote de 20 duplicatas (ativa Formulario + gemea VSM). Chave: id.",
   "-- survivor=ativa mantida; victim=VSM removida apos consolidar.",
   "-- Aplicar: wrangler d1 execute prospeccao-starlink --remote --file=merge_lote_duplicatas.sql",
   "-- (D1 aplica atomicamente; em falha volta ao estado original)",""]
for sid,vid in PARES:
    s,v=by[sid],by[vid]
    vsm=vsm_int(s.get("id_vsm")) or vsm_int(v.get("id_vsm"))
    sets={}
    for col in s:
        if col in NUNCA or col=="id_vsm": continue
        if vazio(s[col]) and not vazio(v[col]): sets[col]=v[col]
    if str(s.get("id_vsm") or "").strip()!=str(vsm or ""): sets["id_vsm"]=vsm
    L.append(f"-- id_vsm {vsm}: manter id={sid} ({str(s.get('nome_fantasia'))[:22]!r}) | remover id={vid} ({str(v.get('nome_fantasia'))[:22]!r})")
    if sets:
        L.append(f"UPDATE empresas SET {', '.join(f'{k}={sqlval(val)}' for k,val in sets.items())}, atualizado_em=datetime('now') WHERE id={sid};")
    else:
        L.append(f"-- (survivor id={sid} ja completo)")
    L.append(f"UPDATE contatos SET empresa_id={sid} WHERE empresa_id={vid};")
    L.append(f"UPDATE filiais  SET empresa_id={sid} WHERE empresa_id={vid};")
    L.append(f"DELETE FROM empresas WHERE id={vid};")
    L.append("")
open(OUT,"w",encoding="utf-8").write("\n".join(L))
print("Gerado:",OUT,"| pares:",len(PARES))
