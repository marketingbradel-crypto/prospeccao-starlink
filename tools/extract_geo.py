# -*- coding: utf-8 -*-
"""
Extrai a geometria embutida no 'Painel Starlink Regional.html' (linha const D={...})
e gera app/static/geo.json, com:
  - overview: regioes imediatas dos 4 estados num unico sistema de coordenadas + contornos de UF
  - states: por UF, poligonos de municipio (com centroide) e de regiao imediata
  - muni_index: lookup normalizado "UF|municipio" -> {uf, municipio, regiao, state, cx, cy}

Uso: python tools/extract_geo.py
Rode uma vez; o geo.json resultante e versionavel e nao precisa de internet.
"""
import json, re, unicodedata, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(BASE, "Painel Starlink Regional.html")
OUT_DIR = os.path.join(BASE, "app", "static")
OUT = os.path.join(OUT_DIR, "geo.json")

NUM = re.compile(r"-?\d+(?:\.\d+)?")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.strip().lower()


def centroid(d: str):
    """Centroide aproximado (media dos vertices) a partir do atributo 'd' do path SVG."""
    nums = [float(x) for x in NUM.findall(d)]
    xs = nums[0::2]
    ys = nums[1::2]
    if not xs or not ys:
        return 0.0, 0.0
    return round(sum(xs) / len(xs), 2), round(sum(ys) / len(ys), 2)


def main():
    with open(HTML, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("const D="):
                raw = line.strip()
                break
        else:
            print("ERRO: nao achei 'const D=' no HTML", file=sys.stderr)
            sys.exit(1)

    # strip 'const D=' prefix e ';' final
    raw = raw[len("const D="):].rstrip()
    if raw.endswith(";"):
        raw = raw[:-1]
    D = json.loads(raw)

    out = {"overview": {}, "states": {}, "muni_index": {}}

    # ---- overview (4 estados num so sistema de coords) ----
    A = D["all"]
    out["overview"] = {
        "w": A["w"], "h": A["h"],
        "regions": [{"n": g["n"], "uf": g.get("uf", ""), "d": g["d"],
                     "lx": g.get("lx"), "ly": g.get("ly")} for g in A["g"]],
        "states": [{"c": s["c"], "uf": s["uf"], "nome": s["nome"], "d": s["d"]} for s in A["s"]],
    }

    # ---- por estado ----
    for code, V in D["v"].items():
        municipios = []
        for f in V["f"]:
            cx, cy = centroid(f["d"])
            municipios.append({"n": f["n"], "rg": f.get("rg", ""), "d": f["d"], "cx": cx, "cy": cy})
            key = f"{V['uf']}|{norm(f['n'])}"
            out["muni_index"][key] = {
                "uf": V["uf"], "municipio": f["n"], "regiao": f.get("rg", ""),
                "state": code, "cx": cx, "cy": cy,
            }
        regioes = [{"n": g["n"], "d": g["d"], "lx": g.get("lx"), "ly": g.get("ly")} for g in V["g"]]
        out["states"][code] = {
            "uf": V["uf"], "nome": V["nome"], "w": V["w"], "h": V["h"],
            "municipios": municipios, "regioes": regioes,
        }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    n_states = len(out["states"])
    n_muni = sum(len(s["municipios"]) for s in out["states"].values())
    size = os.path.getsize(OUT)
    print(f"OK geo.json: {n_states} estados, {n_muni} municipios, {len(out['muni_index'])} no indice, {size/1024:.0f} KB")
    print("Estados:", ", ".join(f"{c}({len(v['municipios'])})" for c, v in out["states"].items()))


if __name__ == "__main__":
    main()
