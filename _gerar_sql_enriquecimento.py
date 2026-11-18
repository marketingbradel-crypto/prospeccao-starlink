# -*- coding: utf-8 -*-
import json, re
data = json.load(open('_enriquecimento.json', encoding='utf-8'))
def q(v): return "'" + str(v).replace("'", "''") + "'"
def digits(s): return re.sub(r'\D', '', str(s or ''))
lines = ["-- Enriquecimento de fichas (campos em branco) a partir das planilhas-fonte.",
         "-- Gerado automaticamente. So preenche colunas vazias (WHERE guard).", ""]
n_set = 0
for m in data:
    eid = m['id']; fill = m['fill']
    sets = []
    for f, v in fill.items():
        sets.append(f"{f}=CASE WHEN {f} IS NULL OR {f}='' THEN {q(v)} ELSE {f} END")
        n_set += 1
        if f == 'cnpj':
            dn = digits(v)
            sets.append(f"cnpj_norm=CASE WHEN (cnpj_norm IS NULL OR cnpj_norm='') THEN {q(dn)} ELSE cnpj_norm END")
    sets.append("atualizado_em=datetime('now')")
    lines.append(f"UPDATE empresas SET {', '.join(sets)} WHERE id={eid};")
open('_enriquecimento.sql', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print(f"UPDATEs: {len(data)} fichas, {n_set} campos")
print("arquivo: _enriquecimento.sql")
