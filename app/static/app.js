/* Plataforma de Prospecção Starlink — Bradel. SPA sem framework. */
"use strict";

const App = (() => {
  let B = null;            // bootstrap (listas, cores, mapa)
  let MAP = null;          // dados do mapa (/api/mapa)
  let DASH = null;         // dados do painel (/api/dashboard)
  let EMPRESAS = [];       // lista atual filtrada
  let cur = null;          // empresa aberta no drawer
  let editMode = false;
  let sel = null;          // "UF|microrregiao" selecionada no mapa
  let buscaTimer = null;

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
    $("f-resp").innerHTML = selOpts(B.responsaveis, "Todos");
    $("f-canal").innerHTML = selOpts(B.canais, "Todos");
    // f-uf usa onchange=App.ufMudou() no HTML; os demais recarregam direto
    ["f-mr", "f-seg", "f-status", "f-resp", "f-canal"].forEach(id => $(id).addEventListener("change", recarregar));
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
    add("f-status", "status"); add("f-resp", "responsavel"); add("f-canal", "canal");
    if ($("f-cred").checked) p.set("credenciado", "1");
    if ($("f-pot").checked) p.set("potencial", "1");
    if ($("f-tel").checked) p.set("telecom", "1");
    const b = $("busca").value.trim(); if (b) p.set("q", b);
    return p.toString();
  }

  async function recarregar() {
    const q = qs();
    const [emp, mp, dsh] = await Promise.all([
      fetch("/api/empresas?" + q).then(r => r.json()),
      fetch("/api/mapa?" + q).then(r => r.json()),
      fetch("/api/dashboard").then(r => r.json()),
    ]);
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

  // ==================== MAPA ====================
  function heatLevel(c, max) {
    if (!c) return 0;
    if (max <= 6) return Math.min(6, c);
    return Math.min(6, Math.max(1, Math.round(c / max * 6)));
  }

  function renderMapa() {
    const { w, h } = B.map.dims;
    const regs = B.map.regions, agg = MAP.regioes, max = MAP.max;
    let paths = "";
    for (const r of regs) {
      const key = r.uf + "|" + r.n;
      const a = agg[key];
      const lvl = heatLevel(a ? a.count : 0, max);
      const on = sel === key ? " sel" : "";
      paths += `<path class="rg heat${lvl}${on}" d="${r.d}" data-key="${esc(key)}" data-uf="${r.uf}" data-n="${esc(r.n)}"></path>`;
    }
    let marks = "";
    for (const m of MAP.marcadores) {
      marks += `<circle class="mk" cx="${m.x}" cy="${m.y}" r="5" fill="${m.hex}" data-id="${m.id}"></circle>`;
    }
    const svg = $("mapa");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.classList.toggle("dim", !!sel);
    svg.innerHTML = paths + marks;
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
    const rows = EMPRESAS.map(e => `
      <tr onclick="App.abrirFicha(${e.id})" onmouseenter="App.realce(${e.id},1)" onmouseleave="App.realce(${e.id},0)">
        <td>${esc(e.nome_fantasia || e.razao_social)}<br><span class="hint">${esc(e.cidade || "")}${e.uf ? " · " + e.uf : ""}</span></td>
        <td><span class="badge"><span class="d" style="background:${e.cor_hex}"></span>${esc(e.status || "")}</span></td>
      </tr>`).join("");
    $("lista").innerHTML = `<table><thead><tr><th>Empresa</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
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

  function renderPainel() {
    const d = DASH;
    const stats = [
      ["Total mapeadas", d.total], ["Potenciais", d.potenciais], ["Em negociação", d.em_negociacao],
      ["Aguardando doc.", d.aguardando], ["Credenciados", d.credenciados], ["Perdidos/sem retorno", d.perdidos],
      ["Municípios", d.municipios], ["Microrregiões", d.microrregioes],
    ];
    const statusData = B.status.map(s => [s, d.por_status[s] || 0]).filter(x => x[1] > 0);
    const ufData = B.ufs.map(u => [u, d.por_uf[u] || 0]);
    const segData = Object.entries(d.por_segmento);
    $("view-painel").innerHTML = `
      <div class="card wide"><div class="hd"><h2>Resumo geral</h2></div><div class="bd">
        <div class="statgrid">${stats.map(s => `<div class="stat"><div class="v">${s[1]}</div><div class="l">${esc(s[0])}</div></div>`).join("")}</div>
      </div></div>
      <div class="card"><div class="hd"><h2>Por status comercial</h2></div><div class="bd">${statusData.length ? chart(statusData, l => hexCor(corStatus(l))) : '<div class="empty">Sem dados.</div>'}</div></div>
      <div class="card"><div class="hd"><h2>Distribuição por estado</h2></div><div class="bd">${chart(ufData, () => "var(--accent)")}</div></div>
      <div class="card wide"><div class="hd"><h2>Por segmento</h2></div><div class="bd">${segData.length ? chart(segData, () => "var(--brand2)") : '<div class="empty">Sem segmentos informados.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Funil de conversão</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="stat"><div class="v">${d.total}</div><div class="l">Prospectados (base)</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("amarelo")}">${d.em_negociacao + d.aguardando}</div><div class="l">Em andamento</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("verde")}">${d.credenciados}</div><div class="l">Credenciados (${d.taxa_conversao}%)</div></div>
        </div>
      </div></div>`;
  }

  function view(v) {
    const mapa = v === "mapa";
    $("view-mapa").classList.toggle("hidden", !mapa);
    $("view-painel").classList.toggle("hidden", mapa);
    $("tab-mapa").classList.toggle("on", mapa);
    $("tab-painel").classList.toggle("on", !mapa);
    if (!mapa) renderPainel();
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
    ["f-uf", "f-mr", "f-seg", "f-status", "f-resp", "f-canal"].forEach(id => $(id).value = "");
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
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
