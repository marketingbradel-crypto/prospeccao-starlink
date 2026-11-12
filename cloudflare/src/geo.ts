// Inteligencia geografica: lookup municipio -> microrregiao, centroides de
// microrregiao no SVG de overview e geometria por estado.
// Portado de app/geo.py. geo.json e empacotado no bundle do Worker.
import geoData from "./geo.json";
import { norm } from "./listas";

type Pt = [number, number];
interface MuniEntry { uf: string; municipio: string; regiao: string; cx: number; cy: number; state?: string }
interface Region { n: string; uf: string; d: string }
interface StateGeo {
  uf: string; nome: string; w: number; h: number;
  municipios: { n: string; rg?: string; d: string }[];
  regioes?: { n: string; d: string; lx?: number; ly?: number }[];
}
interface Geo {
  muni_index: Record<string, MuniEntry>;
  overview: { w: number; h: number; regions: Region[] };
  states: Record<string, StateGeo>;
}

const GEO = geoData as unknown as Geo;

function geo(): Geo {
  return GEO;
}

// --------------------------------------------------------------------------
// Lookup de municipio
// --------------------------------------------------------------------------
export function lookupMunicipio(municipio: string, uf?: string | null): MuniEntry | null {
  const idx = geo().muni_index;
  const nm = norm(municipio);
  if (uf) {
    return idx[`${uf.trim().toUpperCase()}|${nm}`] ?? null;
  }
  for (const key of Object.keys(idx)) {
    if (key.split("|", 2)[1] === nm) return idx[key];
  }
  return null;
}

export function microrregiaoDe(municipio: string, uf?: string | null): string {
  const v = lookupMunicipio(municipio, uf);
  return v ? v.regiao : "";
}

export function listaMunicipios(uf?: string | null) {
  const out: { municipio: string; uf: string; regiao: string }[] = [];
  const U = uf ? uf.trim().toUpperCase() : null;
  for (const v of Object.values(geo().muni_index)) {
    if (U && v.uf !== U) continue;
    out.push({ municipio: v.municipio, uf: v.uf, regiao: v.regiao });
  }
  out.sort((a, b) => a.uf.localeCompare(b.uf) || norm(a.municipio).localeCompare(norm(b.municipio)));
  return out;
}

export function listaMicrorregioes(uf?: string | null) {
  const U = uf ? uf.trim().toUpperCase() : null;
  const seen = new Set<string>();
  const out: { uf: string; microrregiao: string }[] = [];
  for (const r of geo().overview.regions) {
    if (U && r.uf !== U) continue;
    const key = `${r.uf}|${r.n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uf: r.uf, microrregiao: r.n });
  }
  out.sort((a, b) => a.uf.localeCompare(b.uf) || norm(a.microrregiao).localeCompare(norm(b.microrregiao)));
  return out;
}

// --------------------------------------------------------------------------
// Geometria do overview + centroides de microrregiao
// --------------------------------------------------------------------------
const NUM = /-?\d+(?:\.\d+)?/g;

function pathPoints(d: string): Pt[] {
  const nums = (d || "").match(NUM)?.map(Number) ?? [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

function centroid(points: Pt[]): Pt {
  const n = points.length;
  if (n === 0) return [0, 0];
  if (n < 3) {
    const sx = points.reduce((s, p) => s + p[0], 0) / n;
    const sy = points.reduce((s, p) => s + p[1], 0) / n;
    return [sx, sy];
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = points.reduce((s, p) => s + p[0], 0) / n;
    const sy = points.reduce((s, p) => s + p[1], 0) / n;
    return [sx, sy];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

let _regionCentroids: Record<string, { cx: number; cy: number }> | null = null;

function regionCentroids(): Record<string, { cx: number; cy: number }> {
  if (_regionCentroids === null) {
    const out: Record<string, { cx: number; cy: number }> = {};
    for (const r of geo().overview.regions) {
      const [cx, cy] = centroid(pathPoints(r.d));
      out[`${r.uf}|${norm(r.n)}`] = { cx: Math.round(cx * 100) / 100, cy: Math.round(cy * 100) / 100 };
    }
    _regionCentroids = out;
  }
  return _regionCentroids;
}

export function centroideRegiao(uf: string, microrregiao: string): { cx: number; cy: number } | null {
  return regionCentroids()[`${(uf || "").trim().toUpperCase()}|${norm(microrregiao)}`] ?? null;
}

export function overviewRegions() {
  const cents = regionCentroids();
  return geo().overview.regions.map((r) => {
    const c = cents[`${r.uf}|${norm(r.n)}`] ?? { cx: 0, cy: 0 };
    return { n: r.n, uf: r.uf, d: r.d, cx: c.cx, cy: c.cy };
  });
}

export function overviewDims() {
  const ov = geo().overview;
  return { w: ov.w, h: ov.h };
}

// --------------------------------------------------------------------------
// Geometria por estado (mapa com municipios)
// --------------------------------------------------------------------------
export function estado(uf: string): StateGeo | null {
  if (!uf) return null;
  return geo().states[uf.trim().toLowerCase()] ?? null;
}

export function centroideMunicipio(uf: string, municipio: string): { cx: number; cy: number } | null {
  const v = lookupMunicipio(municipio, uf);
  return v ? { cx: v.cx, cy: v.cy } : null;
}
