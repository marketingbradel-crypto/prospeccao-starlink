# -*- coding: utf-8 -*-
"""Inteligencia geografica: lookup municipio -> microrregiao (regiao imediata), UF,
centroides de microrregiao no SVG de overview e agregacoes para o mapa."""
import json
import os
import re
from .listas import norm

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_PATH = os.path.join(BASE, "app", "static", "geo.json")

_GEO = None
_REGION_CENTROIDS = None  # {(uf, regiao_norm): {"cx":..,"cy":..}} em coordenadas do overview


def geo():
    global _GEO
    if _GEO is None:
        with open(GEO_PATH, "r", encoding="utf-8") as f:
            _GEO = json.load(f)
    return _GEO


# --------------------------------------------------------------------------
# Lookup de municipio
# --------------------------------------------------------------------------
def lookup_municipio(municipio: str, uf: str = None):
    """Retorna {uf, municipio, regiao, state, cx, cy} ou None.
    Se a UF nao for informada, procura o municipio em qualquer uma das 4 UFs."""
    idx = geo()["muni_index"]
    nm = norm(municipio)
    if uf:
        return idx.get(f"{uf.strip().upper()}|{nm}")
    for key, v in idx.items():
        if key.split("|", 1)[1] == nm:
            return v
    return None


def microrregiao_de(municipio: str, uf: str = None) -> str:
    v = lookup_municipio(municipio, uf)
    return v["regiao"] if v else ""


def lista_municipios(uf: str = None):
    """Lista de municipios conhecidos (para autocomplete). Opcionalmente filtrada por UF."""
    out = []
    for v in geo()["muni_index"].values():
        if uf and v["uf"] != uf.strip().upper():
            continue
        out.append({"municipio": v["municipio"], "uf": v["uf"], "regiao": v["regiao"]})
    out.sort(key=lambda x: (x["uf"], norm(x["municipio"])))
    return out


def lista_microrregioes(uf: str = None):
    """Microrregioes (regiao imediata) unicas, para filtros. Opcionalmente por UF."""
    seen = {}
    for r in geo()["overview"]["regions"]:
        if uf and r["uf"] != uf.strip().upper():
            continue
        seen.setdefault((r["uf"], r["n"]), True)
    out = [{"uf": uf_, "microrregiao": n} for (uf_, n) in seen]
    out.sort(key=lambda x: (x["uf"], norm(x["microrregiao"])))
    return out


# --------------------------------------------------------------------------
# Geometria do overview (mapa nacional das 4 UFs) + centroides de microrregiao
# --------------------------------------------------------------------------
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def _path_points(d: str):
    """Extrai todos os pares (x,y) de um atributo 'd' SVG (comandos absolutos M/L)."""
    nums = [float(x) for x in _NUM.findall(d or "")]
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]


def _centroid(points):
    """Centroide por area do poligono (formula do shoelace); cai para media simples
    quando a area e degenerada."""
    n = len(points)
    if n == 0:
        return (0.0, 0.0)
    if n < 3:
        sx = sum(p[0] for p in points) / n
        sy = sum(p[1] for p in points) / n
        return (sx, sy)
    a = cx = cy = 0.0
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-9:
        sx = sum(p[0] for p in points) / n
        sy = sum(p[1] for p in points) / n
        return (sx, sy)
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a))


def region_centroids():
    """{(uf, regiao_norm): {"cx","cy"}} em coordenadas do overview (w/h do overview)."""
    global _REGION_CENTROIDS
    if _REGION_CENTROIDS is None:
        out = {}
        for r in geo()["overview"]["regions"]:
            cx, cy = _centroid(_path_points(r["d"]))
            out[(r["uf"], norm(r["n"]))] = {"cx": round(cx, 2), "cy": round(cy, 2)}
        _REGION_CENTROIDS = out
    return _REGION_CENTROIDS


def centroide_regiao(uf: str, microrregiao: str):
    """Centroide (cx,cy no overview) da microrregiao, ou None."""
    return region_centroids().get(((uf or "").strip().upper(), norm(microrregiao)))


def overview_regions():
    """Regioes do overview com path 'd' e centroide, para render no front."""
    cents = region_centroids()
    out = []
    for r in geo()["overview"]["regions"]:
        c = cents.get((r["uf"], norm(r["n"])), {"cx": 0, "cy": 0})
        out.append({"n": r["n"], "uf": r["uf"], "d": r["d"], "cx": c["cx"], "cy": c["cy"]})
    return out


def overview_dims():
    ov = geo()["overview"]
    return {"w": ov["w"], "h": ov["h"]}


# --------------------------------------------------------------------------
# Geometria por estado (mapa com municipios) para a visao com abas de UF
# --------------------------------------------------------------------------
def estado(uf: str):
    """Retorna {uf,nome,w,h,municipios:[{n,rg,d}],regioes:[{n,d}]} ou None."""
    if not uf:
        return None
    return geo()["states"].get(uf.strip().lower())


def centroide_municipio(uf: str, municipio: str):
    """Centroide (cx,cy) do municipio nas coordenadas do mapa do estado, ou None."""
    v = lookup_municipio(municipio, uf)
    if v:
        return {"cx": v["cx"], "cy": v["cy"]}
    return None
