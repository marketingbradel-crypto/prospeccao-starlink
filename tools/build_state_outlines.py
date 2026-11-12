# -*- coding: utf-8 -*-
"""
Gera state-outlines.json com o CONTORNO (limite territorial) de cada um dos 4
estados — PA, MA, TO, GO — no mesmo sistema de coordenadas do overview do mapa.

Fonte: os contornos oficiais de UF ja embutidos em 'Painel Starlink Regional.html'
(const D -> D["all"]["s"]), os mesmos dados de onde o geo.json foi extraido.
NAO modifica geo.json nem a estrutura de microrregioes existente — apenas deriva
um arquivo de overlay usado pelo mapa (app.js) para destacar cada estado.

Saida (identica nos dois apps):
  - app/static/state-outlines.json
  - cloudflare/public/static/state-outlines.json
Formato: {"PA": "<svg path d>", "MA": "...", "TO": "...", "GO": "..."}

Uso: python tools/build_state_outlines.py
"""
import json, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(BASE, "Painel Starlink Regional.html")
OUT_FILES = [
    os.path.join(BASE, "app", "static", "state-outlines.json"),
    os.path.join(BASE, "cloudflare", "public", "static", "state-outlines.json"),
]


def main():
    with open(HTML, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("const D="):
                raw = line.strip()
                break
        else:
            print("ERRO: nao achei 'const D=' no HTML", file=sys.stderr)
            sys.exit(1)

    raw = raw[len("const D="):].rstrip()
    if raw.endswith(";"):
        raw = raw[:-1]
    D = json.loads(raw)

    estados = D["all"]["s"]  # [{c, uf, nome, d}, ...]
    out = {}
    for s in estados:
        uf = s.get("uf", "").upper()
        if uf and s.get("d"):
            out[uf] = s["d"]

    if not out:
        print("ERRO: nenhum contorno de UF encontrado em D.all.s", file=sys.stderr)
        sys.exit(1)

    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    for path in OUT_FILES:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(payload)
        print(f"OK {path} ({len(payload)/1024:.1f} KB)")
    print("Estados:", ", ".join(out.keys()))


if __name__ == "__main__":
    main()
