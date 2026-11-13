/* Plataforma de Prospecção Starlink — Bradel. SPA sem framework. */
"use strict";

const App = (() => {
  let B = null;            // bootstrap (listas, cores, mapa)
  let OUTLINES = {};       // contornos (uniao das microrregioes) por UF
  let GEOUF = {};          // geometria por estado (municipios + microrregioes), cache /api/geo/:uf
  let MAP = null;          // dados do mapa (/api/mapa)
  let DASH = null;         // dados do painel (/api/dashboard)
  let EMPRESAS = [];       // lista atual filtrada
  let cur = null;          // empresa aberta no drawer
  let editMode = false;
  let sel = null;          // "UF|microrregiao" selecionada no mapa
  let buscaTimer = null;
  let PROSPEC = [];        // resultados atuais da busca de prospecção (Google Places)
  let prospecReady = false; // filtros da aba Prospecção já montados?
  let HIST = [];           // histórico de pesquisas (metadados), por região
  let curPesquisa = null;  // id da pesquisa atualmente exibida nos resultados

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hexCor = (cor) => (B && B.cor_hex[cor]) || "#9aa0ac";
  const corStatus = (st) => (B && B.status_cor[st]) || "cinza";

  // -------- formulário de empresa (geração automática) --------
  const FORM = [
    { t: "Dados da empresa", f: [
      { k: "razao_social", l: "Razão social", req: 1, full: 1 },
      { k: "nome_fantasia", l: "Nome fantasia", full: 1 },
      { k: "cnpj", l: "CNPJ" }, { k: "inscricao_estadual", l: "Inscrição estadual" },
      { k: "telefone_comercial", l: "Telefone comercial" }, { k: "whatsapp", l: "WhatsApp" },
      { k: "email_comercial", l: "E-mail comercial" }, { k: "site_instagram", l: "Site / Instagram" },
      { k: "endereco", l: "Endereço", full: 1 },
      { k: "cep", l: "CEP" }, { k: "cidade", l: "Cidade" },
      { k: "uf", l: "UF", type: "select", opts: "ufs" },
      { k: "microrregiao", l: "Microrregião (automática)" },
      { k: "latitude", l: "Latitude", type: "num" }, { k: "longitude", l: "Longitude", type: "num" },
    ]},
    { t: "Responsável na empresa", f: [
      { k: "resp_nome", l: "Nome", full: 1 },
      { k: "resp_cargo", l: "Cargo" }, { k: "resp_telefone", l: "Telefone direto" },
      { k: "resp_whatsapp", l: "WhatsApp" }, { k: "resp_email", l: "E-mail" },
    ]},
    { t: "Informações comerciais", f: [
      { k: "segmento", l: "Segmento", type: "select", opts: "segmentos", full: 1 },
      { k: "produtos", l: "Principais produtos", full: 1 },
      { k: "trabalha_telecom", l: "Trabalha com telecom/tecnologia?", type: "bool" },
      { k: "ja_starlink", l: "Já comercializa Starlink?", type: "bool" },
      { k: "exp_antenas", l: "Experiência com antenas?", type: "bool" },
      { k: "equipe_tecnica", l: "Possui equipe técnica?", type: "bool" },
      { k: "loja_fisica", l: "Possui loja física?", type: "bool" },
      { k: "qtd_filiais", l: "Qtd. filiais", type: "num" },
      { k: "capacidade_vendas_mes", l: "Capacidade de vendas/mês" },
      { k: "interesse_parceiro", l: "Interesse em ser parceiro", type: "select", opts: "interesse" },
      { k: "origem_contato", l: "Origem do contato", type: "select", opts: "origens" },
    ]},
    { t: "Classificação e gestão", f: [
      { k: "faixa_potencial", l: "Potencial (vendas/mês)", type: "select", opts: "faixas_potencial" },
      { k: "ja_vendeu", l: "Já fez venda?", type: "bool" },
      { k: "status", l: "Status comercial", type: "select", opts: "status" },
      { k: "status_vivensis", l: "Status Vivensis", type: "select", opts: "status_vivensis" },
      { k: "canal", l: "Canal", type: "select", opts: "canais" },
      { k: "responsavel", l: "Responsável interno", type: "select", opts: "responsaveis" },
      { k: "prioridade", l: "Prioridade", type: "select", opts: "prioridades" },
      { k: "motivo_perda", l: "Motivo de perda", type: "select", opts: "motivos_perda" },
      { k: "proxima_acao", l: "Próxima ação", full: 1 },
      { k: "proxima_acao_data", l: "Data da próxima ação", type: "date" },
      { k: "data_ultimo_contato", l: "Data do último contato", type: "date" },
      { k: "observacoes", l: "Observações", type: "textarea", full: 1 },
    ]},
  ];

  // ==================== INIT ====================
  async function init() {
    const t = localStorage.getItem("tema");
    if (t) document.documentElement.setAttribute("data-theme", t);
    B = await (await fetch("/api/bootstrap")).json();
    try { OUTLINES = await (await fetch("/static/state-outlines.json")).json(); } catch (e) { OUTLINES = {}; }
    montarFiltros();
    await recarregar();
    window.addEventListener("scroll", hideTip, true);
  }

  function selOpts(lista, vazio) {
    return (vazio ? `<option value="">${vazio}</option>` : "") +
      lista.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
  }

  function montarFiltros() {
    $("f-uf").innerHTML = selOpts(B.ufs, "Todos os estados");
    $("f-mr").innerHTML = `<option value="">Todas</option>`;
    $("f-seg").innerHTML = selOpts(B.segmentos, "Todos");
    $("f-status").innerHTML = selOpts(B.status, "Todos");
    $("f-faixa").innerHTML = selOpts(B.faixas_potencial, "Todos");
    $("f-resp").innerHTML = selOpts(B.responsaveis, "Todos");
    $("f-canal").innerHTML = selOpts(B.canais, "Todos");
    // f-uf usa onchange=App.ufMudou() no HTML; os demais recarregam direto
    ["f-mr", "f-seg", "f-status", "f-faixa", "f-vendeu", "f-resp", "f-canal"].forEach(id => $(id).addEventListener("change", recarregar));
    ["f-cred", "f-pot", "f-tel"].forEach(id => $(id).addEventListener("change", recarregar));
    $("legend").innerHTML = ["verde", "azul", "amarelo", "laranja", "vermelho"]
      .map(c => `<span><i style="background:${hexCor(c)}"></i>${esc(B.cor_label[c])}</span>`).join("");
  }

  async function ufMudou() {
    const uf = $("f-uf").value;
    const lista = uf ? await (await fetch("/api/microrregioes?uf=" + encodeURIComponent(uf))).json() : [];
    $("f-mr").innerHTML = `<option value="">Todas</option>` +
      lista.map(o => `<option value="${esc(o.microrregiao)}">${esc(o.microrregiao)}</option>`).join("");
    recarregar();
  }

  function qs() {
    const p = new URLSearchParams();
    const add = (id, key) => { const v = $(id).value; if (v) p.set(key, v); };
    add("f-uf", "uf"); add("f-mr", "microrregiao"); add("f-seg", "segmento");
    add("f-status", "status"); add("f-faixa", "faixa"); add("f-vendeu", "vendeu");
    add("f-resp", "responsavel"); add("f-canal", "canal");
    if ($("f-cred").checked) p.set("credenciado", "1");
    if ($("f-pot").checked) p.set("potencial", "1");
    if ($("f-tel").checked) p.set("telecom", "1");
    const b = $("busca").value.trim(); if (b) p.set("q", b);
    return p.toString();
  }

  async function recarregar() {
    const q = qs();
    const uf = $("f-uf").value;
    const tasks = [
      fetch("/api/empresas?" + q).then(r => r.json()),
      fetch("/api/mapa?" + q).then(r => r.json()),
      fetch("/api/dashboard").then(r => r.json()),
    ];
    // Carrega (uma vez) a geometria do estado filtrado para o mapa de detalhe.
    if (uf && !GEOUF[uf]) tasks.push(fetch("/api/geo/" + encodeURIComponent(uf)).then(r => r.json()).then(g => { GEOUF[uf] = g; }));
    const [emp, mp, dsh] = await Promise.all(tasks);
    EMPRESAS = emp; MAP = mp; DASH = dsh;
    renderKPIs(); renderMapa(); renderLista(); renderRanking();
    if (!$("view-painel").classList.contains("hidden")) renderPainel();
  }

  // ==================== KPIs ====================
  function renderKPIs() {
    const d = DASH;
    const cards = [
      { v: d.total, l: "Empresas mapeadas", c: "var(--accent)" },
      { v: d.potenciais, l: "Potenciais", c: hexCor("azul") },
      { v: d.em_negociacao, l: "Em negociação", c: hexCor("amarelo") },
      { v: d.credenciados, l: "Credenciados", c: hexCor("verde") },
      { v: d.municipios, l: "Municípios alcançados", c: "var(--muted)" },
      { v: d.taxa_conversao + "%", l: "Conversão → credenciado", c: hexCor("verde") },
    ];
    $("kpibar").innerHTML = cards.map(k =>
      `<div class="kpi"><div class="v" style="color:${k.c}">${k.v}</div><div class="l"><span class="dot" style="background:${k.c}"></span>${k.l}</div></div>`
    ).join("");
  }

  // ==================== NAVEGAÇÃO DO MAPA (pan / zoom) ====================
  // Controla zoom e deslocamento aplicando um transform ao grupo <g id="mapg">
  // dentro do SVG. O viewBox permanece fixo (= dimensões base), então as
  // coordenadas dos cliques, tooltips e drill-down continuam idênticas.
  const PZ = {
    svg: null, g: null, scale: 1, tx: 0, ty: 0, min: 1, max: 16,
    vb: { x: 0, y: 0, w: 0, h: 0 },
    pointers: new Map(), last: null, pinchDist: 0, moved: 0, wired: false, raf: 0,

    // (Re)conecta o controlador ao SVG após cada render. Reseta para a visão inicial.
    init(svg) {
      this.svg = svg;
      this.g = svg.querySelector("#mapg");
      const vb = (svg.getAttribute("viewBox") || "0 0 100 100").split(/[\s,]+/).map(Number);
      this.vb = { x: vb[0] || 0, y: vb[1] || 0, w: vb[2] || 100, h: vb[3] || 100 };
      this.scale = 1; this.tx = 0; this.ty = 0;
      this.pointers.clear(); this.last = null;
      this.apply();
      if (!this.wired) this.wire();
    },

    apply() {
      if (!this.g) return;
      this.g.setAttribute("transform", `translate(${this.tx.toFixed(2)} ${this.ty.toFixed(2)}) scale(${this.scale})`);
      this.svg.style.setProperty("--z", this.scale);
    },

    clamp() {
      const minTx = this.vb.x + this.vb.w * (1 - this.scale);
      const minTy = this.vb.y + this.vb.h * (1 - this.scale);
      this.tx = Math.min(this.vb.x, Math.max(minTx, this.tx));
      this.ty = Math.min(this.vb.y, Math.max(minTy, this.ty));
    },

    // Converte coordenada de tela (clientX/Y) para o espaço do viewBox.
    toUser(cx, cy) {
      const m = this.svg.getScreenCTM();
      if (!m) return { x: 0, y: 0, k: 1 };
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      return { x: p.x, y: p.y, k: m.a };
    },

    // Zoom mantendo fixo o ponto sob o cursor (clientX/Y de tela).
    zoomAt(factor, cx, cy) {
      const s2 = Math.min(this.max, Math.max(this.min, this.scale * factor));
      if (Math.abs(s2 - this.scale) < 1e-4) return;
      const u = this.toUser(cx, cy);
      const r = s2 / this.scale;
      this.tx = u.x - (u.x - this.tx) * r;
      this.ty = u.y - (u.y - this.ty) * r;
      this.scale = s2;
      this.clamp(); this.apply();
    },

    // Zoom pelos botões: aproxima/afasta a partir do centro do mapa.
    btnZoom(factor) {
      const r = this.svg.getBoundingClientRect();
      this.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
    },

    panBy(dxUser, dyUser) {
      this.tx += dxUser; this.ty += dyUser;
      this.clamp(); this.apply();
    },

    // Volta à visão inicial (enquadra todo o mapa).
    home() { this.scale = 1; this.tx = 0; this.ty = 0; this.apply(); },

    // Enquadra todos os marcadores cadastrados; sem marcadores, volta à visão inicial.
    fit() {
      const cs = this.g ? this.g.querySelectorAll("circle.mk") : [];
      if (!cs.length) { this.home(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      cs.forEach(c => {
        const x = +c.getAttribute("cx"), y = +c.getAttribute("cy");
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      });
      const pad = Math.max(x1 - x0, y1 - y0) * 0.1 + 12;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      this.scale = Math.min(this.max, Math.max(this.min, Math.min(this.vb.w / bw, this.vb.h / bh)));
      const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
      this.tx = this.vb.x + this.vb.w / 2 - this.scale * bcx;
      this.ty = this.vb.y + this.vb.h / 2 - this.scale * bcy;
      this.clamp(); this.apply();
    },

    toggleFull() {
      const el = $("map-card") || document.querySelector(".map-card");
      if (!el) return;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
      else { (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); }
    },

    // Liga os eventos uma única vez ao SVG (persistem entre re-renders) e aos botões.
    wire() {
      this.wired = true;
      const svg = this.svg;

      svg.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
      }, { passive: false });

      svg.addEventListener("pointerdown", (e) => {
        svg.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.moved = 0;
        if (this.pointers.size === 1) { this.last = { x: e.clientX, y: e.clientY }; svg.classList.add("panning"); }
        else if (this.pointers.size === 2) { this.pinchDist = this._dist(); this.last = null; }
      });

      svg.addEventListener("pointermove", (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size >= 2) {
          const d = this._dist(); if (!this.pinchDist) this.pinchDist = d;
          const mid = this._mid();
          this.zoomAt(d / this.pinchDist, mid.x, mid.y);
          this.pinchDist = d; this.moved += 10;
        } else if (this.last) {
          const u = this.toUser(0, 0), k = u.k || 1; // k = escala tela->user
          const dx = (e.clientX - this.last.x) / k, dy = (e.clientY - this.last.y) / k;
          this.moved += Math.abs(e.clientX - this.last.x) + Math.abs(e.clientY - this.last.y);
          this.last = { x: e.clientX, y: e.clientY };
          this.panBy(dx, dy);
        }
      });

      const up = (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size === 1) { const p = [...this.pointers.values()][0]; this.last = { x: p.x, y: p.y }; this.pinchDist = 0; }
        if (this.pointers.size === 0) { this.last = null; this.pinchDist = 0; svg.classList.remove("panning"); }
      };
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointercancel", up);

      // Bloqueia o "click" que o navegador dispara ao final de um arraste (evita
      // selecionar região / abrir ficha sem querer depois de um pan).
      svg.addEventListener("click", (e) => {
        if (this.moved > 6) { e.stopPropagation(); e.preventDefault(); this.moved = 0; }
      }, true);

      const on = (id, fn) => { const b = $(id); if (b) b.addEventListener("click", fn); };
      on("mz-in", () => this.btnZoom(1.4));
      on("mz-out", () => this.btnZoom(1 / 1.4));
      on("mz-home", () => this.home());
      on("mz-fit", () => this.fit());
      on("mz-full", () => this.toggleFull());
    },

    _dist() {
      const p = [...this.pointers.values()];
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    },
    _mid() {
      const p = [...this.pointers.values()];
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    },
  };

  // ==================== MAPA ====================
  function heatLevel(c, max) {
    if (!c) return 0;
    if (max <= 6) return Math.min(6, c);
    return Math.min(6, Math.max(1, Math.round(c / max * 6)));
  }

  // Despacho: sem estado filtrado -> visão geral dos 4 estados; com um estado
  // filtrado -> "desce" para o mapa só daquele estado (microrregiões + municípios).
  function renderMapa() {
    const uf = $("f-uf").value;
    if (uf && GEOUF[uf]) renderMapaEstado(uf);
    else renderMapaOverview();
  }

  // Centroide poligonal a partir do atributo "d" (comandos M/L absolutos).
  function pathCentroid(d) {
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const n = pts.length;
    if (!n) return [0, 0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
      const cr = x0 * y1 - x1 * y0; a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
    }
    if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
    a *= 0.5; return [cx / (6 * a), cy / (6 * a)];
  }

  function wireMapa(svg) {
    svg.querySelectorAll("path.rg").forEach(p => {
      p.addEventListener("mousemove", regiaoTip);
      p.addEventListener("mouseleave", hideTip);
      p.addEventListener("click", () => selecionarRegiao(p.dataset.key, p.dataset.uf, p.dataset.n));
    });
    svg.querySelectorAll("circle.mk").forEach(c => {
      c.addEventListener("mousemove", markerTip);
      c.addEventListener("mouseleave", hideTip);
      c.addEventListener("click", () => abrirFicha(+c.dataset.id));
    });
  }

  // Visão geral: 4 estados juntos, heatmap quente por microrregião + contornos de UF.
  function renderMapaOverview() {
    const { w, h } = B.map.dims;
    const regs = B.map.regions, agg = MAP.regioes, max = MAP.max;
    const selUF = sel ? sel.split("|")[0] : null;
    let paths = "";
    for (const r of regs) {
      const key = r.uf + "|" + r.n;
      const a = agg[key];
      const lvl = heatLevel(a ? a.count : 0, max);
      const on = sel === key ? " sel" : "";
      paths += `<path class="rg heat${lvl}${on}" d="${r.d}" data-key="${esc(key)}" data-uf="${r.uf}" data-n="${esc(r.n)}"></path>`;
    }
    const porUF = {};
    for (const r of regs) (porUF[r.uf] = porUF[r.uf] || []).push(r);
    let outlines = "", labels = "";
    for (const uf of Object.keys(porUF)) {
      const list = porUF[uf];
      const off = selUF && selUF !== uf ? " off" : "";
      const dUF = OUTLINES[uf];
      if (dUF) outlines += `<path class="state-outline${off}" d="${dUF}" data-uf="${uf}"></path>`;
      const cx = list.reduce((s, r) => s + (r.cx || 0), 0) / list.length;
      const cy = list.reduce((s, r) => s + (r.cy || 0), 0) / list.length;
      labels += `<text class="state-lbl${off}" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${uf}</text>`;
    }
    let marks = "";
    for (const m of MAP.marcadores) {
      marks += `<circle class="mk" cx="${m.x}" cy="${m.y}" r="5" fill="${m.hex}" data-id="${m.id}"></circle>`;
    }
    const svg = $("mapa");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.classList.toggle("dim", !!sel);
    svg.innerHTML = `<g id="mapg">${paths + outlines + labels + marks}</g>`;
    wireMapa(svg);
    PZ.init(svg);
  }

  // Detalhe de um estado: microrregiões com heatmap quente (escala relativa ao
  // estado), linhas finas dos municípios por dentro e rótulo (nome + nº empresas).
  function renderMapaEstado(uf) {
    const g = GEOUF[uf], agg = MAP.regioes;
    let max = 0;
    for (const r of g.regioes) { const a = agg[uf + "|" + r.n]; if (a && a.count > max) max = a.count; }
    let paths = "", munis = "", labels = "";
    for (const m of g.municipios) munis += `<path class="muni" d="${m.d}"></path>`;
    for (const r of g.regioes) {
      const key = uf + "|" + r.n;
      const a = agg[key];
      const c = a ? a.count : 0;
      const lvl = heatLevel(c, max);
      const on = sel === key ? " sel" : "";
      paths += `<path class="rg rg-state heat${lvl}${on}" d="${r.d}" data-key="${esc(key)}" data-uf="${uf}" data-n="${esc(r.n)}"></path>`;
      let lx = r.lx, ly = r.ly;
      if (lx == null || ly == null) { const ct = pathCentroid(r.d); lx = ct[0]; ly = ct[1]; }
      lx = (+lx).toFixed(1); ly = (+ly).toFixed(1);
      labels += `<text class="rg-lbl" x="${lx}" y="${ly}">${esc(r.n)}<tspan class="v" x="${lx}" dy="1.05em">${c}</tspan></text>`;
    }
    const svg = $("mapa");
    svg.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
    svg.classList.toggle("dim", !!sel);
    svg.innerHTML = `<g id="mapg">${paths + munis + labels}</g>`;
    wireMapa(svg);
    PZ.init(svg);
  }

  function regiaoTip(e) {
    const key = e.target.dataset.key, a = MAP.regioes[key];
    const [uf, n] = key.split("|");
    let rows = `<div class="r"><span>Empresas</span><span class="num">${a ? a.count : 0}</span></div>`;
    if (a && a.credenciados) rows += `<div class="r"><span>Credenciados</span><span class="num">${a.credenciados}</span></div>`;
    showTip(e, `<strong>${esc(n)} · ${uf}</strong>${rows}<div class="r" style="margin-top:4px;font-size:11.5px">clique para filtrar</div>`);
  }
  function markerTip(e) {
    const id = +e.target.dataset.id, m = MAP.marcadores.find(x => x.id === id);
    if (!m) return;
    showTip(e, `<strong>${esc(m.nome)}</strong><div class="r"><span>${esc(m.municipio || "")} · ${m.uf}</span></div><div class="r"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${m.hex};margin-right:5px"></span>${esc(m.status)}</span></div>`);
  }
  function showTip(e, html) {
    const t = $("tip"); t.innerHTML = html; t.classList.remove("hidden");
    let x = e.clientX + 14, y = e.clientY + 14;
    const r = t.getBoundingClientRect();
    if (x + r.width > innerWidth) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight) y = e.clientY - r.height - 14;
    t.style.left = x + "px"; t.style.top = y + "px";
  }
  function hideTip() { $("tip").classList.add("hidden"); }

  function selecionarRegiao(key, uf, n) {
    if (sel === key) {
      sel = null; $("f-mr").value = "";
      $("map-ctx").textContent = "Concentração de empresas por microrregião · marcadores = empresas por status";
    } else {
      sel = key;
      if ($("f-uf").value !== uf) $("f-uf").value = uf;
      $("map-ctx").textContent = `Microrregião: ${n} · ${uf}`;
    }
    hideTip();
    fetch("/api/microrregioes?uf=" + encodeURIComponent(uf)).then(r => r.json()).then(lista => {
      $("f-mr").innerHTML = `<option value="">Todas</option>` +
        lista.map(o => `<option value="${esc(o.microrregiao)}">${esc(o.microrregiao)}</option>`).join("");
      $("f-mr").value = sel ? n : "";
      recarregar();
    });
  }

  // ==================== LISTA ====================
  function renderLista() {
    $("list-title").textContent = `Empresas (${EMPRESAS.length})`;
    if (!EMPRESAS.length) { $("lista").innerHTML = `<div class="empty">Nenhuma empresa para os filtros atuais.</div>`; return; }
    const rows = EMPRESAS.map(e => {
      const fx = e.faixa_potencial || "";
      const fxHex = (B && B.faixa_hex && B.faixa_hex[fx]) || "#9aa0ac";
      const fxCurta = fx ? fx.replace(" vendas/mês", "") : "—";
      const venda = e.ja_vendeu ? `<span class="tag-venda" title="Já fez venda">✓</span>` : "";
      return `
      <tr onclick="App.abrirFicha(${e.id})" onmouseenter="App.realce(${e.id},1)" onmouseleave="App.realce(${e.id},0)">
        <td>${esc(e.nome_fantasia || e.razao_social)} ${venda}<br><span class="hint">${esc(e.cidade || "")}${e.uf ? " · " + e.uf : ""}</span></td>
        <td><span class="pill-faixa sm" style="--pc:${fxHex}"><span class="d" style="background:${fxHex}"></span>${esc(fxCurta)}</span></td>
        <td><span class="badge"><span class="d" style="background:${e.cor_hex}"></span>${esc(e.status || "")}</span></td>
      </tr>`;
    }).join("");
    $("lista").innerHTML = `<table><thead><tr><th>Empresa</th><th>Potencial</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function realce(id, on) {
    const c = $("mapa").querySelector(`circle.mk[data-id="${id}"]`);
    if (c) c.classList.toggle("hot", !!on);
  }

  // ==================== RANKING ====================
  function renderRanking() {
    const arr = Object.values(MAP.regioes).sort((a, b) => b.count - a.count).slice(0, 12);
    if (!arr.length) { $("ranking").innerHTML = `<div class="empty">Sem dados.</div>`; return; }
    const max = arr[0].count || 1;
    $("ranking").innerHTML = arr.map(a => `
      <div class="row">
        <span class="uf">${a.uf}</span>
        <span class="nm">${esc(a.microrregiao || "—")}</span>
        <span class="track" style="flex:0 0 110px"><span class="bar" style="width:${Math.round(a.count / max * 100)}%"></span></span>
        <span class="n">${a.count}</span>
      </div>`).join("");
  }

  // ==================== PAINEL (dashboard) ====================
  function chart(dados, corFn) {
    const max = Math.max(1, ...dados.map(d => d[1]));
    return `<div class="chart">` + dados.map(([lbl, v]) =>
      `<div class="row"><span class="lbl" title="${esc(lbl)}">${esc(lbl)}</span>
        <span class="track"><span class="fill" style="width:${Math.round(v / max * 100)}%;background:${corFn(lbl)}"></span></span>
        <span class="val">${v}</span></div>`).join("") + `</div>`;
  }

  // Rotulo curto do mes "YYYY-MM" -> "abr/26".
  const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function rotuloMes(ym) {
    const [y, m] = String(ym).split("-");
    return `${MESES_ABREV[(Number(m) || 1) - 1]}/${String(y).slice(2)}`;
  }

  // Gráfico de colunas verticais com duas séries (leads x credenciamentos) por mês.
  function chartMensal(serie) {
    if (!serie || !serie.length) return '<div class="empty">Sem datas suficientes para a evolução mensal.</div>';
    const max = Math.max(1, ...serie.map(s => Math.max(s.leads, s.creds)));
    const cols = serie.map(s => {
      const hl = Math.round(s.leads / max * 100), hc = Math.round(s.creds / max * 100);
      return `<div class="vcol">
        <div class="vbars">
          <span class="vbar lead" style="height:${hl}%" title="${s.leads} lead(s) em ${rotuloMes(s.mes)}"><em>${s.leads || ""}</em></span>
          <span class="vbar cred" style="height:${hc}%" title="${s.creds} credenciamento(s) em ${rotuloMes(s.mes)}"><em>${s.creds || ""}</em></span>
        </div>
        <div class="vlbl">${rotuloMes(s.mes)}</div>
      </div>`;
    }).join("");
    return `<div class="vchart">${cols}</div>
      <div class="vleg">
        <span><i style="background:${hexCor("azul")}"></i>Leads (novas empresas)</span>
        <span><i style="background:${hexCor("verde")}"></i>Credenciamentos</span>
      </div>`;
  }

  // Cartão de tempo médio de uma etapa do funil.
  function tempoStat(label, t) {
    const v = (t && t.dias != null) ? `${t.dias}<small> dias</small>` : "—";
    const n = (t && t.n) ? `${t.n} empresa${t.n === 1 ? "" : "s"}` : "sem dados";
    return `<div class="stat"><div class="v">${v}</div><div class="l">${esc(label)}</div><div class="l" style="opacity:.7">${n}</div></div>`;
  }

  function renderPainel() {
    const d = DASH;
    const stats = [
      ["Total mapeadas", d.total], ["Potenciais", d.potenciais], ["Em negociação", d.em_negociacao],
      ["Aguardando doc.", d.aguardando], ["Credenciados", d.credenciados], ["Perdidos/sem retorno", d.perdidos],
      ["Municípios", d.municipios], ["Microrregiões", d.microrregioes],
      ["Já venderam", d.ja_venderam || 0],
    ];
    const statusData = B.status.map(s => [s, d.por_status[s] || 0]).filter(x => x[1] > 0);
    const ufData = B.ufs.map(u => [u, d.por_uf[u] || 0]);
    const segData = Object.entries(d.por_segmento);
    const faixaData = (B.faixas_potencial || []).map(f => [f, (d.por_faixa && d.por_faixa[f]) || 0]);
    if (d.sem_faixa) faixaData.push(["Sem classificação", d.sem_faixa]);
    const tf = d.tempos_funil || {};
    $("view-painel").innerHTML = `
      <div class="card wide"><div class="hd"><h2>Resumo geral</h2></div><div class="bd">
        <div class="statgrid">${stats.map(s => `<div class="stat"><div class="v">${s[1]}</div><div class="l">${esc(s[0])}</div></div>`).join("")}</div>
      </div></div>
      <div class="card"><div class="hd"><h2>Por status comercial</h2></div><div class="bd">${statusData.length ? chart(statusData, l => hexCor(corStatus(l))) : '<div class="empty">Sem dados.</div>'}</div></div>
      <div class="card"><div class="hd"><h2>Distribuição por estado</h2></div><div class="bd">${chart(ufData, () => "var(--accent)")}</div></div>
      <div class="card wide"><div class="hd"><h2>Por potencial de vendas/mês</h2></div><div class="bd">${faixaData.some(x => x[1] > 0) ? chart(faixaData, l => (B.faixa_hex && B.faixa_hex[l]) || "var(--muted)") : '<div class="empty">Nenhuma empresa classificada por potencial ainda.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Por segmento</h2></div><div class="bd">${segData.length ? chart(segData, () => "var(--brand2)") : '<div class="empty">Sem segmentos informados.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Funil de conversão</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="stat"><div class="v">${d.total}</div><div class="l">Prospectados (base)</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("amarelo")}">${d.em_negociacao + d.aguardando}</div><div class="l">Em andamento</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("verde")}">${d.credenciados}</div><div class="l">Credenciados (${d.taxa_conversao}%)</div></div>
        </div>
      </div></div>
      <div class="card wide"><div class="hd"><h2>Evolução mensal</h2></div><div class="bd">${chartMensal(d.serie_mensal)}</div></div>
      <div class="card wide"><div class="hd"><h2>Tempo médio no funil</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          ${tempoStat("Lead → 1º contato", tf.lead_contato)}
          ${tempoStat("Lead → credenciamento", tf.lead_cred)}
          ${tempoStat("Credenciado → 1ª venda", tf.cred_venda)}
        </div>
      </div></div>`;
  }

  function view(v) {
    const views = { mapa: "view-mapa", painel: "view-painel", prospec: "view-prospec" };
    Object.entries(views).forEach(([k, id]) => $(id).classList.toggle("hidden", k !== v));
    ["mapa", "painel", "prospec"].forEach(k => $("tab-" + k).classList.toggle("on", k === v));
    if (v === "painel") renderPainel();
    if (v === "prospec") initProspec();
  }

  // ==================== PROSPECÇÃO (busca Google Places) ====================
  function initProspec() {
    if (!prospecReady) {
      $("p-uf").innerHTML = selOpts(B.ufs, "Todos os estados");
      $("p-hist-uf").innerHTML = `<option value="">Todas</option>` +
        B.ufs.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
      prospecReady = true;
      carregarCronStatus();
    }
    carregarHist();
  }

  async function carregarCronStatus() {
    try {
      const s = await (await fetch("/api/prospeccao/cron-status")).json();
      renderCronStatus(s);
    } catch (e) { /* silencioso */ }
  }

  function renderCronStatus(s) {
    const el = $("p-auto-txt");
    if (!el) return;
    if (!s.ativo) {
      el.innerHTML = `Varredura automática <b>inativa</b> — falta configurar a chave de busca (SERPER_API_KEY ou PLACES_API_KEY).`;
      return;
    }
    const partes = [`Varredura automática <b>diária</b> (${s.batch} cidades/dia)`];
    if (s.ultima) {
      const st = s.stats || {};
      partes.push(`última: ${esc(s.ultima)}`);
      if (typeof st.criados === "number") partes.push(`${st.criados} novo(s), ${st.duplicados || 0} já existia(m)`);
    } else {
      partes.push("ainda não executada");
    }
    if (s.total) partes.push(`cobertura: ${s.cursor || 0}/${s.total} cidades`);
    el.innerHTML = partes.join(" · ");
  }

  async function varreduraAgora() {
    const btn = $("p-runnow");
    btn.disabled = true; btn.textContent = "Rodando varredura…";
    try {
      const r = await fetch("/api/prospeccao/varredura", { method: "POST" });
      const js = await r.json();
      if (!r.ok || js.ok === false) { toast(js.erro || "Falha na varredura."); return; }
      toast(`Varredura: ${js.criados} nova(s) empresa(s) em ${js.buscas} busca(s).`);
      carregarCronStatus();
      recarregar();
    } finally {
      btn.disabled = false; btn.textContent = "Rodar varredura agora";
    }
  }

  async function pUfMudou() {
    const uf = $("p-uf").value;
    if (!uf) {
      $("p-cidades").innerHTML = "";
      $("p-mr").innerHTML = `<option value="">Todas</option>`;
      return;
    }
    const [munis, mrs] = await Promise.all([
      fetch("/api/municipios?uf=" + encodeURIComponent(uf)).then(r => r.json()),
      fetch("/api/microrregioes?uf=" + encodeURIComponent(uf)).then(r => r.json()),
    ]);
    $("p-cidades").innerHTML = munis.map(m => `<option value="${esc(m.municipio)}">`).join("");
    $("p-mr").innerHTML = `<option value="">Todas</option>` +
      mrs.map(o => `<option value="${esc(o.microrregiao)}">${esc(o.microrregiao)}</option>`).join("");
  }

  function sugProspec(t) { $("p-termo").value = t; buscarProspec(); }

  async function buscarProspec() {
    const termo = $("p-termo").value.trim();
    const uf = $("p-uf").value, cidade = $("p-cidade").value.trim(), mr = $("p-mr").value;
    if (!termo && !uf && !cidade) { toast("Informe um termo, cidade ou estado para buscar."); return; }
    const btn = $("p-buscar"); btn.disabled = true; btn.textContent = "Buscando…";
    $("p-saveall").style.display = "none";
    $("p-info").textContent = "";
    $("p-lista").innerHTML = `<div class="empty">Buscando empresas na web…</div>`;
    try {
      const p = new URLSearchParams();
      if (termo) p.set("termo", termo);
      if (uf) p.set("uf", uf);
      if (cidade) p.set("cidade", cidade);
      if (mr) p.set("microrregiao", mr);
      const r = await fetch("/api/busca-places?" + p.toString());
      const js = await r.json();
      if (!r.ok) {
        PROSPEC = [];
        $("p-lista").innerHTML = `<div class="empty">${esc(js.erro || "Falha na busca.")}</div>`;
        return;
      }
      PROSPEC = js.resultados || [];
      curPesquisa = js.pesquisa_id || null;
      renderProspecResults(js);
      carregarHist();
    } finally {
      btn.disabled = false; btn.textContent = "Buscar";
    }
  }

  function renderProspecResults(js) {
    renderMiniMapa();
    $("p-title").textContent = `Resultados (${PROSPEC.length})`;
    const novos = PROSPEC.filter(x => !x.ja_salvo).length;
    const info = [];
    if (js && js.excluidos) info.push(`${js.excluidos} grande(s) rede(s) excluída(s)`);
    if (novos) info.push(`${novos} novo(s) para salvar`);
    $("p-info").textContent = info.join(" · ");
    $("p-saveall").style.display = novos ? "" : "none";
    if (!PROSPEC.length) {
      $("p-lista").innerHTML = `<div class="empty">Nenhuma empresa encontrada para esta busca. Tente outro termo, cidade ou estado.</div>`;
      return;
    }
    $("p-lista").innerHTML = PROSPEC.map((x, i) => cardProspec(x, i)).join("");
  }

  function cardProspec(x, i) {
    const loc = [x.cidade, x.uf].filter(Boolean).join(" · ");
    const tel = x.telefone || "";
    const linhas = [];
    if (tel) linhas.push(`<div class="pl"><span>${x.whatsapp ? "WhatsApp" : "Telefone"}</span><b>${esc(tel)}</b></div>`);
    linhas.push(`<div class="pl"><span>CNPJ</span><b class="hint">a completar</b></div>`);
    if (x.endereco) linhas.push(`<div class="pl"><span>Endereço</span><b>${esc(x.endereco)}</b></div>`);
    if (loc) linhas.push(`<div class="pl"><span>Cidade/UF</span><b>${esc(loc)}</b></div>`);
    const links = [];
    if (x.site) links.push(`<a href="${esc(x.site)}" target="_blank" rel="noopener">Site</a>`);
    if (x.fonte) links.push(`<a href="${esc(x.fonte)}" target="_blank" rel="noopener">Ver no Google Maps</a>`);
    const acao = x.ja_salvo
      ? `<button class="btn" disabled style="background:var(--soft);color:var(--muted)">✓ Já está na base</button>`
      : `<button class="btn primary" id="psave-${i}" onclick="App.salvarProspec(${i})">+ Salvar na base</button>`;
    return `
      <div class="pcard${x.ja_salvo ? " saved" : ""}" id="pcard-${i}">
        <div class="ph">
          <div class="pt">
            <b>${esc(x.nome)}</b>
            ${x.tipo ? `<span class="ptipo">${esc(x.tipo)}</span>` : ""}
          </div>
          ${x.ja_salvo ? `<span class="badge-saved">na base</span>` : ""}
        </div>
        <div class="pkv">${linhas.join("")}</div>
        ${links.length ? `<div class="plinks">${links.join("")}</div>` : ""}
        <div class="pfoot">${acao}</div>
      </div>`;
  }

  async function salvarProspec(i) {
    const cand = PROSPEC[i];
    if (!cand || cand.ja_salvo) return;
    const btn = $("psave-" + i); if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
    const r = await fetch("/api/prospeccao/salvar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidatos: [cand] }),
    });
    const js = await r.json();
    if (!r.ok) { toast(js.erro || "Falha ao salvar."); if (btn) { btn.disabled = false; btn.textContent = "+ Salvar na base"; } return; }
    if (js.criados) {
      cand.ja_salvo = true; cand.empresa_id = js.ids && js.ids[0];
      toast("Empresa salva na base de prospecção.");
    } else {
      cand.ja_salvo = true;
      toast("Essa empresa já estava na base (não duplicada).");
    }
    renderProspecResults();
    recarregar();
  }

  async function salvarTodosProspec() {
    const novos = PROSPEC.filter(x => !x.ja_salvo);
    if (!novos.length) return;
    $("p-saveall").disabled = true;
    const r = await fetch("/api/prospeccao/salvar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidatos: novos }),
    });
    const js = await r.json();
    $("p-saveall").disabled = false;
    if (!r.ok) { toast(js.erro || "Falha ao salvar."); return; }
    novos.forEach(x => { x.ja_salvo = true; });
    toast(`${js.criados} nova(s) salva(s)${js.duplicados ? ` · ${js.duplicados} já existia(m)` : ""}.`);
    renderProspecResults();
    recarregar();
  }

  // ==================== PROSPECÇÃO: mini-mapa dos resultados ====================
  // Plota as lojas encontradas (lat/lng) num scatter geográfico que se ajusta
  // aos pontos. Verde = já na base; azul (accent) = novo. Clique → rola até o card.
  function renderMiniMapa() {
    const wrap = $("p-mapwrap"), svg = $("p-mapa"), vazio = $("p-map-empty");
    if (!wrap || !svg) return;
    if (!PROSPEC.length) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    const pts = PROSPEC
      .map((x, i) => ({ x, i, la: parseFloat(x.lat), ln: parseFloat(x.lng) }))
      .filter(o => isFinite(o.la) && isFinite(o.ln));
    if (!pts.length) { svg.innerHTML = ""; vazio.style.display = ""; return; }
    vazio.style.display = "none";

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    pts.forEach(o => {
      if (o.ln < minLng) minLng = o.ln; if (o.ln > maxLng) maxLng = o.ln;
      if (o.la < minLat) minLat = o.la; if (o.la > maxLat) maxLat = o.la;
    });
    const W = 900, H = 420, pad = 36;
    const meanLat = (minLat + maxLat) / 2;
    const kx = Math.cos(meanLat * Math.PI / 180) || 1;          // corrige aspecto lng↔lat
    const spanLng = Math.max(maxLng - minLng, 0.02), spanLat = Math.max(maxLat - minLat, 0.02);
    const geoW = spanLng * kx, geoH = spanLat;
    const scale = Math.min((W - 2 * pad) / geoW, (H - 2 * pad) / geoH);
    const offX = (W - geoW * scale) / 2, offY = (H - geoH * scale) / 2;
    const proj = (ln, la) => [offX + (ln - minLng) * kx * scale, offY + (maxLat - la) * scale];

    const circles = pts.map(o => {
      const [cx, cy] = proj(o.ln, o.la);
      const fill = o.x.ja_salvo ? "var(--verde)" : "var(--accent)";
      return `<circle class="pmk" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" style="fill:${fill}" data-i="${o.i}"></circle>`;
    }).join("");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<g>${circles}</g>`;
    svg.querySelectorAll("circle.pmk").forEach(cir => {
      cir.addEventListener("mousemove", miniTip);
      cir.addEventListener("mouseleave", hideTip);
      cir.addEventListener("click", () => irParaCard(+cir.dataset.i));
    });
  }

  function miniTip(e) {
    const x = PROSPEC[+e.target.dataset.i]; if (!x) return;
    const loc = [x.cidade, x.uf].filter(Boolean).join(" · ");
    const tag = x.ja_salvo
      ? `<span style="color:var(--verde)">● já na base</span>`
      : `<span style="color:var(--accent)">● novo</span>`;
    showTip(e, `<strong>${esc(x.nome)}</strong>${loc ? `<div class="r"><span>${esc(loc)}</span></div>` : ""}<div class="r">${tag}</div>`);
  }

  function irParaCard(i) {
    const el = $("pcard-" + i);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.boxShadow = "0 0 0 2px var(--accent)";
    setTimeout(() => { el.style.boxShadow = ""; }, 1300);
  }

  // ==================== PROSPECÇÃO: histórico de pesquisas ====================
  function formatarData(s) {
    const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (s || "");
  }

  async function carregarHist() {
    try { HIST = await (await fetch("/api/prospeccao/pesquisas")).json(); }
    catch (e) { HIST = []; }
    if (!Array.isArray(HIST)) HIST = [];
    renderHist();
  }

  function renderHist() {
    const el = $("p-hist"); if (!el) return;
    const filtro = ($("p-hist-uf") && $("p-hist-uf").value) || "";
    const list = filtro ? HIST.filter(h => (h.uf || "").toUpperCase() === filtro) : HIST;
    if (!list.length) {
      el.innerHTML = `<div class="empty">${HIST.length ? "Nenhuma pesquisa nesta região." : "As pesquisas realizadas aparecerão aqui."}</div>`;
      return;
    }
    const grupos = {};
    list.forEach(h => { const u = (h.uf || "").toUpperCase() || "—"; (grupos[u] = grupos[u] || []).push(h); });
    const ordem = [...B.ufs.filter(u => grupos[u]), ...Object.keys(grupos).filter(u => !B.ufs.includes(u))];
    el.innerHTML = ordem.map(u => {
      const items = grupos[u];
      const nome = (B.uf_nomes && B.uf_nomes[u]) || "";
      const titulo = u === "—" ? "Sem estado" : (nome && nome !== u ? `${u} · ${nome}` : u);
      return `<div class="hist-grp"><h4>${esc(titulo)}<span class="c">${items.length}</span></h4>${items.map(histItem).join("")}</div>`;
    }).join("");
  }

  function histItem(h) {
    const titulo = h.termo || h.text_query || "(busca geral)";
    const loc = [h.cidade, h.microrregiao].filter(Boolean).join(" · ");
    const sub = [loc, formatarData(h.atualizado_em)].filter(Boolean).join(" · ");
    return `
      <div class="hist-item">
        <div class="hi-main">
          <div class="hi-q">${h.uf ? `<span class="hi-uf">${esc(h.uf)}</span>` : ""}${esc(titulo)}</div>
          <div class="hi-sub">${esc(sub)}</div>
        </div>
        <div class="hi-stats">
          <span class="hi-pill">${h.total || 0} resultado(s)</span>
          ${h.novos ? `<span class="hi-pill novo">${h.novos} novo(s)</span>` : ""}
        </div>
        <div class="hi-acts">
          <button class="btn" style="background:var(--panel)" onclick="App.abrirPesquisa(${h.id})">Consultar</button>
          <button class="btn" style="background:var(--panel)" onclick="App.repesquisar(${h.id})">Pesquisar de novo</button>
          <button class="btn ghost danger" onclick="App.excluirPesquisa(${h.id})">Excluir</button>
        </div>
      </div>`;
  }

  // Consulta uma pesquisa anterior sem refazer a busca (carrega os resultados salvos).
  async function abrirPesquisa(id) {
    let p;
    try { p = await (await fetch("/api/prospeccao/pesquisas/" + id)).json(); }
    catch (e) { toast("Falha ao carregar a pesquisa."); return; }
    if (!p || p.erro) { toast("Pesquisa não encontrada."); return; }
    PROSPEC = p.resultados || [];
    curPesquisa = id;
    $("p-info").textContent = `Pesquisa salva em ${formatarData(p.atualizado_em)}`;
    renderProspecResults();
    $("p-mapwrap").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Refaz a busca com os mesmos parâmetros (atualiza o registro no histórico).
  async function repesquisar(id) {
    const h = HIST.find(x => x.id === id); if (!h) return;
    $("p-termo").value = h.termo || "";
    $("p-uf").value = h.uf || "";
    await pUfMudou();
    $("p-cidade").value = h.cidade || "";
    $("p-mr").value = h.microrregiao || "";   // opção inexistente vira no-op (select fica em "Todas")
    buscarProspec();
  }

  async function excluirPesquisa(id) {
    if (!confirm("Excluir esta pesquisa do histórico? Os lojistas já salvos na base não são afetados.")) return;
    await fetch("/api/prospeccao/pesquisas/" + id, { method: "DELETE" });
    if (curPesquisa === id) curPesquisa = null;
    toast("Pesquisa excluída do histórico.");
    carregarHist();
  }

  // ==================== DRAWER: ficha / cadastro ====================
  function fieldHTML(f, val) {
    const id = "fld-" + f.k, cls = f.full ? "fld full" : "fld";
    if (f.type === "bool")
      return `<div class="${cls}"><label>${f.l}</label><div class="chk"><input type="checkbox" id="${id}" ${val ? "checked" : ""}><span style="color:var(--muted);font-size:13px">Sim</span></div></div>`;
    if (f.type === "select") {
      const opts = `<option value=""></option>` + (B[f.opts] || []).map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("");
      return `<div class="${cls}"><label class="${f.req ? "req" : ""}">${f.l}</label><select id="${id}">${opts}</select></div>`;
    }
    if (f.type === "textarea")
      return `<div class="fld full"><label>${f.l}</label><textarea id="${id}" rows="3">${esc(val || "")}</textarea></div>`;
    const t = f.type === "num" ? "number" : f.type === "date" ? "date" : "text";
    return `<div class="${cls}"><label class="${f.req ? "req" : ""}">${f.l}</label><input type="${t}" id="${id}" value="${esc(val ?? "")}"></div>`;
  }

  function formHTML(e) {
    return FORM.map(sec => `<div class="sec"><h4>${sec.t}</h4><div class="grid2">${sec.f.map(f => fieldHTML(f, e ? e[f.k] : "")).join("")}</div></div>`).join("");
  }

  function kv(label, val) { return val ? `<dt>${esc(label)}</dt><dd>${esc(val)}</dd>` : ""; }

  // Pílula colorida da faixa de potencial (cor por faixa; cinza quando sem classificação).
  function faixaPill(faixa) {
    const hex = (B && B.faixa_hex && B.faixa_hex[faixa]) || "#9aa0ac";
    const txt = faixa || "Potencial não classificado";
    return `<span class="pill-faixa" style="--pc:${hex}"><span class="d" style="background:${hex}"></span>${esc(txt)}</span>`;
  }

  function viewHTML(e) {
    const chips = [];
    if (e.trabalha_telecom) chips.push("Telecom/tecnologia");
    if (e.ja_starlink) chips.push("Já vende Starlink");
    if (e.exp_antenas) chips.push("Experiência c/ antenas");
    if (e.equipe_tecnica) chips.push("Equipe técnica");
    if (e.loja_fisica) chips.push("Loja física");
    const contatos = (e.contatos || []).map(c => `
      <div class="tl"><div class="m">${esc(c.data || "")} · ${esc(c.tipo || "")}${c.responsavel ? " · " + esc(c.responsavel) : ""}
        <button class="lnk danger" style="float:right" onclick="App.delContato(${c.id})">excluir</button></div>
      <div class="x">${esc(c.resumo || "")}</div>
      ${c.proxima_acao ? `<div class="m">→ ${esc(c.proxima_acao)} ${c.proxima_acao_data ? "(" + esc(c.proxima_acao_data) + ")" : ""}</div>` : ""}</div>`).join("");
    const filiais = (e.filiais || []).map(f => `
      <div class="filial"><span>${esc(f.nome || "Filial")} ${f.cidade ? "· " + esc(f.cidade) : ""} ${f.uf ? esc(f.uf) : ""}</span>
        <button class="lnk danger" onclick="App.delFilial(${f.id})">excluir</button></div>`).join("");
    return `
      <div class="statuspick" id="statuspick">${B.status.map(s =>
        `<button class="${s === e.status ? "on" : ""}" style="${s === e.status ? "color:" + hexCor(corStatus(s)) : ""}" onclick="App.setStatus('${esc(s)}')"><span class="d" style="background:${hexCor(corStatus(s))}"></span>${esc(s)}</button>`).join("")}</div>

      <div class="classbar">
        ${faixaPill(e.faixa_potencial)}
        <span class="pill-venda ${e.ja_vendeu ? "sim" : "nao"}">${e.ja_vendeu ? "✓ Já fez venda" : "Ainda não vendeu"}</span>
      </div>

      <div class="sec" style="margin-top:16px"><h4>Contato</h4>
        <dl class="kv">
          ${kv("CNPJ", e.cnpj)}${kv("Telefone", e.telefone_comercial)}${kv("WhatsApp", e.whatsapp)}
          ${kv("E-mail", e.email_comercial)}${kv("Site/Insta", e.site_instagram)}
          ${kv("Endereço", e.endereco)}${kv("Cidade", (e.cidade || "") + (e.uf ? " · " + e.uf : ""))}${kv("Microrregião", e.microrregiao)}
        </dl></div>

      <div class="sec"><h4>Responsável</h4><dl class="kv">
        ${kv("Nome", e.resp_nome)}${kv("Cargo", e.resp_cargo)}${kv("Telefone", e.resp_telefone)}${kv("E-mail", e.resp_email)}
      </dl></div>

      <div class="sec"><h4>Perfil comercial</h4>
        ${chips.length ? `<div class="chips">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
        <dl class="kv" style="margin-top:8px">
          ${kv("Segmento", e.segmento)}${kv("Produtos", e.produtos)}${kv("Interesse", e.interesse_parceiro)}
          ${kv("Potencial", e.faixa_potencial)}${kv("Já fez venda?", e.ja_vendeu ? "Sim" : "Não")}
          ${kv("Capacidade/mês", e.capacidade_vendas_mes)}${kv("Filiais", e.qtd_filiais)}${kv("Origem", e.origem_contato)}
          ${kv("Canal", e.canal)}${kv("Responsável interno", e.responsavel)}${kv("Prioridade", e.prioridade)}
          ${kv("Status Vivensis", e.status_vivensis)}
        </dl></div>

      ${e.observacoes ? `<div class="sec"><h4>Observações</h4><div>${esc(e.observacoes)}</div></div>` : ""}

      <div class="sec"><h4>Filiais / unidades</h4>
        ${filiais || '<span class="hint">Nenhuma filial cadastrada.</span>'}
        <div class="grid2" style="margin-top:10px">
          <div class="fld"><input id="fil-nome" placeholder="Nome/identificação"></div>
          <div class="fld"><input id="fil-cidade" placeholder="Cidade"></div>
          <div class="fld"><input id="fil-uf" placeholder="UF" maxlength="2"></div>
          <div class="fld"><input id="fil-tel" placeholder="Telefone"></div>
        </div>
        <button class="btn" style="margin-top:8px;background:var(--soft);color:var(--brand)" onclick="App.addFilial()">+ Adicionar filial</button>
      </div>

      <div class="sec"><h4>Histórico de contatos</h4>
        <div class="timeline">${contatos || '<span class="hint">Sem registros ainda.</span>'}</div>
        <div class="grid2" style="margin-top:12px">
          <div class="fld"><label>Tipo</label><select id="ct-tipo">${selOpts(B.tipos_contato, "")}</select></div>
          <div class="fld"><label>Data</label><input type="date" id="ct-data"></div>
          <div class="fld"><label>Responsável</label><select id="ct-resp">${selOpts(B.responsaveis, "")}</select></div>
          <div class="fld"><label>Próxima ação (data)</label><input type="date" id="ct-pad"></div>
          <div class="fld full"><label>Resumo</label><input id="ct-resumo" placeholder="O que aconteceu neste contato"></div>
          <div class="fld full"><label>Próxima ação</label><input id="ct-pa" placeholder="O que fazer a seguir"></div>
        </div>
        <button class="btn" style="margin-top:8px;background:var(--soft);color:var(--brand)" onclick="App.addContato()">+ Registrar contato</button>
      </div>`;
  }

  function renderDrawer() {
    const e = cur;
    const nova = !e || !e.id;
    const nome = nova ? "Novo lojista" : (e.nome_fantasia || e.razao_social || "Empresa");
    const sub = nova ? "Preencha os dados e salve" :
      `${esc(e.codigo || "")}${e.cidade ? " · " + esc(e.cidade) : ""}${e.uf ? " · " + e.uf : ""}`;
    const corpo = (editMode || nova) ? formHTML(e) : viewHTML(e);
    const footer = (editMode || nova)
      ? `<button class="btn primary" onclick="App.salvar()">Salvar</button>
         ${nova ? "" : `<button class="btn" style="background:var(--soft);color:var(--brand)" onclick="App.verFicha()">Cancelar</button>`}
         ${nova ? "" : `<button class="btn ghost danger" style="margin-left:auto" onclick="App.excluir()">Excluir</button>`}`
      : `<button class="btn primary" onclick="App.editarFicha()">Editar dados</button>
         <button class="btn ghost danger" style="margin-left:auto" onclick="App.excluir()">Excluir</button>`;
    $("drawer").innerHTML = `
      <div class="dh">
        <div class="tt"><h3>${esc(nome)}</h3><div class="sub">${sub}</div></div>
        ${!nova ? `<span class="badge"><span class="d" style="background:${e.cor_hex}"></span>${esc(e.status || "")}</span>` : ""}
        <button class="btn" style="background:var(--soft);color:var(--brand)" onclick="App.fecharDrawer()">✕</button>
      </div>
      <div class="db">${corpo}</div>
      <div class="df">${footer}</div>`;
    $("overlay").classList.add("on");
    $("drawer").classList.add("on");
  }

  async function abrirFicha(id) {
    cur = await (await fetch("/api/empresas/" + id)).json();
    editMode = false;
    renderDrawer();
  }
  function novaEmpresa() { cur = {}; editMode = true; renderDrawer(); }
  function editarFicha() { editMode = true; renderDrawer(); }
  function verFicha() { editMode = false; renderDrawer(); }
  function fecharDrawer() { $("overlay").classList.remove("on"); $("drawer").classList.remove("on"); cur = null; }

  function coletar() {
    const o = {};
    FORM.forEach(sec => sec.f.forEach(f => {
      const el = $("fld-" + f.k); if (!el) return;
      o[f.k] = f.type === "bool" ? el.checked : el.value;
    }));
    return o;
  }

  async function salvar() {
    const dados = coletar();
    if (!dados.razao_social && !dados.nome_fantasia) { toast("Informe a razão social ou o nome fantasia."); return; }
    const nova = !cur || !cur.id;
    const url = nova ? "/api/empresas" : "/api/empresas/" + cur.id;
    const r = await fetch(url, { method: nova ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
    const js = await r.json();
    if (!r.ok) { toast(js.erro || "Erro ao salvar."); return; }
    toast(nova ? "Empresa cadastrada." : "Alterações salvas.");
    const id = nova ? js.id : cur.id;
    await recarregar();
    await abrirFicha(id);
  }

  async function setStatus(s) {
    const r = await fetch("/api/empresas/" + cur.id + "/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s }) });
    if (!r.ok) { toast("Status inválido."); return; }
    toast("Status atualizado.");
    await recarregar();
    await abrirFicha(cur.id);
  }

  async function addContato() {
    const body = {
      tipo: $("ct-tipo").value, data: $("ct-data").value, responsavel: $("ct-resp").value,
      resumo: $("ct-resumo").value, proxima_acao: $("ct-pa").value, proxima_acao_data: $("ct-pad").value,
    };
    if (!body.resumo && !body.tipo) { toast("Descreva o contato."); return; }
    await fetch("/api/empresas/" + cur.id + "/contatos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    toast("Contato registrado.");
    await abrirFicha(cur.id);
  }
  async function delContato(id) {
    await fetch("/api/contatos/" + id, { method: "DELETE" });
    await abrirFicha(cur.id);
  }

  async function addFilial() {
    const body = { nome: $("fil-nome").value, cidade: $("fil-cidade").value, uf: $("fil-uf").value, telefone: $("fil-tel").value };
    if (!body.nome && !body.cidade) { toast("Informe ao menos o nome ou a cidade da filial."); return; }
    await fetch("/api/empresas/" + cur.id + "/filiais", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    toast("Filial adicionada.");
    await recarregar();
    await abrirFicha(cur.id);
  }
  async function delFilial(id) {
    await fetch("/api/filiais/" + id, { method: "DELETE" });
    await recarregar();
    await abrirFicha(cur.id);
  }

  async function excluir() {
    if (!confirm("Excluir esta empresa e todo o histórico? Esta ação não pode ser desfeita.")) return;
    await fetch("/api/empresas/" + cur.id, { method: "DELETE" });
    toast("Empresa excluída.");
    fecharDrawer();
    recarregar();
  }

  // ==================== Import / export ====================
  function exportar() { location.href = "/api/export.xlsx?" + qs(); }
  function modelo() { location.href = "/api/modelo.xlsx"; }
  function abrirImport() { $("fileimport").click(); }
  async function fazerImport(input) {
    if (!input.files.length) return;
    const fd = new FormData(); fd.append("arquivo", input.files[0]);
    toast("Importando…");
    const r = await fetch("/api/import", { method: "POST", body: fd });
    const js = await r.json();
    input.value = "";
    if (!r.ok) { toast(js.erro || "Falha na importação."); return; }
    toast(`Importação: ${js.criados} nova(s), ${js.atualizados} atualizada(s).`);
    recarregar();
  }

  // ==================== util ====================
  function limparFiltros() {
    ["f-uf", "f-mr", "f-seg", "f-status", "f-faixa", "f-vendeu", "f-resp", "f-canal"].forEach(id => $(id).value = "");
    ["f-cred", "f-pot", "f-tel"].forEach(id => $(id).checked = false);
    $("busca").value = ""; sel = null;
    $("map-ctx").textContent = "Concentração de empresas por microrregião · marcadores = empresas por status";
    recarregar();
  }
  function buscaDebounced() { clearTimeout(buscaTimer); buscaTimer = setTimeout(recarregar, 280); }
  function tema() {
    const atual = document.documentElement.getAttribute("data-theme");
    const novo = atual === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", novo);
    localStorage.setItem("tema", novo);
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
  }

  return {
    init, view, ufMudou, limparFiltros, buscaDebounced, tema,
    abrirFicha, novaEmpresa, editarFicha, verFicha, fecharDrawer, salvar, setStatus,
    addContato, delContato, addFilial, delFilial, excluir, realce,
    exportar, modelo, abrirImport, fazerImport,
    pUfMudou, sugProspec, buscarProspec, salvarProspec, salvarTodosProspec,
    varreduraAgora,
    renderHist, abrirPesquisa, repesquisar, excluirPesquisa,
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
