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
  let PEND = [];           // pendentes da varredura automática (aguardando revisão)
  let FU = null;           // dados do follow-up carregados (/api/follow-up)
  let fuUF = "";           // filtro de estado aplicado no follow-up ("" = todos)

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hexCor = (cor) => (B && B.cor_hex[cor]) || "#9aa0ac";
  const corStatus = (st) => (B && B.status_cor[st]) || "cinza";
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  // Formata "2026-11-16 06:01:02" (ou ISO) para "16/11/2026 06:01". Sem hora, só a data.
  const fmtData = (s) => {
    if (!s) return "";
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return String(s);
    return `${m[3]}/${m[2]}/${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : "");
  };

  // -------- Flags informativas (tooltips de ajuda) --------
  // Ícone ⓘ reutilizável: use infoIco("explicação") ou infoIco("explicação","Título").
  // O texto fica em data-tip; o Tip (abaixo) renderiza a caixa flutuante por delegação,
  // então funciona também em conteúdo gerado dinamicamente (ficha, dashboard, etc.).
  const infoIco = (tip, title) =>
    `<span class="info" tabindex="0" role="button" aria-label="${esc(title ? title + ": " + tip : "Ajuda: " + tip)}"` +
    ` data-tip="${esc(tip)}"${title ? ` data-tip-title="${esc(title)}"` : ""}></span>`;

  // Controlador único da caixa de ajuda: hover/foco (desktop) e toque (mobile).
  const Tip = (() => {
    let box = null, cur = null, pinned = false;
    const ensure = () => {
      if (box) return box;
      box = document.createElement("div");
      box.className = "htip hidden";
      box.setAttribute("role", "tooltip");
      document.body.appendChild(box);
      return box;
    };
    const show = (el) => {
      if (!el) return;
      const b = ensure();
      const title = el.getAttribute("data-tip-title");
      const body = el.getAttribute("data-tip") || "";
      b.innerHTML = (title ? `<strong>${esc(title)}</strong>` : "") + `<span>${esc(body)}</span>`;
      b.classList.remove("hidden");
      place(el, b);
      cur = el;
    };
    // Posiciona abaixo do elemento; vira para cima se não couber, e nunca ultrapassa as bordas.
    const place = (el, b) => {
      const r = el.getBoundingClientRect();
      const bw = b.offsetWidth, bh = b.offsetHeight, gap = 9, m = 8;
      let above = false, top = r.bottom + gap;
      if (top + bh > innerHeight - m && r.top - gap - bh > m) { top = r.top - gap - bh; above = true; }
      let left = r.left + r.width / 2 - bw / 2;
      left = Math.max(m, Math.min(left, innerWidth - bw - m));
      b.style.left = left + "px";
      b.style.top = top + "px";
      b.classList.toggle("above", above);
      const ax = r.left + r.width / 2 - left;           // posição da seta relativa à caixa
      b.style.setProperty("--ax", Math.max(12, Math.min(ax, bw - 12)) + "px");
    };
    const hide = () => { if (box) box.classList.add("hidden"); cur = null; pinned = false; };
    const init = () => {
      document.addEventListener("pointerover", (e) => {
        if (e.pointerType === "touch") return;
        const el = e.target.closest("[data-tip]");
        if (el && el !== cur) show(el);
      });
      document.addEventListener("pointerout", (e) => {
        if (e.pointerType === "touch" || pinned) return;
        const el = e.target.closest("[data-tip]");
        if (el && el === cur && !el.contains(e.relatedTarget)) hide();
      });
      document.addEventListener("focusin", (e) => {
        const el = e.target.closest && e.target.closest("[data-tip]");
        if (el) show(el);
      });
      document.addEventListener("focusout", (e) => {
        const el = e.target.closest && e.target.closest("[data-tip]");
        if (el && el === cur) hide();
      });
      // Toque/clique no ícone ⓘ: alterna a explicação (não dispara o clique do elemento-pai).
      document.addEventListener("click", (e) => {
        const ico = e.target.closest(".info[data-tip]");
        if (ico) {
          e.preventDefault(); e.stopPropagation();
          if (cur === ico && pinned) hide();
          else { show(ico); pinned = true; }
          return;
        }
        if (pinned) hide();
      }, true);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
      window.addEventListener("scroll", hide, true);
      window.addEventListener("resize", hide);
    };
    return { init, hide };
  })();

  let MUNI_NORMS = []; // municípios conhecidos (normalizados), do mais longo p/ o mais curto

  // Campo de cidade com mais de um município vira "<1ª cidade> e região". Reconhece
  // separadores explícitos (vírgula, "/", ";", " e ") e também listas coladas por
  // espaço (ex.: "Imperatriz Açailândia São Francisco…"), achando a 1ª cidade conhecida.
  const cidadeCurta = (cidade) => {
    const raw = String(cidade ?? "").trim();
    if (!raw) return "";
    const partes = raw.split(/\s*[,;/]\s*|\s+e\s+/i).map(s => s.trim()).filter(Boolean);
    if (partes.length > 1) return `${partes[0]} e região`;
    // Lista de municípios separada por espaço: casa a 1ª cidade conhecida (prefixo).
    const nraw = norm(raw);
    if (MUNI_NORMS.length && nraw.includes(" ")) {
      for (const m of MUNI_NORMS) {           // ordenado do mais longo p/ o mais curto
        if (nraw === m) break;                // é exatamente uma cidade conhecida
        if (nraw.startsWith(m + " ")) {       // começa com cidade conhecida e há mais → colapsa
          const nw = m.split(" ").length;
          return raw.split(/\s+/).slice(0, nw).join(" ") + " e região";
        }
      }
    }
    return raw;
  };

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
      { k: "microrregiao", l: "Microrregião (automática)", tip: "Preenchida automaticamente a partir da cidade e UF. Não precisa editar." },
      { k: "latitude", l: "Latitude", type: "num", tip: "Coordenada usada para posicionar a empresa no mapa. Costuma vir preenchida pela busca; deixe em branco se não souber." },
      { k: "longitude", l: "Longitude", type: "num", tip: "Coordenada usada para posicionar a empresa no mapa. Costuma vir preenchida pela busca; deixe em branco se não souber." },
    ]},
    { t: "Responsável na empresa", f: [
      { k: "resp_nome", l: "Nome", full: 1 },
      { k: "resp_cargo", l: "Cargo" }, { k: "resp_telefone", l: "Telefone direto" },
      { k: "resp_whatsapp", l: "WhatsApp" }, { k: "resp_email", l: "E-mail" },
    ]},
    { t: "Informações comerciais", f: [
      { k: "segmento", l: "Segmento", type: "select", opts: "segmentos", full: 1, tip: "Ramo de atividade da empresa. Ajuda a avaliar aderência à Starlink e a filtrar a base." },
      { k: "produtos", l: "Principais produtos", full: 1 },
      { k: "trabalha_telecom", l: "Trabalha com telecom/tecnologia?", type: "bool", tip: "Marque se a empresa já atua com internet, telecom ou tecnologia — perfil mais aderente para revender Starlink." },
      { k: "ja_starlink", l: "Já comercializa Starlink?", type: "bool", tip: "Marque se a empresa já revende Starlink hoje (por outro distribuidor ou canal)." },
      { k: "exp_antenas", l: "Experiência com antenas?", type: "bool", tip: "Marque se já tem experiência instalando antenas (parabólica, rádio, satélite)." },
      { k: "equipe_tecnica", l: "Possui equipe técnica?", type: "bool", tip: "Marque se a empresa tem equipe própria para instalação e suporte técnico." },
      { k: "loja_fisica", l: "Possui loja física?", type: "bool", tip: "Marque se a empresa tem ponto de venda físico aberto ao público." },
      { k: "qtd_filiais", l: "Qtd. filiais", type: "num" },
      { k: "capacidade_vendas_mes", l: "Capacidade de vendas/mês", tip: "Estimativa de quantas antenas a empresa conseguiria vender por mês. Base para classificar o potencial." },
      { k: "interesse_parceiro", l: "Interesse em ser parceiro", type: "select", opts: "interesse", tip: "Nível de interesse que a empresa demonstrou em se tornar parceira Starlink." },
      { k: "origem_contato", l: "Origem do contato", type: "select", opts: "origens", tip: "Como esta empresa entrou na base (ex.: varredura automática, indicação, cadastro manual)." },
    ]},
    { t: "Classificação e gestão", f: [
      { k: "faixa_potencial", l: "Potencial (vendas/mês)", type: "select", opts: "faixas_potencial", tip: "Classifica a empresa por volume estimado de vendas/mês. A ficha pode sugerir uma faixa automaticamente." },
      { k: "ja_vendeu", l: "Já fez venda?", type: "bool", tip: "Marque quando a empresa fechar a primeira venda de antena." },
      { k: "status", l: "Status comercial", type: "select", opts: "status", tip: "Etapa atual no funil (prospectado → negociação → credenciado etc.). Define a cor no mapa e na lista." },
      { k: "status_vivensis", l: "Status Vivensis", type: "select", opts: "status_vivensis", tip: "Situação da revenda no portal Vivensis/VSM (credenciamento junto ao distribuidor)." },
      { k: "canal", l: "Canal", type: "select", opts: "canais", tip: "Por onde a empresa opera ou compra (ex.: Vivensis/VSM, venda direta, indicação)." },
      { k: "responsavel", l: "Responsável interno", type: "select", opts: "responsaveis", tip: "Pessoa da equipe interna encarregada de acompanhar esta empresa." },
      { k: "prioridade", l: "Prioridade", type: "select", opts: "prioridades", tip: "Define a urgência de atenção (alta/média/baixa). Aparece como etiqueta no Follow-up." },
      { k: "motivo_perda", l: "Motivo de perda", type: "select", opts: "motivos_perda", tip: "Se o lead foi perdido, registre o porquê — ajuda a entender objeções e melhorar a abordagem." },
      { k: "proxima_acao", l: "Próxima ação", full: 1, tip: "O próximo passo combinado com a empresa. Aparece no Follow-up para você não esquecer." },
      { k: "proxima_acao_data", l: "Data da próxima ação", type: "date", tip: "Quando fazer a próxima ação. Define quando ela aparece no Follow-up (hoje, próximos dias ou vencida)." },
      { k: "data_ultimo_contato", l: "Data do último contato", type: "date", tip: "Data do contato mais recente. Sem contato há 14+ dias, a empresa entra em 'Parados' no Follow-up." },
      { k: "observacoes", l: "Observações", type: "textarea", full: 1 },
    ]},
  ];

  // ==================== INIT ====================
  async function init() {
    const t = localStorage.getItem("tema");
    if (t) document.documentElement.setAttribute("data-theme", t);
    Tip.init();
    B = await (await fetch("/api/bootstrap")).json();
    try { OUTLINES = await (await fetch("/static/state-outlines.json")).json(); } catch (e) { OUTLINES = {}; }
    montarFiltros();
    await carregarMunicipios();
    await recarregar();
    window.addEventListener("scroll", hideTip, true);
    // Badge de pendências de follow-up (vencidas + hoje) na aba, sem abrir a aba.
    fetch("/api/follow-up").then(r => r.json()).then(atualizarBadgeFollowUp).catch(() => {});
  }

  // Carrega os municípios das UFs de atuação (p/ reconhecer a 1ª cidade em campos
  // com vários municípios). Guarda normalizado e ordenado do mais longo p/ o mais curto.
  async function carregarMunicipios() {
    try {
      const listas = await Promise.all(
        B.ufs.map(u => fetch("/api/municipios?uf=" + encodeURIComponent(u)).then(r => r.json()))
      );
      const set = new Set();
      listas.forEach(l => (l || []).forEach(m => { const n = norm(m.municipio); if (n) set.add(n); }));
      MUNI_NORMS = [...set].sort((a, b) => b.length - a.length);
    } catch (e) { MUNI_NORMS = []; }
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
      .map(c => `<span><i style="background:${hexCor(c)}"></i>${esc(B.cor_label[c])}</span>`).join("") +
      infoIco("Cor de cada ponto no mapa = status comercial da empresa. Use os filtros à esquerda para isolar um status.", "Legenda de status");
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
    renderKPIs(); renderMapa(); renderLista();
    if (!$("view-painel").classList.contains("hidden")) renderPainel();
  }

  // ==================== KPIs ====================
  function renderKPIs() {
    const d = DASH;
    const cards = [
      { v: d.total, l: "Empresas mapeadas", c: "var(--accent)", tip: "Total de empresas cadastradas na base (visão geral, sem considerar os filtros do mapa)." },
      { v: d.potenciais, l: "Potenciais", c: hexCor("azul"), tip: "Leads com potencial que ainda não foram credenciados." },
      { v: d.em_negociacao, l: "Em negociação", c: hexCor("amarelo"), tip: "Empresas em conversa ativa para fechar o credenciamento." },
      { v: d.credenciados, l: "Credenciados", c: hexCor("verde"), tip: "Revendas já homologadas como parceiras Starlink." },
      { v: d.municipios, l: "Municípios alcançados", c: "var(--muted)", tip: "Quantidade de municípios distintos com ao menos uma empresa mapeada." },
      { v: d.taxa_conversao + "%", l: "Conversão → credenciado", c: hexCor("verde"), tip: "Percentual da base que já virou credenciado (credenciados ÷ total de empresas)." },
    ];
    $("kpibar").innerHTML = cards.map(k =>
      `<div class="kpi"><div class="v" style="color:${k.c}">${k.v}</div><div class="l"><span class="dot" style="background:${k.c}"></span>${k.l}${k.tip ? infoIco(k.tip, k.l) : ""}</div></div>`
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
      const local = [cidadeCurta(e.cidade), e.uf].filter(Boolean).join(" · ") || "—";
      const tel = e.whatsapp || e.telefone_comercial || "";
      const seg = e.segmento || "—";
      const resp = e.responsavel || "—";
      return `
      <tr onclick="App.abrirFicha(${e.id})" onmouseenter="App.realce(${e.id},1)" onmouseleave="App.realce(${e.id},0)">
        <td class="c-nome">${esc(e.nome_fantasia || e.razao_social)} ${venda}</td>
        <td class="c-loc" title="${esc(e.cidade || "")}">${esc(local)}</td>
        <td class="c-seg">${esc(seg)}</td>
        <td><span class="pill-faixa sm" style="--pc:${fxHex}"><span class="d" style="background:${fxHex}"></span>${esc(fxCurta)}</span></td>
        <td><span class="badge"><span class="d" style="background:${e.cor_hex}"></span>${esc(e.status || "")}</span></td>
        <td class="c-tel">${tel ? esc(tel) : '<span class="hint">—</span>'}</td>
        <td class="c-resp">${esc(resp)}</td>
        <td class="sp"></td>
      </tr>`;
    }).join("");
    $("lista").innerHTML = `<table class="tbl-emp"><thead><tr><th>Empresa</th><th>Cidade/UF</th><th>Segmento</th><th>Potencial</th><th>Status</th><th>Contato</th><th>Responsável</th><th class="sp"></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function realce(id, on) {
    const c = $("mapa").querySelector(`circle.mk[data-id="${id}"]`);
    if (c) c.classList.toggle("hot", !!on);
  }

  // ==================== PAINEL (dashboard) ====================
  function chart(dados, corFn) {
    const max = Math.max(1, ...dados.map(d => d[1]));
    return `<div class="chart">` + dados.map(([lbl, v]) =>
      `<div class="row"><span class="lbl" title="${esc(lbl)}">${esc(lbl)}</span>
        <span class="track"><span class="fill" style="width:${Math.round(v / max * 100)}%;background:${corFn(lbl)}"></span></span>
        <span class="val">${v}</span></div>`).join("") + `</div>`;
  }

  // Cobertura VSM: barra por estado com mapeadas / universo (revendas no portal Vivensis).
  function chartCobertura(cob) {
    if (!cob || !cob.length) return '<div class="empty">Sem universo VSM configurado.</div>';
    const corPct = p => p >= 80 ? hexCor("verde") : p >= 40 ? hexCor("amarelo") : hexCor("laranja");
    return `<div class="chart">` + cob.map(c => {
      const nome = (B.uf_nomes && B.uf_nomes[c.uf]) || c.uf;
      return `<div class="row"><span class="lbl" title="${esc(nome)}">${esc(c.uf)}</span>
        <span class="track"><span class="fill" style="width:${Math.min(100, c.pct)}%;background:${corPct(c.pct)}"></span></span>
        <span class="val" title="${c.mapeadas} de ${c.universo} revendas do VSM mapeadas">${c.mapeadas}/${c.universo} · ${c.pct}%</span></div>`;
    }).join("") + `</div>`;
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
      <div class="card"><div class="hd"><h2>Por status comercial${infoIco("Distribuição das empresas por etapa do funil comercial.", "Por status comercial")}</h2></div><div class="bd">${statusData.length ? chart(statusData, l => hexCor(corStatus(l))) : '<div class="empty">Sem dados.</div>'}</div></div>
      <div class="card"><div class="hd"><h2>Distribuição por estado</h2></div><div class="bd">${chart(ufData, () => "var(--accent)")}</div></div>
      <div class="card wide"><div class="hd"><h2>Cobertura VSM por estado${infoIco("Quanto do universo de revendas do portal Vivensis/VSM já está mapeado na base, por estado. Barra = mapeadas ÷ universo conhecido.", "Cobertura VSM")}</h2></div><div class="bd">
        ${chartCobertura(d.cobertura_vsm)}
        <div class="l" style="opacity:.7;margin-top:8px">${d.total} de ${d.universo_vsm_total || 0} revendas do VSM mapeadas no total.</div>
      </div></div>
      <div class="card wide"><div class="hd"><h2>Por potencial de vendas/mês${infoIco("Quantas empresas há em cada faixa de potencial de venda. 'Sem classificação' = ainda sem faixa definida.", "Por potencial")}</h2></div><div class="bd">${faixaData.some(x => x[1] > 0) ? chart(faixaData, l => (B.faixa_hex && B.faixa_hex[l]) || "var(--muted)") : '<div class="empty">Nenhuma empresa classificada por potencial ainda.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Por segmento</h2></div><div class="bd">${segData.length ? chart(segData, () => "var(--brand2)") : '<div class="empty">Sem segmentos informados.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Funil de conversão${infoIco("Do total prospectado até os credenciados, passando pelas empresas em andamento. A taxa mostra quantos % da base chegaram a credenciado.", "Funil de conversão")}</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="stat"><div class="v">${d.total}</div><div class="l">Prospectados (base)</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("amarelo")}">${d.em_negociacao + d.aguardando}</div><div class="l">Em andamento</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("verde")}">${d.credenciados}</div><div class="l">Credenciados (${d.taxa_conversao}%)</div></div>
        </div>
      </div></div>
      <div class="card wide"><div class="hd"><h2>Evolução mensal${infoIco("Novas empresas (leads) adicionadas e credenciamentos fechados a cada mês.", "Evolução mensal")}</h2></div><div class="bd">${chartMensal(d.serie_mensal)}</div></div>
      <div class="card wide"><div class="hd"><h2>Tempo médio no funil${infoIco("Dias médios entre as etapas: do lead ao 1º contato, do lead ao credenciamento e do credenciamento à 1ª venda.", "Tempo médio no funil")}</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          ${tempoStat("Lead → 1º contato", tf.lead_contato)}
          ${tempoStat("Lead → credenciamento", tf.lead_cred)}
          ${tempoStat("Credenciado → 1ª venda", tf.cred_venda)}
        </div>
      </div></div>`;
  }

  function view(v) {
    const views = { mapa: "view-mapa", painel: "view-painel", followup: "view-followup", prospec: "view-prospec" };
    Object.entries(views).forEach(([k, id]) => $(id).classList.toggle("hidden", k !== v));
    ["mapa", "painel", "followup", "prospec"].forEach(k => $("tab-" + k).classList.toggle("on", k === v));
    if (v === "painel") renderPainel();
    if (v === "followup") carregarFollowUp();
    if (v === "prospec") initProspec();
  }

  // ==================== FOLLOW-UP / MONITORAR ====================
  async function carregarFollowUp() {
    const box = $("fu-body");
    box.innerHTML = `<div class="empty">Carregando follow-up…</div>`;
    let d;
    try { d = await (await fetch("/api/follow-up")).json(); }
    catch (e) { box.innerHTML = `<div class="empty">Não foi possível carregar o follow-up.</div>`; return; }
    FU = d;
    atualizarBadgeFollowUp(d);
    renderFollowUp();
  }

  const FU_GRUPOS = [
    { k: "vencidas", tit: "Vencidas", cls: "fu-venc", desc: "ação com data no passado" },
    { k: "hoje_list", tit: "Para hoje", cls: "fu-hoje", desc: "ação marcada para hoje" },
    { k: "proximas", tit: "Próximos 7 dias", cls: "fu-prox", desc: "ação agendada em breve" },
    { k: "parados", tit: "Parados", sub: "sem contato há 14+ dias", cls: "fu-parado", desc: "sem próxima ação marcada" },
  ];

  function fuFiltrarUF(v) { fuUF = v || ""; renderFollowUp(); }

  function renderFollowUp() {
    const box = $("fu-body");
    const d = FU;
    if (!d) return;
    if (!d.total) {
      box.innerHTML = `<div class="empty">Tudo em dia 🎉 — nenhuma ação vencida ou pendente. Marque a "próxima ação" dos prospects na ficha para acompanhá-los aqui.</div>`;
      return;
    }
    // Estados presentes no follow-up (para o filtro)
    const ufs = [...new Set(FU_GRUPOS.flatMap(g => d[g.k] || []).map(x => x.uf).filter(Boolean))].sort();
    const filtro = `
      <div class="fu-toolbar">
        <label class="fu-filtro">Estado
          <select id="fu-uf" onchange="App.fuFiltrarUF(this.value)">
            <option value="">Todos</option>
            ${ufs.map(u => `<option value="${esc(u)}"${u === fuUF ? " selected" : ""}>${esc(u)}</option>`).join("")}
          </select>
        </label>
      </div>`;
    const corpo = FU_GRUPOS.map(g => {
      let lista = d[g.k] || [];
      if (fuUF) lista = lista.filter(x => (x.uf || "") === fuUF);
      if (!lista.length) return "";
      return `
        <div class="fu-grupo ${g.cls}">
          <div class="fu-grupo-hd">
            <div class="fu-grupo-top"><h3>${g.tit}</h3><span class="fu-count">${lista.length}</span><span class="hint">${g.desc}</span></div>
            ${g.sub ? `<div class="fu-grupo-sub">${g.sub}</div>` : ""}
          </div>
          <div class="fu-rows">${lista.map(fuRow).join("")}</div>
        </div>`;
    }).join("");
    box.innerHTML = filtro + (corpo || `<div class="empty">Nenhum prospect ${fuUF ? "em " + esc(fuUF) : "encontrado"}.</div>`);
  }

  function atualizarBadgeFollowUp(d) {
    const el = $("tab-followup-badge");
    if (!el) return;
    const urgentes = (d.contagem && (d.contagem.vencidas + d.contagem.hoje)) || 0;
    if (urgentes > 0) { el.textContent = urgentes; el.hidden = false; }
    else { el.hidden = true; }
  }

  function fuRow(x) {
    const loc = [cidadeCurta(x.cidade), x.uf].filter(Boolean).join(" · ");
    const tel = x.whatsapp || x.telefone || "";
    const bits = [];
    if (x.dias_atraso != null) bits.push(`<span class="fu-tag atraso">${x.dias_atraso}d em atraso</span>`);
    else if (x.dias_para != null) bits.push(`<span class="fu-tag">em ${x.dias_para}d</span>`);
    else if (x.dias_sem_contato != null) bits.push(`<span class="fu-tag frio">${x.dias_sem_contato}d sem contato</span>`);
    else if (x.dias_sem_contato === null) bits.push(`<span class="fu-tag frio">nunca contatado</span>`);
    if (x.prioridade) bits.push(`<span class="fu-tag pri-${esc((x.prioridade||'').toLowerCase())}">${esc(x.prioridade)}</span>`);
    if (x.faixa_potencial) bits.push(`<span class="fu-tag">${esc(x.faixa_potencial)}</span>`);
    const acao = x.proxima_acao ? `<div class="fu-acao">▸ ${esc(x.proxima_acao)}</div>` : "";
    return `
      <div class="fu-row" onclick="App.abrirFicha(${x.id})">
        <div class="fu-main">
          <b>${esc(x.nome)}</b>
          <span class="fu-meta">${esc(loc)}${x.status ? " · " + esc(x.status) : ""}${x.responsavel ? " · " + esc(x.responsavel) : ""}</span>
          ${acao}
        </div>
        <div class="fu-side">
          ${bits.join("")}
          ${tel ? `<span class="fu-tel">${esc(tel)}</span>` : ""}
        </div>
      </div>`;
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
    carregarPendentes();
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
      partes.push(`última: ${esc(fmtData(s.ultima))}`);
      if (typeof st.pendentes === "number") partes.push(`${st.pendentes} pendente(s) p/ revisar, ${st.ja_na_base || 0} já na base`);
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
      toast(`Varredura: ${js.pendentes} novo(s) pendente(s) para revisar${js.ja_na_base ? ` · ${js.ja_na_base} já na base` : ""}.`);
      carregarCronStatus();
      carregarPendentes();
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

  function sugProspec(t) { $("p-termo").value = t; if ($("p-escopo")) $("p-escopo").value = "maps"; buscarProspec(); }
  function sugProspecSocial(t) { $("p-termo").value = t; if ($("p-escopo")) $("p-escopo").value = "social"; buscarProspec(); }

  async function buscarProspec() {
    const termo = $("p-termo").value.trim();
    const uf = $("p-uf").value, cidade = $("p-cidade").value.trim(), mr = $("p-mr").value;
    const escopo = $("p-escopo") ? $("p-escopo").value : "maps";
    if (!termo && !uf && !cidade) { toast("Informe um termo, cidade ou estado para buscar."); return; }
    const btn = $("p-buscar"); btn.disabled = true; btn.textContent = "Buscando…";
    $("p-saveall").style.display = "none";
    $("p-info").textContent = "";
    const ondeMsg = escopo === "social" ? "em redes sociais" : (escopo === "ambos" ? "no Google Maps e redes sociais" : "na web");
    $("p-lista").innerHTML = `<div class="empty">Buscando empresas ${ondeMsg}…</div>`;
    try {
      const p = new URLSearchParams();
      if (termo) p.set("termo", termo);
      if (uf) p.set("uf", uf);
      if (cidade) p.set("cidade", cidade);
      if (mr) p.set("microrregiao", mr);
      if (escopo) p.set("escopo", escopo);
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
    const rede = x.rede || "";
    const linhas = [];
    if (tel) linhas.push(`<div class="pl"><span>${x.whatsapp ? "WhatsApp" : "Telefone"}</span><b>${esc(tel)}</b></div>`);
    if (rede && x.handle) linhas.push(`<div class="pl"><span>Perfil</span><b>${esc(x.handle)}</b></div>`);
    linhas.push(`<div class="pl"><span>CNPJ</span><b class="hint">a completar</b></div>`);
    if (x.endereco) linhas.push(`<div class="pl"><span>Endereço</span><b>${esc(x.endereco)}</b></div>`);
    if (loc) linhas.push(`<div class="pl"><span>Cidade/UF</span><b>${esc(loc)}</b></div>`);
    const links = [];
    if (rede) {
      links.push(`<a href="${esc(x.fonte || x.site)}" target="_blank" rel="noopener">Ver no ${esc(rede)}</a>`);
    } else {
      if (x.site) links.push(`<a href="${esc(x.site)}" target="_blank" rel="noopener">Site</a>`);
      if (x.fonte) links.push(`<a href="${esc(x.fonte)}" target="_blank" rel="noopener">Ver no Google Maps</a>`);
    }
    const acao = x.ja_salvo
      ? `<button class="btn" disabled style="background:var(--soft);color:var(--muted)">✓ Já está na base</button>`
      : `<button class="btn primary" id="psave-${i}" onclick="App.salvarProspec(${i})">+ Salvar na base</button>`;
    const tipoBadge = rede
      ? `<span class="ptipo" style="background:#f3e8ff;color:#7c3aed">${esc(rede)}</span>`
      : (x.tipo ? `<span class="ptipo">${esc(x.tipo)}</span>` : "");
    return `
      <div class="pcard${x.ja_salvo ? " saved" : ""}" id="pcard-${i}">
        <div class="ph">
          <div class="pt">
            <b>${esc(x.nome)}</b>
            ${tipoBadge}
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

  // ==================== PROSPECÇÃO: pendentes da varredura ====================
  // A varredura automática não entra mais direto na base: joga os achados aqui,
  // numa fila de revisão. O usuário salva (vira empresa) ou descarta.
  async function carregarPendentes() {
    try { PEND = await (await fetch("/api/prospeccao/pendentes")).json(); }
    catch (e) { PEND = []; }
    if (!Array.isArray(PEND)) PEND = [];
    renderPendentes();
  }

  function renderPendentes() {
    const title = $("p-pend-title"), acts = $("p-pend-acts"), box = $("p-pend");
    if (!box) return;
    if (title) title.textContent = `Pendentes da varredura (${PEND.length})`;
    if (acts) acts.style.display = PEND.length ? "flex" : "none";
    if (!PEND.length) {
      box.innerHTML = `<div class="empty">Nenhum pendente. Rode a varredura (ou aguarde a diária) para encontrar novas empresas.</div>`;
      return;
    }
    const rows = PEND.map(p => {
      const local = [cidadeCurta(p.cidade), p.uf].filter(Boolean).join(" · ") || "—";
      const tel = p.whatsapp || p.telefone || "";
      const ehSocial = p.tipo === "Instagram" || p.tipo === "Facebook";
      const links = [];
      if (ehSocial) {
        links.push(`<a href="${esc(p.fonte || p.site)}" target="_blank" rel="noopener">${esc(p.tipo)}</a>`);
      } else {
        if (p.site) links.push(`<a href="${esc(p.site)}" target="_blank" rel="noopener">Site</a>`);
        if (p.fonte) links.push(`<a href="${esc(p.fonte)}" target="_blank" rel="noopener">Maps</a>`);
      }
      return `
      <tr>
        <td class="c-nome">${esc(p.nome)}${p.tipo ? `<br><span class="hint">${esc(p.tipo)}</span>` : ""}</td>
        <td class="c-loc" title="${esc(p.cidade || "")}">${esc(local)}</td>
        <td class="c-tel">${tel ? esc(tel) : '<span class="hint">—</span>'}</td>
        <td>${links.length ? links.join(" · ") : '<span class="hint">—</span>'}</td>
        <td class="c-resp">${esc(formatarData(p.encontrado_em))}</td>
        <td class="sp"></td>
        <td class="pend-row-acts">
          <button class="btn primary sm" onclick="App.salvarPendente(${p.id})">+ Salvar</button>
          <button class="btn ghost danger sm" onclick="App.descartarPendente(${p.id})">Descartar</button>
        </td>
      </tr>`;
    }).join("");
    box.innerHTML = `<table class="tbl-emp tbl-pend"><thead><tr><th>Empresa</th><th>Cidade/UF</th><th>Contato</th><th>Links</th><th>Encontrada</th><th class="sp"></th><th>Ação</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async function salvarPendente(id) {
    const r = await fetch("/api/prospeccao/pendentes/salvar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }),
    });
    const js = await r.json();
    if (!r.ok) { toast(js.erro || "Falha ao salvar."); return; }
    toast(js.criados ? "Empresa salva na base." : "Já estava na base (removida da fila).");
    await carregarPendentes();
    recarregar();
  }

  async function descartarPendente(id) {
    const r = await fetch("/api/prospeccao/pendentes/descartar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }),
    });
    if (!r.ok) { toast("Falha ao descartar."); return; }
    toast("Pendente descartado.");
    carregarPendentes();
  }

  async function salvarTodosPendentes() {
    if (!PEND.length) return;
    if (!confirm(`Salvar na base ${PEND.length} empresa(s) pendente(s)?`)) return;
    const r = await fetch("/api/prospeccao/pendentes/salvar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ todos: true }),
    });
    const js = await r.json();
    if (!r.ok) { toast(js.erro || "Falha ao salvar."); return; }
    toast(`${js.criados} salva(s) na base${js.duplicados ? ` · ${js.duplicados} já existia(m)` : ""}.`);
    await carregarPendentes();
    recarregar();
  }

  async function descartarTodosPendentes() {
    if (!PEND.length) return;
    if (!confirm(`Descartar TODOS os ${PEND.length} pendentes? Não afeta quem já está na base.`)) return;
    const r = await fetch("/api/prospeccao/pendentes/descartar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ todos: true }),
    });
    if (!r.ok) { toast("Falha ao descartar."); return; }
    toast("Fila de pendentes esvaziada.");
    carregarPendentes();
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
    const ico = f.tip ? " " + infoIco(f.tip, f.l) : "";   // ⓘ ao lado do rótulo quando houver explicação
    if (f.type === "bool")
      return `<div class="${cls}"><label>${f.l}${ico}</label><div class="chk"><input type="checkbox" id="${id}" ${val ? "checked" : ""}><span style="color:var(--muted);font-size:13px">Sim</span></div></div>`;
    if (f.type === "select") {
      const opts = `<option value=""></option>` + (B[f.opts] || []).map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("");
      return `<div class="${cls}"><label class="${f.req ? "req" : ""}">${f.l}${ico}</label><select id="${id}">${opts}</select></div>`;
    }
    if (f.type === "textarea")
      return `<div class="fld full"><label>${f.l}${ico}</label><textarea id="${id}" rows="3">${esc(val || "")}</textarea></div>`;
    const t = f.type === "num" ? "number" : f.type === "date" ? "date" : "text";
    return `<div class="${cls}"><label class="${f.req ? "req" : ""}">${f.l}${ico}</label><input type="${t}" id="${id}" value="${esc(val ?? "")}"></div>`;
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

  // Sugestao automatica de faixa de potencial (vem do backend em e.faixa_sugerida).
  // So aparece se houver sugestao e ela for diferente da faixa ja definida.
  function faixaSugeridaHTML(e) {
    const s = e && e.faixa_sugerida;
    if (!s || !s.faixa) return "";
    if (e.faixa_potencial === s.faixa) return ""; // ja esta classificado igual
    const motivos = (s.motivos || []).join(" · ");
    const jaTem = !!e.faixa_potencial;
    return `
      <div class="faixa-sug">
        <span class="fs-ico">💡</span>
        <div class="fs-txt">
          <b>Sugestão: ${esc(s.faixa)}</b>
          ${motivos ? `<span class="fs-mot">${esc(motivos)}</span>` : ""}
        </div>
        <button class="btn sm primary" onclick="App.aplicarFaixaSugerida()">${jaTem ? "Trocar" : "Usar"}</button>
      </div>`;
  }

  async function aplicarFaixaSugerida() {
    const s = cur && cur.faixa_sugerida;
    if (!cur || !cur.id || !s || !s.faixa) return;
    const r = await fetch("/api/empresas/" + cur.id + "/faixa", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faixa_potencial: s.faixa }),
    });
    if (!r.ok) { toast("Não foi possível aplicar a sugestão."); return; }
    toast("Potencial classificado: " + s.faixa);
    await recarregar();
    await abrirFicha(cur.id);
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
        `<button class="${s === e.status ? "on" : ""}" style="${s === e.status ? "color:" + hexCor(corStatus(s)) : ""}" onclick="App.setStatus('${esc(s)}')"><span class="d" style="background:${hexCor(corStatus(s))}"></span>${esc(s)}</button>`).join("")}
        ${infoIco("Clique em um status para mover a empresa de etapa no funil na hora. A cor dela muda no mapa e na lista.", "Status comercial")}</div>

      <div class="classbar">
        ${faixaPill(e.faixa_potencial)}
        <span class="pill-venda ${e.ja_vendeu ? "sim" : "nao"}">${e.ja_vendeu ? "✓ Já fez venda" : "Ainda não vendeu"}</span>
        ${infoIco("Resumo da classificação: a faixa de potencial de vendas/mês e se a empresa já fez a primeira venda. Edite em 'Editar dados'.", "Classificação")}
      </div>
      ${faixaSugeridaHTML(e)}

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

      <div class="sec"><h4>Histórico de contatos${infoIco("Registre cada ligação, visita ou mensagem. A 'próxima ação' informada aqui alimenta o Follow-up e a data do último contato.", "Histórico de contatos")}</h4>
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
    abrirFicha, novaEmpresa, editarFicha, verFicha, fecharDrawer, salvar, setStatus, aplicarFaixaSugerida,
    addContato, delContato, addFilial, delFilial, excluir, realce,
    exportar, modelo, abrirImport, fazerImport,
    pUfMudou, sugProspec, sugProspecSocial, buscarProspec, salvarProspec, salvarTodosProspec,
    varreduraAgora, fuFiltrarUF,
    salvarPendente, descartarPendente, salvarTodosPendentes, descartarTodosPendentes,
    renderHist, abrirPesquisa, repesquisar, excluirPesquisa,
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
