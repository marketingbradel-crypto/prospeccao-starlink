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
  let fuResp = null;       // filtro de responsável no follow-up (null=ainda não iniciado; ""=todos)
  let fuStatus = "";       // filtro de status ("" = todos)
  let fuOrigem = "";       // filtro de origem/fonte do contato (VSM, Formulário, etc; "" = todas)
  let fuVendeu = "";       // filtro "fez venda": "" todos, "1" sim, "0" não
  let fuFaixa = "";        // filtro de faixa de potencial/volume ("" = todas)
  let fuPend = "";         // filtro de pendência VSM: "" todas, "treinar", "contrato", "sem"
  let fuBusca = "";        // busca por nome da empresa no follow-up ("" = sem filtro)
  let ME = null;           // usuário logado (/api/me): { username, admin, must_change, responsavel }
  let MODAL_FECHAVEL = true; // o modal atual pode ser fechado? (1º acesso = não)
  let apMetric = "empresas"; // métrica ativa no painel de indicadores ao lado do mapa
  let gerPeriodo = "7d";     // preset de período na aba Gerencial (hoje/ontem/7d/30d/custom)
  let gerInicio = "";        // intervalo personalizado (YYYY-MM-DD)
  let gerFim = "";
  let gerUsers = [];         // colaboradores selecionados ([] = todos)
  let gerColabs = [];        // colaboradores disponíveis (/api/gerencial/colaboradores)

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hexCor = (cor) => (B && B.cor_hex[cor]) || "#9aa0ac";
  const corStatus = (st) => (B && B.status_cor[st]) || "cinza";
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  // ---- Telefones (padrão BR único) — espelha a lógica do backend ----
  // Reduz a 10/11 dígitos, tirando separadores e o DDI 55 (colagem com +55).
  const telDigitos = (s) => { let d = String(s ?? "").replace(/\D/g, ""); if (d.length > 11 && d.startsWith("55")) d = d.slice(2); return d; };
  // Válido = fixo (10) ou celular (11 com 9 após o DDD). soCel exige celular (WhatsApp).
  const telValido = (d, soCel) => d.length === 11 ? d[2] === "9" : (d.length === 10 ? !soCel : false);
  // Exibição padrão: (DD) 9XXXX-XXXX ou (DD) XXXX-XXXX. Fora do padrão volta como veio.
  const fmtTel = (v) => { const s = String(v ?? "").trim(); const d = telDigitos(s); if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`; return s; };
  // Máscara progressiva (digitação/colagem em tempo real). Até 10 díg. usa 4+4; a partir do 11º, 5+4.
  const mascaraTel = (v) => {
    const d = telDigitos(v).slice(0, 11);
    if (!d) return "";
    const ddd = d.slice(0, 2);
    if (d.length <= 2) return `(${d}`;
    const r = d.slice(2), corte = d.length > 10 ? 5 : 4;
    return r.length <= corte ? `(${ddd}) ${r}` : `(${ddd}) ${r.slice(0, corte)}-${r.slice(corte)}`;
  };
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
      { k: "telefone_comercial", l: "Telefone comercial", tel: 1 }, { k: "whatsapp", l: "WhatsApp", tel: 1, cel: 1 },
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
      { k: "resp_cargo", l: "Cargo" }, { k: "resp_telefone", l: "Telefone direto", tel: 1 },
      { k: "resp_whatsapp", l: "WhatsApp", tel: 1, cel: 1 }, { k: "resp_email", l: "E-mail" },
    ]},
    { t: "Informações comerciais", f: [
      { k: "segmento", l: "Segmento", type: "select", opts: "segmentos", full: 1, tip: "Ramo de atividade da empresa. Ajuda a avaliar aderência à Starlink e a filtrar a base." },
      { k: "produtos", l: "Principais produtos", full: 1 },
      { k: "trabalha_telecom", l: "Trabalha com telecom/tecnologia?", type: "bool", tip: "Marque se a empresa já atua com internet, telecom ou tecnologia — perfil mais aderente para revender Starlink." },
      { k: "ja_starlink", l: "Já comercializa Starlink?", type: "bool", tip: "Marque se a empresa já revende Starlink hoje (por outro distribuidor ou canal)." },
      { k: "exp_antenas", l: "Experiência com antenas?", type: "bool", tip: "Marque se já tem experiência instalando antenas (parabólica, rádio, satélite)." },
      { k: "equipe_tecnica", l: "Possui equipe técnica?", type: "bool", tip: "Marque se a empresa tem equipe própria para instalação e suporte técnico." },
      { k: "loja_fisica", l: "Possui loja física?", type: "bool", tip: "Marque se a empresa tem ponto de venda físico aberto ao público." },
      { k: "possui_estoque", l: "Possui estoque?", type: "bool", tip: "Marque se a empresa mantém estoque de produtos (antenas/equipamentos)." },
      { k: "qtd_filiais", l: "Qtd. filiais", type: "num" },
      { k: "capacidade_vendas_mes", l: "Capacidade de vendas/mês", tip: "Estimativa de quantas antenas a empresa conseguiria vender por mês. Base para classificar o potencial." },
      { k: "interesse_parceiro", l: "Interesse em ser parceiro", type: "select", opts: "interesse", tip: "Nível de interesse que a empresa demonstrou em se tornar parceira Starlink." },
      { k: "origem_contato", l: "Origem do contato", type: "select", opts: "origens", tip: "Como esta empresa entrou na base (ex.: varredura automática, indicação, cadastro manual)." },
    ]},
    { t: "Classificação e gestão", f: [
      { k: "faixa_potencial", l: "Potencial (vendas/mês)", type: "select", opts: "faixas_potencial", tip: "Classifica a empresa por volume estimado de vendas/mês. A ficha pode sugerir uma faixa automaticamente." },
      { k: "ja_vendeu", l: "Já fez venda?", type: "bool", tip: "Marque quando a empresa fechar a primeira venda de antena." },
      { k: "status", l: "Status comercial", type: "select", opts: "status", tip: "Etapa atual no funil (aguardando contato → em atendimento → … → pronto para venda). Define a cor no mapa e na lista." },
      { k: "status_vivensis", l: "Status Vivensis", type: "select", opts: "status_vivensis", tip: "Situação da revenda no portal Vivensis/VSM (credenciamento junto ao distribuidor)." },
      { k: "id_vsm", l: "ID VSM", type: "vsm", tip: "Identificador do parceiro no VSM/Vivensis. Depois de definido não pode mais ser alterado; fica em branco (e editável) enquanto a revenda ainda não tiver credenciamento." },
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
    // Máscara de telefone em tempo real p/ qualquer input [data-mask=tel] (ficha,
    // filial e futuros formulários). Delegação: vale para campos criados dinamicamente.
    document.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el && el.dataset && el.dataset.mask === "tel") el.value = mascaraTel(el.value);
    });
    // Fecha o menu do usuário ao clicar fora; ESC / clique no fundo fecham o modal.
    document.addEventListener("click", (ev) => {
      const um = $("usermenu"); if (um && !um.contains(ev.target)) fecharUserMenu();
      // Fecha o menu móvel ao tocar fora da barra superior.
      const tb = ev.target.closest && ev.target.closest(".topbar");
      if (!tb) fecharNav();
    });
    $("modal-ov").addEventListener("click", (ev) => { if (ev.target === $("modal-ov")) fecharModal(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharModal(); });
    // Badge de pendências de follow-up (vencidas + hoje) na aba, sem abrir a aba.
    fetch("/api/follow-up").then(r => r.json()).then(atualizarBadgeFollowUp).catch(() => {});
    await carregarMe();  // chip do usuário + força definição de senha no 1º acesso
  }

  // ==================== Usuário / sessão ====================
  async function carregarMe() {
    try { ME = await (await fetch("/api/me")).json(); } catch (e) { ME = null; }
    if (!ME || ME.erro) { ME = null; return; }
    const nome = ME.username || "";
    const papelRot = ME.admin ? " · admin" : (ME.papel === "consulta" ? " · consulta" : "");
    $("uname").textContent = nome + papelRot;
    $("uava").textContent = (nome[0] || "?");
    $("menu-usuarios").hidden = !ME.admin;
    if ($("menu-seguranca")) $("menu-seguranca").hidden = !ME.admin;
    // Gating por papel (RBAC): perfil Consulta não vê botões de escrita (o backend
    // bloqueia de qualquer forma — isto é só UX). Exportar/Modelo continuam (leitura).
    const consulta = ME.papel === "consulta";
    if ($("btn-novo")) $("btn-novo").hidden = consulta;
    // Import em massa: só bradel/jossy (o backend confirma via ME.pode_importar).
    if ($("btn-import")) $("btn-import").hidden = !ME.pode_importar;
    // Aba Gerencial: só aparece para quem tem permissão (admin sempre tem).
    const temGer = !!(ME.perm_gerencial || ME.admin);
    if ($("tab-gerencial")) $("tab-gerencial").hidden = !temGer;
    // Follow-up abre filtrado pela carteira do usuário (quem é geral vê tudo: "").
    if (fuResp === null) fuResp = ME.responsavel || "";
    if (ME.must_change) forcarPrimeiroAcesso();
  }
  function toggleUserMenu(ev) {
    if (ev) ev.stopPropagation();
    const pop = $("usermenu-pop"); const abrir = pop.hidden;
    pop.hidden = !abrir;
    $("userchip").setAttribute("aria-expanded", abrir ? "true" : "false");
  }
  function fecharUserMenu() {
    const p = $("usermenu-pop");
    if (p && !p.hidden) { p.hidden = true; $("userchip").setAttribute("aria-expanded", "false"); }
  }
  // ---- menu móvel (hamburguer) ----
  function navToggle(ev) {
    if (ev) ev.stopPropagation();
    const tb = document.querySelector(".topbar"); if (!tb) return;
    const abrir = !tb.classList.contains("nav-open");
    tb.classList.toggle("nav-open", abrir);
    const b = $("navtoggle"); if (b) b.setAttribute("aria-expanded", abrir ? "true" : "false");
  }
  function fecharNav() {
    const tb = document.querySelector(".topbar");
    if (tb && tb.classList.contains("nav-open")) {
      tb.classList.remove("nav-open");
      const b = $("navtoggle"); if (b) b.setAttribute("aria-expanded", "false");
    }
  }

  // ---- modal genérico ----
  function abrirModal(titulo, html, opts) {
    opts = opts || {};
    MODAL_FECHAVEL = opts.fechavel !== false;
    $("modal-tt").textContent = titulo;
    $("modal-b").innerHTML = html;
    $("modal-x").style.display = MODAL_FECHAVEL ? "" : "none";
    $("modal-ov").hidden = false;
    const f = $("modal-b").querySelector("input"); if (f) setTimeout(() => f.focus(), 40);
  }
  function fecharModal() { if (MODAL_FECHAVEL) $("modal-ov").hidden = true; }
  function modalErro(msg) {
    let e = $("modal-err");
    if (!e) { e = document.createElement("div"); e.id = "modal-err"; e.className = "modal-err"; $("modal-b").prepend(e); }
    e.textContent = msg;
  }

  // ---- trocar senha (voluntário) e 1º acesso (forçado) ----
  function abrirTrocarSenha() {
    fecharUserMenu();
    if (ME && ME.env) { toast("O admin do sistema troca a senha pela Cloudflare."); return; }
    abrirModal("Trocar minha senha", `
      <div class="fld"><label>Senha atual</label><input id="s-atual" type="password" autocomplete="current-password"></div>
      <div class="fld"><label>Nova senha (mín. 6)</label><input id="s-nova" type="password" autocomplete="new-password"></div>
      <div class="fld"><label>Confirmar nova senha</label><input id="s-nova2" type="password" autocomplete="new-password"></div>
      <button class="btn primary" style="width:100%" onclick="App.salvarSenha(false)">Salvar nova senha</button>`);
  }
  function forcarPrimeiroAcesso() {
    abrirModal("Defina sua senha", `
      <div class="modal-note">Primeiro acesso de <b>${esc(ME.username)}</b>. Crie uma senha pessoal para continuar — a partir de agora é com ela que você entra.</div>
      <div class="fld"><label>Nova senha (mín. 6)</label><input id="s-nova" type="password" autocomplete="new-password"></div>
      <div class="fld"><label>Confirmar nova senha</label><input id="s-nova2" type="password" autocomplete="new-password"></div>
      <button class="btn primary" style="width:100%" onclick="App.salvarSenha(true)">Salvar e entrar</button>`, { fechavel: false });
  }
  async function salvarSenha(primeiro) {
    const nova = $("s-nova").value, nova2 = $("s-nova2").value;
    const atual = (!primeiro && $("s-atual")) ? $("s-atual").value : "";
    if (nova.length < 6) { modalErro("A senha precisa ter ao menos 6 caracteres."); return; }
    if (nova !== nova2) { modalErro("As senhas não conferem."); return; }
    const r = await fetch("/api/me/senha", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ atual, nova }),
    });
    const js = await r.json().catch(() => ({}));
    if (!r.ok) { modalErro(js.erro || "Não foi possível trocar a senha."); return; }
    MODAL_FECHAVEL = true; $("modal-ov").hidden = true;
    if (ME) ME.must_change = false;
    toast("Senha atualizada.");
  }

  // ---- painel admin de usuários ----
  async function abrirUsuarios() {
    fecharUserMenu();
    abrirModal("Usuários da equipe", `<div class="modal-note">Carregando…</div>`);
    await recarregarUsuarios();
  }
  async function recarregarUsuarios() {
    let lista = [];
    try { const r = await fetch("/api/usuarios"); lista = r.ok ? await r.json() : []; } catch (e) {}
    const papelSel = (uname, cur) => `<select class="papel-sel" onchange="App.setPapel('${esc(uname)}', this.value)"
        data-tip="Papel (RBAC): Admin = tudo · Operador = cria/edita (não exclui empresa) · Consulta = só leitura.">
        ${["admin", "operador", "consulta"].map(p => `<option value="${p}" ${cur === p ? "selected" : ""}>${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}
      </select>`;
    const itens = lista.map(u => `
      <li>
        <span class="uava" style="width:26px;height:26px">${esc((u.username || "?")[0])}</span>
        <span class="un">${esc(u.username)} ${u.must_change ? '<span class="pend">senha padrão</span>' : '<span class="okb">senha própria</span>'}</span>
        ${papelSel(u.username, u.papel || "operador")}
        <label class="ger-perm" data-tip="Libera o acesso à aba Gerencial (produtividade). Não altera as demais permissões.">
          <input type="checkbox" ${Number(u.perm_gerencial) ? "checked" : ""} onchange="App.toggleGerencial('${esc(u.username)}', this.checked)"> Gerencial
        </label>
        <button class="lnk" onclick="App.resetUsuario('${esc(u.username)}')" data-tip="Volta para a senha padrão: a pessoa redefine no próximo acesso.">resetar</button>
        <button class="lnk danger" onclick="App.delUsuario('${esc(u.username)}')">remover</button>
      </li>`).join("");
    $("modal-b").innerHTML = `
      <div class="modal-note">Para liberar alguém, informe o usuário (ex.: <b>leandro</b>) e o papel. A pessoa entra com esse usuário + a <b>senha padrão</b> e define a própria senha no 1º acesso.<br>
        <b>Admin</b>: tudo · <b>Operador</b>: cria e edita (não exclui empresa) · <b>Consulta</b>: somente leitura.</div>
      <div class="fld" style="display:flex;gap:8px;margin-bottom:14px">
        <input id="nu-user" placeholder="novo usuário (minúsculo)" autocapitalize="none" spellcheck="false" style="flex:1">
        <select id="nu-papel" style="flex:0 0 auto">
          <option value="operador">Operador</option>
          <option value="consulta">Consulta</option>
          <option value="admin">Admin</option>
        </select>
        <button class="btn primary" onclick="App.addUsuario()">Adicionar</button>
      </div>
      <ul class="userlist">${itens || '<li class="okb">Ninguém definiu senha ainda. Quem entrar pela 1ª vez (ou for liberado aqui) aparece nesta lista.</li>'}</ul>`;
  }
  async function addUsuario() {
    const username = ($("nu-user").value || "").trim().toLowerCase();
    const papel = ($("nu-papel") && $("nu-papel").value) || "operador";
    if (!username) { toast("Informe o usuário."); return; }
    const r = await fetch("/api/usuarios", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, papel }),
    });
    const js = await r.json().catch(() => ({}));
    if (!r.ok) { toast(js.erro || "Não foi possível adicionar."); return; }
    toast("Usuário liberado: " + username);
    await recarregarUsuarios();
  }
  async function resetUsuario(username) {
    if (!confirm("Resetar a senha de " + username + "? A pessoa volta a entrar com a senha padrão.")) return;
    const r = await fetch("/api/usuarios/" + encodeURIComponent(username) + "/reset", { method: "POST" });
    if (!r.ok) { toast("Falha ao resetar."); return; }
    toast("Senha resetada."); await recarregarUsuarios();
  }
  async function delUsuario(username) {
    if (!confirm("Remover o usuário " + username + "?")) return;
    const r = await fetch("/api/usuarios/" + encodeURIComponent(username), { method: "DELETE" });
    if (!r.ok) { toast("Falha ao remover."); return; }
    toast("Usuário removido."); await recarregarUsuarios();
  }
  async function toggleGerencial(username, ativo) {
    const r = await fetch("/api/usuarios/" + encodeURIComponent(username) + "/gerencial", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo }),
    });
    if (!r.ok) { toast("Falha ao alterar acesso gerencial."); await recarregarUsuarios(); return; }
    toast(ativo ? "Acesso gerencial liberado: " + username : "Acesso gerencial removido: " + username);
  }
  async function setPapel(username, papel) {
    const r = await fetch("/api/usuarios/" + encodeURIComponent(username) + "/papel", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ papel }),
    });
    const js = await r.json().catch(() => ({}));
    if (!r.ok) { toast(js.erro || "Falha ao alterar o papel."); await recarregarUsuarios(); return; }
    toast("Papel de " + username + " alterado para " + papel + ".");
  }

  // ---- minhas sessões (qualquer usuário) ----
  function uaCurto(ua) {
    ua = ua || "";
    let os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    let br = /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
    return [br, os].filter(Boolean).join(" · ") || "dispositivo";
  }
  async function abrirMinhasSessoes() {
    fecharUserMenu();
    abrirModal("Meus dispositivos / sessões", `<div class="modal-note">Carregando…</div>`);
    let lista = [];
    try { const r = await fetch("/api/me/sessoes"); lista = r.ok ? await r.json() : []; } catch (e) {}
    const itens = lista.map(s => `
      <li>
        <span class="un">${uaCurto(s.user_agent)} ${s.atual ? '<span class="okb">esta sessão</span>' : ''}</span>
        <span class="sess-meta">${esc(s.ip || "—")} · ativo ${esc(s.ultima_atividade || "")}</span>
      </li>`).join("");
    $("modal-b").innerHTML = `
      <div class="modal-note">Sessões abertas com o seu login. Se não reconhecer alguma, encerre as outras e troque sua senha.</div>
      <ul class="userlist sesslist">${itens || '<li class="okb">Nenhuma sessão ativa além desta.</li>'}</ul>
      <button class="btn primary" style="width:100%;margin-top:12px" onclick="App.logoutAll()">Encerrar todas as outras sessões</button>`;
  }
  async function logoutAll() {
    const r = await fetch("/api/me/logout-all", { method: "POST" });
    const js = await r.json().catch(() => ({}));
    if (!r.ok) { toast("Falha ao encerrar sessões."); return; }
    toast((js.encerradas || 0) + " sessão(ões) encerrada(s).");
    await abrirMinhasSessoes();
  }

  // ---- Segurança e auditoria (somente admin) ----
  let segTab = "sessoes";
  async function abrirSeguranca() {
    fecharUserMenu();
    segTab = "sessoes";
    abrirModal("Segurança e auditoria", `<div class="modal-note">Carregando…</div>`);
    await renderSeguranca();
  }
  async function segAba(t) { segTab = t; await renderSeguranca(); }
  async function renderSeguranca() {
    let resumo = {};
    try { resumo = await (await fetch("/api/seguranca/resumo")).json(); } catch (e) {}
    const kpis = `
      <div class="seg-kpis">
        <div class="seg-kpi"><b>${resumo.sessoes_ativas ?? "–"}</b><span>sessões ativas</span></div>
        <div class="seg-kpi"><b>${resumo.usuarios_online ?? "–"}</b><span>usuários online</span></div>
        <div class="seg-kpi"><b>${resumo.bloqueios_ativos ?? "–"}</b><span>logins bloqueados</span></div>
        <div class="seg-kpi"><b>${resumo.falhas_hoje ?? "–"}</b><span>falhas de login hoje</span></div>
      </div>`;
    const tabBtn = (id, lbl) => `<button class="seg-tabbtn ${segTab === id ? "on" : ""}" onclick="App.segAba('${id}')">${lbl}</button>`;
    const tabs = `<div class="seg-tabs">${tabBtn("sessoes", "Sessões ativas")}${tabBtn("acessos", "Histórico de acessos")}${tabBtn("tentativas", "Tentativas de login")}</div>`;
    $("modal-b").innerHTML = kpis + tabs + `<div id="seg-body"><div class="modal-note">Carregando…</div></div>`;
    try {
      if (segTab === "sessoes") await renderSegSessoes();
      else if (segTab === "acessos") await renderSegAcessos();
      else await renderSegTentativas();
    } catch (e) { $("seg-body").innerHTML = `<div class="modal-note">Não foi possível carregar.</div>`; }
  }
  async function renderSegSessoes() {
    const lista = await (await fetch("/api/seguranca/sessoes")).json();
    const itens = (lista || []).map(s => `
      <li>
        <span class="un">${esc(s.usuario)} ${s.atual ? '<span class="okb">você</span>' : ''}</span>
        <span class="sess-meta">${uaCurto(s.user_agent)} · ${esc(s.ip || "—")} · ativo ${esc(s.ultima_atividade || "")}</span>
        ${s.atual ? "" : `<button class="lnk danger" onclick="App.segRevogar('${esc(s.id)}')">encerrar</button>`}
      </li>`).join("");
    $("seg-body").innerHTML = `<ul class="userlist sesslist">${itens || '<li class="okb">Nenhuma sessão ativa.</li>'}</ul>`;
  }
  async function segRevogar(id) {
    const r = await fetch("/api/seguranca/sessoes/revogar", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (!r.ok) { toast("Falha ao encerrar a sessão."); return; }
    toast("Sessão encerrada."); await renderSegSessoes();
  }
  async function renderSegAcessos() {
    const lista = await (await fetch("/api/seguranca/acessos?limit=200")).json();
    const linhas = (lista || []).map(a => `
      <tr>
        <td>${esc((a.ts || "").slice(0, 19))}</td>
        <td>${esc(a.usuario || "—")}</td>
        <td>${esc(a.acao_label || a.acao)}</td>
        <td>${esc([a.campo, a.valor_depois].filter(Boolean).join(" → "))}</td>
        <td>${esc(a.ip || "")}</td>
      </tr>`).join("");
    $("seg-body").innerHTML = `<div class="seg-tablewrap"><table class="seg-table">
      <thead><tr><th>Quando</th><th>Usuário</th><th>Evento</th><th>Detalhe</th><th>IP</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="5">Sem registros.</td></tr>'}</tbody></table></div>`;
  }
  async function renderSegTentativas() {
    const lista = await (await fetch("/api/seguranca/tentativas")).json();
    const linhas = (lista || []).map(t => `
      <tr class="${t.bloqueado ? "bloq" : ""}">
        <td>${esc(t.usuario || "—")}</td>
        <td>${esc(t.ip || "")}</td>
        <td>${t.tentativas}</td>
        <td>${t.bloqueado ? "🔒 bloqueado até " + esc((t.bloqueado_ate || "").slice(11, 19)) : "—"}</td>
      </tr>`).join("");
    $("seg-body").innerHTML = `<div class="modal-note">Bloqueio automático após 5 falhas (15 min). Some ao expirar.</div>
      <div class="seg-tablewrap"><table class="seg-table">
      <thead><tr><th>Usuário</th><th>IP</th><th>Falhas</th><th>Situação</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="4">Nenhuma tentativa recente.</td></tr>'}</tbody></table></div>`;
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
    $("f-pend").innerHTML = selOpts(B.pendencias_vsm || [], "Todas");
    $("f-resp").innerHTML = selOpts(B.responsaveis, "Todos");
    $("f-canal").innerHTML = selOpts(B.canais, "Todos");
    // f-uf usa onchange=App.ufMudou() no HTML; os demais recarregam direto
    ["f-mr", "f-seg", "f-status", "f-faixa", "f-pend", "f-vendeu", "f-resp", "f-canal"].forEach(id => $(id).addEventListener("change", recarregar));
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
    add("f-status", "status"); add("f-faixa", "faixa"); add("f-pend", "pendencia"); add("f-vendeu", "vendeu");
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
    renderKPIs(); renderMapa(); renderLista(); renderApuracao();
    if (!$("view-painel").classList.contains("hidden")) renderPainel();
    // Mantém o Follow-up e seu badge em sincronia após qualquer salvamento,
    // sem bloquear a atualização do mapa/lista (fire-and-forget).
    sincronizarFollowUp();
  }

  // Rebusca o follow-up em segundo plano: atualiza o badge sempre e re-renderiza
  // a lista só quando a aba está aberta. Chamado após salvar na ficha.
  async function sincronizarFollowUp() {
    let d;
    try { d = await (await fetch("/api/follow-up")).json(); }
    catch (e) { return; }
    FU = d;
    atualizarBadgeFollowUp(d);
    if (!$("view-followup").classList.contains("hidden")) renderFollowUp();
  }

  // ==================== KPIs ====================
  function renderKPIs() {
    const d = DASH;
    const cards = [
      { v: d.total, l: "Empresas mapeadas", c: "var(--accent)", tip: "Total de empresas cadastradas na base (visão geral, sem considerar os filtros do mapa)." },
      { v: d.potenciais, l: "Potenciais", c: hexCor("azul"), tip: "Leads no início do funil (aguardando contato ou em atendimento)." },
      { v: d.em_negociacao, l: "Em andamento", c: hexCor("amarelo"), tip: "Empresas em cadastro no VSM ou em treinamento." },
      { v: d.credenciados, l: "Pronto p/ venda", c: hexCor("verde"), tip: "Revendas prontas para vender Starlink (estágio de conversão)." },
      { v: d.municipios, l: "Municípios alcançados", c: "var(--muted)", tip: "Quantidade de municípios distintos com ao menos uma empresa mapeada." },
      { v: d.taxa_conversao + "%", l: "Conversão → pronto p/ venda", c: hexCor("verde"), tip: "Percentual da base que chegou a 'Pronto para venda' (÷ total de empresas)." },
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
      // Rótulos crescem junto com o zoom (raiz da escala: legível sem explodir no zoom máx.)
      this.svg.style.setProperty("--lblz", Math.sqrt(this.scale));
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
    if (a && a.credenciados) rows += `<div class="r"><span>Pronto p/ venda</span><span class="num">${a.credenciados}</span></div>`;
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
        <td class="c-tel">${tel ? esc(fmtTel(tel)) : '<span class="hint">—</span>'}</td>
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

  // ==================== PAINEL DE INDICADORES (apuração ao lado do mapa) ====================
  // Painel em tempo real inspirado na apuração eleitoral: um indicador geral de
  // destaque + cartões por estado, calculados a partir da base JÁ filtrada
  // (EMPRESAS) — então respeita e sincroniza com os filtros do mapa.
  const AP_METRICS = [
    { key: "empresas",    label: "Empresas",    tit: "TOTAL DE EMPRESAS PROSPECTADAS", cor: "azul" },
    { key: "contatadas",  label: "Contatadas",  tit: "EMPRESAS CONTATADAS",            cor: "amarelo" },
    { key: "qualificadas",label: "Qualificadas",tit: "OPORTUNIDADES QUALIFICADAS",     cor: "laranja" },
    { key: "vendas",      label: "Vendas",      tit: "VENDAS REALIZADAS",              cor: "verde" },
  ];

  // Vale 1 (ou 0) para uma empresa conforme a métrica selecionada.
  // contatadas = saiu de "Aguardando contato"; qualificadas = em cadastro/treino/parceiro/
  // contrato/pronto p/ venda (cores amarelo/laranja/verde); vendas = já fez venda.
  function apVale(e, metric) {
    const st = String(e.status || "").trim();
    const cor = corStatus(st);
    switch (metric) {
      case "contatadas":   return st && st !== "Aguardando contato" ? 1 : 0;
      case "qualificadas": return (cor === "amarelo" || cor === "laranja" || cor === "verde") ? 1 : 0;
      case "vendas":       return e.ja_vendeu ? 1 : 0;
      default:             return 1; // empresas
    }
  }

  const apPct = (p) => String(Math.round(p * 10) / 10).replace(".", ",");

  // Empresa de origem VSM (import do portal Vivensis). Só essas contam no percentual
  // de cobertura do universo VSM — as demais origens aparecem como contagem ao lado.
  const isVsm = (e) => String(e.origem_contato || "").trim().toUpperCase().startsWith("VSM");

  function renderApuracao() {
    const box = $("apuracao");
    if (!box || !B) return;
    const metric = AP_METRICS.find(m => m.key === apMetric) || AP_METRICS[0];
    const ufs = B.ufs || [];
    const ufSel = $("f-uf") ? $("f-uf").value : "";
    const corHex = hexCor(metric.cor);

    // Universo VSM por estado (meta) — vem do dashboard (constante, não filtrado).
    const universo = {};
    (DASH && DASH.cobertura_vsm || []).forEach(c => { universo[c.uf] = c.universo; });
    const universoTotal = (DASH && DASH.universo_vsm_total) || 0;

    // Agrega a base filtrada por estado para a métrica ativa. Mantém um recorte só-VSM
    // (porUFVsm/totalVsm) usado apenas na métrica "Empresas" para a cobertura do universo.
    const porUF = {}; ufs.forEach(u => porUF[u] = 0);
    const porUFVsm = {}; ufs.forEach(u => porUFVsm[u] = 0);
    let total = 0, totalVsm = 0;
    for (const e of EMPRESAS) {
      const v = apVale(e, metric.key);
      if (!v) continue;
      total += v;
      const u = String(e.uf || "").trim().toUpperCase();
      if (u in porUF) porUF[u] += v;
      if (isVsm(e)) {
        totalVsm += v;
        if (u in porUFVsm) porUFVsm[u] += v;
      }
    }
    const base = EMPRESAS.length; // total de empresas no filtro atual
    const maxUF = Math.max(1, ...ufs.map(u => porUF[u]));

    // --- Indicador geral (hero) ---
    // Na métrica "Empresas" o número grande e o % refletem SÓ origem VSM (para casar
    // com o universo); as demais origens aparecem como contagem fora do percentual.
    let sub = "", metaBar = "", bigNum = total;
    if (metric.key === "empresas") {
      bigNum = totalVsm;
      const outras = total - totalVsm;
      const outrasTxt = outras > 0
        ? `<span class="outras">+ ${outras} de outras origens (Forms/prospecção)</span>` : "";
      const pctMeta = universoTotal ? (totalVsm / universoTotal) * 100 : 0;
      sub = universoTotal
        ? `<span><b>${apPct(pctMeta)}%</b> do universo VSM</span><span>· ${totalVsm} de ${universoTotal} revendas</span>${outrasTxt}`
        : `<span>empresas VSM na seleção atual</span>${outrasTxt}`;
      metaBar = universoTotal
        ? `<div class="meta-track"><div class="meta-fill" style="width:${Math.min(100, pctMeta)}%"></div></div>` : "";
    } else {
      const pctShare = base ? (total / base) * 100 : 0;
      sub = `<span><b>${apPct(pctShare)}%</b> das ${base} empresas da seleção</span>`;
      metaBar = `<div class="meta-track"><div class="meta-fill" style="width:${Math.min(100, pctShare)}%;background:${corHex}"></div></div>`;
    }

    // --- Cartões por estado ---
    const cards = ufs.map(u => {
      const val = porUF[u];
      const nome = (B.uf_nomes && B.uf_nomes[u]) || u;
      let pct, barW, foot, topN = val;
      if (metric.key === "empresas") {
        // % = atingimento da meta estadual (cobertura do universo VSM) — só origem VSM.
        const uni = universo[u] || 0;
        const valVsm = porUFVsm[u];
        const outras = val - valVsm;
        topN = valVsm;
        pct = uni ? (valVsm / uni) * 100 : 0;
        barW = Math.min(100, pct);
        foot = `<span class="sm">${valVsm} / ${uni || "—"}${outras > 0 ? ` · +${outras} outras` : ""}</span>`;
      } else {
        // % = participação no total da métrica; barra relativa ao estado líder
        pct = total ? (val / total) * 100 : 0;
        barW = (val / maxUF) * 100;
        foot = `<span class="sm">${apPct(pct)}% do total</span>`;
      }
      const on = ufSel === u ? " on" : "";
      return `<button type="button" class="apu-state${on}" onclick="App.apSelUF('${u}')"
          title="${esc(nome)} — clique para filtrar o mapa e a lista por este estado">
        <div class="top"><span class="uf">${esc(u)}</span><span class="n">${topN}</span></div>
        <div class="track"><div class="fill" style="width:${barW}%;background:${corHex}"></div></div>
        <div class="foot">${foot}<span class="pct" style="color:${corHex}">${apPct(pct)}%</span></div>
      </button>`;
    }).join("");

    // --- Bloco "Formulários" (empresas de outras origens, fora do VSM) ---
    // Espelha o cartão principal, mas conta SÓ as empresas que não vieram do VSM
    // (origem Forms/prospecção). Só faz sentido na métrica "Empresas".
    let formsSection = "";
    if (metric.key === "empresas") {
      const formsHex = hexCor("laranja"); // cor distinta do bloco VSM (azul)
      const outrasTotal = total - totalVsm;
      const maxOutras = Math.max(1, ...ufs.map(u => porUF[u] - porUFVsm[u]));
      const formsCards = ufs
        .map(u => ({ u, n: porUF[u] - porUFVsm[u] }))
        .filter(x => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .map(({ u, n }) => {
          const nome = (B.uf_nomes && B.uf_nomes[u]) || u;
          const pct = outrasTotal ? (n / outrasTotal) * 100 : 0;
          const barW = (n / maxOutras) * 100;
          const on = ufSel === u ? " on" : "";
          return `<button type="button" class="apu-state${on}" onclick="App.apSelUF('${u}')"
              title="${esc(nome)} — empresas de formulários/prospecção neste estado; clique para filtrar o mapa e a lista">
            <div class="top"><span class="uf">${esc(u)}</span><span class="n">${n}</span></div>
            <div class="track"><div class="fill" style="width:${barW}%;background:${formsHex}"></div></div>
            <div class="foot"><span class="sm">${apPct(pct)}% do total</span><span class="pct" style="color:${formsHex}">${apPct(pct)}%</span></div>
          </button>`;
        }).join("");
      formsSection = `
        <div class="apu-hero" style="margin-top:14px;border-left:3px solid ${formsHex}">
          <div class="tt">TOTAL DE EMPRESAS DE FORMULÁRIOS</div>
          <div class="big" style="color:${formsHex}">${outrasTotal}</div>
          <div class="sub"><span>captadas fora do VSM (Forms/prospecção)</span></div>
        </div>
        <div>
          <div class="apu-sec-tt">Formulários por estado${infoIco("Empresas que não vieram do portal VSM (origem Forms/prospecção), por estado. Clique num cartão para filtrar o mapa e a lista.", "Formulários por estado")}</div>
          ${outrasTotal ? `<div class="apu-states">${formsCards}</div>` : `<div class="apu-empty">Nenhuma empresa de formulários nos filtros atuais.</div>`}
        </div>`;
    }

    const chips = AP_METRICS.map(m =>
      `<button type="button" class="${m.key === apMetric ? "on" : ""}" onclick="App.apMetrica('${m.key}')">${esc(m.label)}</button>`
    ).join("");

    box.innerHTML = `
      <div class="hd">
        <h2>Apuração da prospecção${infoIco("Indicadores em tempo real da base filtrada ao lado. Alterne a métrica e clique num estado para filtrar o mapa e a lista.", "Apuração da prospecção")}</h2>
      </div>
      <div class="bd">
        <div class="apu-metrics" role="group" aria-label="Métrica">${chips}</div>
        <div class="apu-hero">
          <div class="tt">${esc(metric.tit)}</div>
          <div class="big">${bigNum}</div>
          <div class="sub">${sub}</div>
          ${metaBar}
        </div>
        <div>
          <div class="apu-sec-tt">Prospecção por estado${infoIco("Cada cartão mostra o valor da métrica no estado e a barra de desempenho. Na métrica 'Empresas', o percentual é a cobertura do universo VSM e considera só revendas de origem VSM (as outras origens aparecem como '+N outras', fora do percentual); nas demais métricas, é a participação no total.", "Prospecção por estado")}</div>
          ${total || base ? `<div class="apu-states">${cards}</div>` : `<div class="apu-empty">Nenhuma empresa para os filtros atuais.</div>`}
        </div>
        ${formsSection}
      </div>`;
  }

  // Alterna a métrica do painel sem refazer a busca (recalcula de EMPRESAS).
  function apMetrica(m) { apMetric = m; renderApuracao(); }

  // Clique num estado do painel: filtra o mapa/lista por aquele estado (ou limpa
  // se já estava selecionado). Reaproveita o fluxo de ufMudou() para sincronizar.
  function apSelUF(uf) {
    const campo = $("f-uf");
    if (!campo) return;
    campo.value = campo.value === uf ? "" : uf; // alterna
    sel = null;                                  // zera microrregião selecionada
    const mr = $("f-mr"); if (mr) mr.value = "";
    $("map-ctx").textContent = "Concentração de empresas por microrregião · marcadores = empresas por status";
    ufMudou();
  }

  // ==================== PAINEL (dashboard) ====================
  function chart(dados, corFn, opts) {
    opts = opts || {};
    // Rótulos fora da escala: não entram no cálculo do máximo (ex.: "Sem classificação",
    // que é gigante e achataria as demais barras até sumirem). A barra deles satura em 100%.
    const foraDaEscala = opts.foraDaEscala || [];
    const base = dados.filter(d => !foraDaEscala.includes(d[0]));
    const max = Math.max(1, ...(base.length ? base : dados).map(d => d[1]));
    return `<div class="chart">` + dados.map(([lbl, v]) => {
      const pct = Math.min(100, Math.round(v / max * 100));
      // min-width garante que qualquer número > 0 continue visível mesmo sendo baixo.
      const estilo = v > 0 ? `width:${pct}%;min-width:10px;background:${corFn(lbl)}` : "width:0";
      return `<div class="row"><span class="lbl" title="${esc(lbl)}">${esc(lbl)}</span>
        <span class="track"><span class="fill" style="${estilo}"></span></span>
        <span class="val">${v}</span></div>`;
    }).join("") + `</div>`;
  }

  // Cobertura VSM: barra por estado com mapeadas / universo (revendas no portal Vivensis).
  function chartCobertura(cob) {
    if (!cob || !cob.length) return '<div class="empty">Sem universo VSM configurado.</div>';
    const corPct = p => p >= 80 ? hexCor("verde") : p >= 40 ? hexCor("amarelo") : hexCor("laranja");
    const fmtPct = p => String(p).replace(".", ",");
    return `<div class="chart cobertura">` + cob.map(c => {
      const nome = (B.uf_nomes && B.uf_nomes[c.uf]) || c.uf;
      return `<div class="row"><span class="lbl" title="${esc(nome)}">${esc(c.uf)}</span>
        <span class="track"><span class="fill" style="width:${Math.min(100, c.pct)}%;background:${corPct(c.pct)}"></span></span>
        <span class="val" title="${c.mapeadas} de ${c.universo} revendas do VSM mapeadas${c.outras > 0 ? ` · +${c.outras} de outras origens (não contam no %)` : ""}"><span class="num">${c.mapeadas} / ${c.universo}</span><span class="sep">|</span><span class="pct" style="color:${corPct(c.pct)}">${fmtPct(c.pct)}%</span></span></div>`;
    }).join("") + `</div>`;
  }

  // Origem formulários: barra por estado com as empresas captadas FORA do VSM
  // (origem ≠ "VSM Vivensis"), reaproveitando o `outras` de cada UF da cobertura.
  // Barra = volume relativo ao maior estado; indicadores = contagem | % do total.
  function chartOrigemForms(cob) {
    if (!cob || !cob.length) return '<div class="empty">Sem empresas de formulários ainda.</div>';
    const linhas = cob.map(c => ({ uf: c.uf, n: c.outras || 0 }));
    const total = linhas.reduce((s, l) => s + l.n, 0);
    if (!total) return '<div class="empty">Sem empresas de formulários ainda.</div>';
    const max = Math.max(1, ...linhas.map(l => l.n));
    const cor = hexCor("azul");
    const fmtPct = p => String(p).replace(".", ",");
    return `<div class="chart cobertura">` + linhas.map(l => {
      const nome = (B.uf_nomes && B.uf_nomes[l.uf]) || l.uf;
      const share = total ? Math.round((1000.0 * l.n) / total) / 10 : 0;
      return `<div class="row"><span class="lbl" title="${esc(nome)}">${esc(l.uf)}</span>
        <span class="track"><span class="fill" style="width:${Math.round(l.n / max * 100)}%;background:${cor}"></span></span>
        <span class="val" title="${l.n} empresa(s) de formulários em ${esc(nome)} · ${fmtPct(share)}% do total captado por formulário"><span class="num">${l.n} empresa${l.n === 1 ? "" : "s"}</span><span class="sep">|</span><span class="pct" style="color:${cor}">${fmtPct(share)}%</span></span></div>`;
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
      ["Total mapeadas", d.total], ["Potenciais", d.potenciais], ["Em andamento", d.em_negociacao],
      ["Parceiros/contrato", d.aguardando], ["Pronto p/ venda", d.credenciados], ["Perdidos/sem retorno", d.perdidos],
      ["Municípios", d.municipios], ["Microrregiões", d.microrregioes],
      ["Já venderam", d.ja_venderam || 0],
      ["Falta treinar", d.pend_treinar || 0, hexCor("azul")],
      ["Falta assinar contrato", d.pend_contrato || 0, hexCor("laranja")],
      ["Sem pendência", d.sem_pendencia || 0, hexCor("verde")],
    ];
    const statusData = B.status.map(s => [s, d.por_status[s] || 0]).filter(x => x[1] > 0);
    const ufData = B.ufs.map(u => [u, d.por_uf[u] || 0]);
    const segData = Object.entries(d.por_segmento);
    const faixaData = (B.faixas_potencial || []).map(f => [f, (d.por_faixa && d.por_faixa[f]) || 0]);
    if (d.sem_faixa) faixaData.push(["Sem classificação", d.sem_faixa]);
    const tf = d.tempos_funil || {};
    $("view-painel").innerHTML = `
      <div class="card wide"><div class="hd"><h2>Resumo geral</h2></div><div class="bd">
        <div class="statgrid">${stats.map(s => `<div class="stat"><div class="v"${s[2] ? ` style="color:${s[2]}"` : ""}>${s[1]}</div><div class="l">${esc(s[0])}</div></div>`).join("")}</div>
      </div></div>
      <div class="card"><div class="hd"><h2>Por status comercial${infoIco("Distribuição das empresas por etapa do funil comercial.", "Por status comercial")}</h2></div><div class="bd">${statusData.length ? chart(statusData, l => hexCor(corStatus(l))) : '<div class="empty">Sem dados.</div>'}</div></div>
      <div class="card"><div class="hd"><h2>Distribuição por estado</h2></div><div class="bd">${chart(ufData, () => "var(--accent)")}</div></div>
      <div class="card wide"><div class="hd"><h2>Cobertura VSM por estado${infoIco("Quanto do universo de revendas do portal Vivensis/VSM já está mapeado na base, por estado. Barra = mapeadas ÷ universo conhecido.", "Cobertura VSM")}</h2></div><div class="bd">
        ${chartCobertura(d.cobertura_vsm)}
        <div class="l" style="opacity:.7;margin-top:8px">${d.mapeadas_vsm_total || 0} de ${d.universo_vsm_total || 0} revendas do VSM mapeadas.</div>
      </div></div>
      <div class="card wide"><div class="hd"><h2>Captação por formulário por estado${infoIco("Empresas captadas pela equipe por formulário (origem diferente de VSM), por estado. Barra = volume relativo ao maior estado; % = participação no total captado por formulário.", "Captação por formulário")}</h2></div><div class="bd">
        ${chartOrigemForms(d.cobertura_vsm)}
        <div class="l" style="opacity:.7;margin-top:8px">${(d.cobertura_vsm || []).reduce((s, c) => s + (c.outras || 0), 0)} empresas captadas por formulário (origem fora do VSM).</div>
      </div></div>
      <div class="card wide"><div class="hd"><h2>Por potencial de vendas/mês${infoIco("Quantas empresas há em cada faixa de potencial de venda. 'Sem classificação' = ainda sem faixa definida.", "Por potencial")}</h2></div><div class="bd">${faixaData.some(x => x[1] > 0) ? chart(faixaData, l => (B.faixa_hex && B.faixa_hex[l]) || "var(--muted)", { foraDaEscala: ["Sem classificação"] }) : '<div class="empty">Nenhuma empresa classificada por potencial ainda.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Por segmento</h2></div><div class="bd">${segData.length ? chart(segData, () => "var(--brand2)") : '<div class="empty">Sem segmentos informados.</div>'}</div></div>
      <div class="card wide"><div class="hd"><h2>Funil de conversão${infoIco("Da base total até as empresas prontas para venda, passando pelas em andamento. A taxa mostra quantos % da base chegaram a 'Pronto para venda'.", "Funil de conversão")}</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="stat"><div class="v">${d.total}</div><div class="l">Base total</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("amarelo")}">${d.em_negociacao + d.aguardando}</div><div class="l">Em andamento</div></div>
          <div class="stat"><div class="v" style="color:${hexCor("verde")}">${d.credenciados}</div><div class="l">Pronto p/ venda (${d.taxa_conversao}%)</div></div>
        </div>
      </div></div>
      <div class="card wide"><div class="hd"><h2>Evolução mensal${infoIco("Novas empresas (leads) adicionadas e conversões (pronto para venda) fechadas a cada mês.", "Evolução mensal")}</h2></div><div class="bd">${chartMensal(d.serie_mensal)}</div></div>
      <div class="card wide"><div class="hd"><h2>Tempo médio no funil${infoIco("Dias médios entre as etapas: do lead ao 1º contato, do lead até pronto p/ venda e de pronto p/ venda à 1ª venda.", "Tempo médio no funil")}</h2></div><div class="bd">
        <div class="statgrid" style="grid-template-columns:1fr 1fr 1fr">
          ${tempoStat("Lead → 1º contato", tf.lead_contato)}
          ${tempoStat("Lead → pronto p/ venda", tf.lead_cred)}
          ${tempoStat("Pronto p/ venda → 1ª venda", tf.cred_venda)}
        </div>
      </div></div>`;
  }

  function view(v) {
    // Bloqueio de acesso à aba Gerencial (defesa em profundidade: estado/URL).
    if (v === "gerencial" && !(ME && (ME.perm_gerencial || ME.admin))) v = "mapa";
    const views = { mapa: "view-mapa", painel: "view-painel", followup: "view-followup", prospec: "view-prospec", gerencial: "view-gerencial" };
    Object.entries(views).forEach(([k, id]) => { const el = $(id); if (el) el.classList.toggle("hidden", k !== v); });
    ["mapa", "painel", "followup", "prospec", "gerencial"].forEach(k => { const t = $("tab-" + k); if (t) t.classList.toggle("on", k === v); });
    if (v === "painel") renderPainel();
    if (v === "followup") carregarFollowUp();
    if (v === "prospec") initProspec();
    if (v === "gerencial") carregarGerencial();
    fecharNav();  // fecha o menu móvel ao trocar de aba
  }

  // ==================== GERENCIAL (produtividade comercial) ====================
  const GER_PRESETS = [
    { k: "hoje", l: "Hoje" }, { k: "ontem", l: "Ontem" },
    { k: "7d", l: "Últimos 7 dias" }, { k: "30d", l: "Últimos 30 dias" },
    { k: "custom", l: "Personalizado" },
  ];
  const GER_ACAO_LBL = {
    contato: "Registro de contato", status: "Mudança de status", faixa: "Faixa de potencial",
    empresa_edit: "Edição da ficha", empresa_nova: "Nova empresa",
    filial_nova: "Nova filial", filial_remove: "Filial removida",
    contato_remove: "Contato removido", empresa_remove: "Empresa removida",
    import: "Importação (sistema)",
  };

  // Data local (Brasília aproximada pelo fuso do navegador) em YYYY-MM-DD.
  function gerHoje(off) {
    const d = new Date();
    if (off) d.setDate(d.getDate() + off);
    return d.toISOString().slice(0, 10);
  }
  // Resolve o preset em {inicio, fim}.
  function gerIntervalo() {
    switch (gerPeriodo) {
      case "hoje": return { inicio: gerHoje(0), fim: gerHoje(0) };
      case "ontem": return { inicio: gerHoje(-1), fim: gerHoje(-1) };
      case "7d": return { inicio: gerHoje(-6), fim: gerHoje(0) };
      case "30d": return { inicio: gerHoje(-29), fim: gerHoje(0) };
      case "custom":
        return { inicio: gerInicio || gerHoje(-6), fim: gerFim || gerHoje(0) };
      default: return { inicio: gerHoje(-6), fim: gerHoje(0) };
    }
  }

  async function carregarGerencial() {
    // Carrega a lista de colaboradores uma vez (para o filtro).
    if (!gerColabs.length) {
      try { gerColabs = await (await fetch("/api/gerencial/colaboradores")).json(); }
      catch (e) { gerColabs = []; }
      if (!Array.isArray(gerColabs)) gerColabs = [];
    }
    await recarregarGerencial();
  }

  async function recarregarGerencial() {
    const box = $("view-gerencial");
    box.innerHTML = `<div class="card"><div class="bd"><div class="empty">Carregando produtividade…</div></div></div>`;
    const { inicio, fim } = gerIntervalo();
    const qs = new URLSearchParams({ inicio, fim });
    if (gerUsers.length) qs.set("usuarios", gerUsers.join(","));
    let d;
    try { d = await (await fetch("/api/gerencial/produtividade?" + qs.toString())).json(); }
    catch (e) { box.innerHTML = `<div class="card"><div class="bd"><div class="empty">Não foi possível carregar a produtividade.</div></div></div>`; return; }
    if (d && d.erro) { box.innerHTML = `<div class="card"><div class="bd"><div class="empty">${esc(d.erro)}</div></div></div>`; return; }
    renderGerencial(d);
  }

  function renderGerencial(d) {
    const box = $("view-gerencial");
    const dias = d.dias || [];
    const usuarios = d.usuarios || [];
    const totalEquipe = d.total_geral || 0;

    // ---------- Barra de filtros ----------
    const presets = GER_PRESETS.map(p =>
      `<button class="ger-chip${gerPeriodo === p.k ? " on" : ""}" onclick="App.gerPreset('${p.k}')">${esc(p.l)}</button>`).join("");
    const custom = gerPeriodo === "custom" ? `
      <div class="ger-custom">
        <label>De <input type="date" id="ger-ini" value="${esc(gerInicio || d.inicio)}" onchange="App.gerCustom()"></label>
        <label>Até <input type="date" id="ger-fim" value="${esc(gerFim || d.fim)}" onchange="App.gerCustom()"></label>
      </div>` : "";
    const colabOpts = gerColabs.map(u =>
      `<label class="ger-colab"><input type="checkbox" value="${esc(u)}" ${gerUsers.includes(u) ? "checked" : ""} onchange="App.gerToggleColab('${esc(u)}', this.checked)"> ${esc(u)}</label>`).join("");
    const filtro = `
      <div class="card ger-filtros">
        <div class="bd">
          <div class="ger-frow">
            <span class="ger-flbl">Período</span>
            <div class="ger-chips">${presets}</div>
          </div>
          ${custom}
          <div class="ger-frow">
            <span class="ger-flbl">Colaboradores</span>
            <div class="ger-colabs">
              <label class="ger-colab ger-all"><input type="checkbox" ${gerUsers.length === 0 ? "checked" : ""} onchange="App.gerTodosColab(this.checked)"> Todos</label>
              ${colabOpts || '<span class="ger-empty-inline">Nenhum colaborador com atividade.</span>'}
            </div>
          </div>
        </div>
      </div>`;

    // ---------- KPIs ----------
    const kpis = `
      <div class="card wide"><div class="bd">
        <div class="statgrid">
          <div class="stat"><div class="v">${totalEquipe}</div><div class="l">Total de atualizações (equipe)</div></div>
          <div class="stat"><div class="v">${d.n_colaboradores || 0}</div><div class="l">Colaboradores ativos</div></div>
          <div class="stat"><div class="v">${(d.media_diaria_por_colab != null ? d.media_diaria_por_colab : 0)}</div><div class="l">Média diária por colaborador</div></div>
          <div class="stat"><div class="v">${dias.length}</div><div class="l">Dias no período</div></div>
        </div>
      </div></div>`;

    if (!totalEquipe) {
      box.innerHTML = filtro + kpis +
        `<div class="card wide"><div class="bd"><div class="empty">Nenhuma atualização registrada no período selecionado.</div></div></div>`;
      return;
    }

    // ---------- Tabela colaborador × dia ----------
    const thDias = dias.map(dd => `<th class="num">${esc(rotuloDia(dd))}</th>`).join("");
    const maxCel = Math.max(1, ...usuarios.flatMap(u => dias.map(dd => (d.matriz[u] && d.matriz[u][dd]) || 0)));
    const linhas = usuarios.map(u => {
      const cels = dias.map(dd => {
        const n = (d.matriz[u] && d.matriz[u][dd]) || 0;
        const int = n ? (0.12 + 0.6 * (n / maxCel)) : 0;
        const bg = n ? ` style="background:rgba(47,111,208,${int.toFixed(2)})"` : "";
        return `<td class="num ger-cel"${bg}>${n || ""}</td>`;
      }).join("");
      return `<tr><td class="ger-nome">${esc(u)}</td>${cels}<td class="num ger-tot">${d.totais_por_usuario[u] || 0}</td></tr>`;
    }).join("");
    const rodape = dias.map(dd => `<td class="num ger-tot">${d.totais_por_dia[dd] || 0}</td>`).join("");
    const tabela = `
      <div class="card wide"><div class="hd"><h2>Produtividade por colaborador${infoIco("Cada célula é a quantidade de atualizações que o colaborador fez naquele dia (horário de Brasília). Várias ações no MESMO parceiro num intervalo de até 10 min (ex.: mudar status + registrar contato + editar a ficha na mesma visita) contam como 1. Se voltar ao mesmo parceiro mais tarde no dia, conta de novo. O detalhe de cada ação fica na aba de atividades. A cor fica mais forte quanto maior o volume.", "Produtividade por colaborador")}</h2></div>
        <div class="bd ger-tablewrap">
          <table class="ger-table">
            <thead><tr><th>Colaborador</th>${thDias}<th class="num">Total</th></tr></thead>
            <tbody>${linhas}</tbody>
            <tfoot><tr><td class="ger-nome">Total da equipe</td>${rodape}<td class="num ger-tot">${totalEquipe}</td></tr></tfoot>
          </table>
        </div>
      </div>`;

    // ---------- Gráfico de produtividade diária ----------
    const serieDia = dias.map(dd => ({ dia: dd, n: d.totais_por_dia[dd] || 0 }));
    const grafDia = `
      <div class="card wide"><div class="hd"><h2>Produtividade diária (equipe)${infoIco("Total de atualizações de toda a equipe por dia no período.", "Produtividade diária")}</h2></div>
        <div class="bd">${chartDiario(serieDia)}</div></div>`;

    // ---------- Ranking ----------
    const grafRank = `
      <div class="card"><div class="hd"><h2>Ranking de colaboradores${infoIco("Total de atualizações de cada colaborador no período, do maior para o menor.", "Ranking")}</h2></div>
        <div class="bd">${chartRanking(d.ranking || [])}</div></div>`;

    box.innerHTML = filtro + kpis +
      `<div class="ger-grid">${grafDia}${grafRank}</div>` + tabela +
      `<div class="card wide"><div class="hd"><h2>Histórico de atividades${infoIco("Cada ação registrada no período, com autor, data/hora e o que mudou. Rastreabilidade: uma linha por ação.", "Histórico de atividades")}</h2></div>
        <div class="bd" id="ger-ativ"><div class="empty">Carregando histórico…</div></div></div>`;
    carregarAtividades();
  }

  // Gráfico de barras verticais: produtividade diária (reusa o visual do .vchart).
  function chartDiario(serie) {
    if (!serie || !serie.length) return '<div class="empty">Sem dados.</div>';
    const max = Math.max(1, ...serie.map(s => s.n));
    const cols = serie.map(s => {
      const h = Math.round(s.n / max * 100);
      return `<div class="vcol">
        <div class="vbars"><span class="vbar lead" style="height:${h}%" title="${s.n} atualização(ões) em ${esc(rotuloDia(s.dia))}"><em>${s.n || ""}</em></span></div>
        <div class="vlbl">${esc(rotuloDia(s.dia))}</div>
      </div>`;
    }).join("");
    return `<div class="vchart">${cols}</div>`;
  }

  // Ranking: barras horizontais por colaborador.
  function chartRanking(ranking) {
    if (!ranking || !ranking.length) return '<div class="empty">Sem dados.</div>';
    const max = Math.max(1, ...ranking.map(r => r.total));
    return `<div class="ger-rank">` + ranking.map(r => {
      const w = Math.round(r.total / max * 100);
      return `<div class="ger-rank-row">
        <span class="ger-rank-nome">${esc(r.usuario)}</span>
        <span class="ger-rank-bar"><i style="width:${w}%"></i></span>
        <span class="ger-rank-val">${r.total}</span>
      </div>`;
    }).join("") + `</div>`;
  }

  async function carregarAtividades() {
    const alvo = $("ger-ativ");
    if (!alvo) return;
    const { inicio, fim } = gerIntervalo();
    const qs = new URLSearchParams({ inicio, fim, limit: "120" });
    if (gerUsers.length) qs.set("usuarios", gerUsers.join(","));
    let rows;
    try { rows = await (await fetch("/api/gerencial/atividades?" + qs.toString())).json(); }
    catch (e) { alvo.innerHTML = `<div class="empty">Não foi possível carregar o histórico.</div>`; return; }
    if (!Array.isArray(rows) || !rows.length) { alvo.innerHTML = `<div class="empty">Sem atividades no período.</div>`; return; }
    const linhas = rows.map(r => `
      <tr>
        <td class="nowrap">${esc(fmtData(r.ts))}</td>
        <td>${esc(r.usuario || "—")}</td>
        <td>${esc(GER_ACAO_LBL[r.acao] || r.acao)}${r.origem === "sistema" ? ' <span class="ger-tag-sis">sistema</span>' : ""}</td>
        <td>${esc(r.empresa_nome || (r.empresa_id ? "#" + r.empresa_id : "—"))}</td>
        <td>${esc(r.campo || "")}</td>
      </tr>`).join("");
    alvo.innerHTML = `
      <div class="ger-tablewrap">
        <table class="ger-table ger-ativ-table">
          <thead><tr><th>Data/hora</th><th>Colaborador</th><th>Ação</th><th>Empresa</th><th>Campo</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  // Rótulo curto de dia: "16/11". Ou "qua 16/11" quando o período é longo não é necessário.
  function rotuloDia(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}` : String(iso || "");
  }

  // ---- interações dos filtros ----
  function gerPreset(k) { gerPeriodo = k; recarregarGerencial(); }
  function gerCustom() {
    const i = $("ger-ini"), f = $("ger-fim");
    if (i) gerInicio = i.value;
    if (f) gerFim = f.value;
    recarregarGerencial();
  }
  function gerToggleColab(u, on) {
    if (on) { if (!gerUsers.includes(u)) gerUsers.push(u); }
    else { gerUsers = gerUsers.filter(x => x !== u); }
    recarregarGerencial();
  }
  function gerTodosColab(on) {
    if (on) gerUsers = [];
    recarregarGerencial();
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

  // Filtros do follow-up: um único handler, roteado pelo id do <select>.
  function fuFiltrar(id, v) {
    v = v || "";
    if (id === "fu-resp") fuResp = v || null;
    else if (id === "fu-uf") fuUF = v;
    else if (id === "fu-status") fuStatus = v;
    else if (id === "fu-origem") fuOrigem = v;
    else if (id === "fu-vendeu") fuVendeu = v;
    else if (id === "fu-faixa") fuFaixa = v;
    else if (id === "fu-pend") fuPend = v;
    renderFollowUp();
  }

  // Busca por nome: re-renderiza e devolve o foco/cursor ao campo (senão
  // o input perderia o foco a cada tecla por causa do innerHTML).
  function fuBuscar(v) {
    fuBusca = v || "";
    renderFollowUp();
    const inp = $("fu-busca");
    if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (e) {} }
  }

  function renderFollowUp() {
    const box = $("fu-body");
    const d = FU;
    if (!d) return;
    if (!d.total) {
      box.innerHTML = `<div class="empty">Tudo em dia 🎉 — nenhuma ação vencida ou pendente. Marque a "próxima ação" dos prospects na ficha para acompanhá-los aqui.</div>`;
      return;
    }
    // Valores presentes no follow-up (para popular os filtros dinamicamente)
    const todos = FU_GRUPOS.flatMap(g => d[g.k] || []);
    const ufs = [...new Set(todos.map(x => x.uf).filter(Boolean))].sort();
    const resps = [...new Set(todos.map(x => x.responsavel).filter(Boolean).concat(fuResp ? [fuResp] : []))].sort();
    const statuses = [...new Set(todos.map(x => x.status).filter(Boolean).concat(fuStatus ? [fuStatus] : []))].sort();
    const faixas = [...new Set(todos.map(x => x.faixa_potencial).filter(Boolean).concat(fuFaixa ? [fuFaixa] : []))].sort();
    // Origens: agrupadas pela etiqueta padronizada (VSM, Formulário, Prospecção…).
    const origens = [...new Set(todos.map(x => { const o = origemInfo(x.origem_contato); return o ? o.label : ""; }).filter(Boolean).concat(fuOrigem ? [fuOrigem] : []))].sort();
    const sel = (id, label, val, opts) => `
        <label class="fu-filtro">${label}
          <select id="${id}" onchange="App.fuFiltrar('${id}', this.value)">
            <option value="">Todos</option>
            ${opts.map(o => { const v = typeof o === "string" ? o : o.v, t = typeof o === "string" ? o : o.t;
              return `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(t)}</option>`; }).join("")}
          </select>
        </label>`;
    const filtro = `
      <div class="fu-toolbar">
        <label class="fu-filtro fu-busca-wrap">Buscar
          <input id="fu-busca" type="search" class="fu-busca" placeholder="Nome da empresa…"
                 value="${esc(fuBusca)}" oninput="App.fuBuscar(this.value)" autocomplete="off">
        </label>
        ${sel("fu-resp", "Responsável", fuResp || "", resps)}
        ${sel("fu-uf", "Estado", fuUF, ufs)}
        ${sel("fu-status", "Status", fuStatus, statuses)}
        ${sel("fu-origem", "Origem", fuOrigem, origens)}
        ${sel("fu-vendeu", "Fez venda", fuVendeu, [{ v: "1", t: "Sim" }, { v: "0", t: "Não" }])}
        ${sel("fu-pend", "Pendência VSM", fuPend, [{ v: "treinar", t: "Falta treinar" }, { v: "contrato", t: "Falta assinar contrato" }, { v: "sem", t: "Sem pendência" }])}
        ${sel("fu-faixa", "Potencial", fuFaixa, faixas)}
      </div>`;
    const buscaN = norm(fuBusca);
    const passa = (x) => {
      if (buscaN && !norm(x.nome).includes(buscaN)) return false;
      if (fuResp && (x.responsavel || "") !== fuResp) return false;
      if (fuUF && (x.uf || "") !== fuUF) return false;
      if (fuStatus && (x.status || "") !== fuStatus) return false;
      if (fuFaixa && (x.faixa_potencial || "") !== fuFaixa) return false;
      if (fuVendeu === "1" && !(x.ja_vendeu === 1 || x.ja_vendeu === true)) return false;
      if (fuVendeu === "0" && (x.ja_vendeu === 1 || x.ja_vendeu === true)) return false;
      if (fuPend) {
        // pendencia_vsm pode ser "Falta treinar e assinar contrato" (soma as duas);
        // por isso o match é por trecho, não igualdade exata.
        const p = String(x.pendencia_vsm || "").toLowerCase();
        if (fuPend === "treinar" && !p.includes("treinar")) return false;
        if (fuPend === "contrato" && !(p.includes("contrato") || p.includes("assinar"))) return false;
        if (fuPend === "sem" && !(p.includes("sem pend"))) return false;
      }
      if (fuOrigem) { const o = origemInfo(x.origem_contato); if (!o || o.label !== fuOrigem) return false; }
      return true;
    };
    const corpo = FU_GRUPOS.map(g => {
      const lista = (d[g.k] || []).filter(passa);
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
    box.innerHTML = filtro + (corpo || `<div class="empty">Nenhum prospect com os filtros aplicados.</div>`);
  }

  function atualizarBadgeFollowUp(d) {
    const el = $("tab-followup-badge");
    if (!el) return;
    const urgentes = (d.contagem && (d.contagem.vencidas + d.contagem.hoje)) || 0;
    if (urgentes > 0) { el.textContent = urgentes; el.hidden = false; }
    else { el.hidden = true; }
  }

  // Identificação visual por origem de aquisição. Cada origem tem uma cor fixa
  // e padronizada (classe CSS .fu-org.org-*). O match é por palavra-chave sobre
  // a origem normalizada, para que variações e NOVOS contatos caiam na cor certa
  // automaticamente. Laranja fica reservado ao "retorno no dia" (grupo Para hoje).
  function origemInfo(origem) {
    const n = String(origem || "").trim().toLowerCase();
    if (!n) return null; // sem origem cadastrada: não polui a lista
    if (n.includes("vsm"))                      return { cls: "org-vsm",    label: "VSM" };
    if (n.includes("formul"))                   return { cls: "org-form",   label: "Formulário" };
    if (n.includes("prospec"))                  return { cls: "org-prosp",  label: "Prospecção" };
    if (n.includes("indica"))                   return { cls: "org-indic",  label: "Indicação" };
    if (n.includes("evento"))                   return { cls: "org-evento", label: "Evento" };
    if (n.includes("inbound") || n.includes("site")) return { cls: "org-inbound", label: "Inbound" };
    if (n.includes("parceiro"))                 return { cls: "org-parc",   label: "Parceiro" };
    return { cls: "org-outro", label: origem }; // demais origens cadastradas
  }

  function origemBadge(origem) {
    const o = origemInfo(origem);
    if (!o) return "";
    return `<span class="fu-org ${o.cls}" title="Origem: ${esc(origem)}">${esc(o.label)}</span>`;
  }

  // Tag compacta de fundo suave (texto colorido sobre tinta clara da mesma cor).
  function tagSuave(txt, hex, title) {
    return `<span class="fu-tag-vsm" title="${esc(title || txt)}" style="color:${hex};background:${hex}1f;border:1px solid ${hex}3d">${esc(txt)}</span>`;
  }

  // Tags VSM do card, a partir dos dados da Capilaridade-vsm + perfil comercial:
  //   1) Pendência (treino/contrato) — cor por classificação; neutra se vazia.
  //   2) Já fez venda (perfil comercial).
  //   3) Vendas concluídas (vendas_vsm) — só quando > 0.
  //   4) Instalações executadas (instalacoes_vsm) — só quando > 0.
  // Usa exatamente os dados já cadastrados na ficha (nada é calculado aqui).
  function tagsVSM(x) {
    const t = [];
    const p = String(x.pendencia_vsm || "").trim();
    if (p) t.push(tagSuave(p, corPendencia(p), "Pendência VSM: " + p));
    else   t.push(tagSuave("Sem classificação", hexCor("cinza"), "Pendência VSM não classificada"));

    const vendeu = x.ja_vendeu === 1 || x.ja_vendeu === true || x.ja_vendeu === "1";
    t.push(vendeu
      ? tagSuave("✓ Já fez venda", hexCor("verde"), "Já fez venda: Sim")
      : tagSuave("Sem venda", hexCor("cinza"), "Já fez venda: Não"));

    const v = Number(x.vendas_vsm) || 0;
    const i = Number(x.instalacoes_vsm) || 0;
    if (v > 0) t.push(tagSuave(`${v} ${v === 1 ? "venda" : "vendas"}`, "#0d8a74", `Vendas concluídas (VSM): ${v}`));
    if (i > 0) t.push(tagSuave(`${i} ${i === 1 ? "instalação" : "instalações"}`, "#5b4fd1", `Instalações executadas (VSM): ${i}`));
    return t.join("");
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
          <div class="fu-head"><b>${esc(x.nome)}</b>${origemBadge(x.origem_contato)}${tagsVSM(x)}</div>
          <span class="fu-meta">${esc(loc)}${x.status ? " · " + esc(x.status) : ""}${x.responsavel ? " · " + esc(x.responsavel) : ""}</span>
          ${acao}
        </div>
        <div class="fu-side">
          ${bits.join("")}
          ${tel ? `<span class="fu-tel">${esc(fmtTel(tel))}</span>` : ""}
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
    if (tel) linhas.push(`<div class="pl"><span>${x.whatsapp ? "WhatsApp" : "Telefone"}</span><b>${esc(fmtTel(tel))}</b></div>`);
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
        <td class="c-tel">${tel ? esc(fmtTel(tel)) : '<span class="hint">—</span>'}</td>
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
    if (f.type === "vsm") {
      const tem = val != null && String(val).trim() !== "";
      // Já definido → somente leitura (não pode alterar). Em branco → editável
      // (a revenda vai receber um ID VSM no futuro, ao ser credenciada).
      return tem
        ? `<div class="${cls}"><label>${f.l}${ico}</label><input type="text" id="${id}" value="${esc(val)}" readonly disabled title="Definido no credenciamento — não editável." style="background:var(--soft);color:var(--muted);cursor:not-allowed"></div>`
        : `<div class="${cls}"><label>${f.l}${ico}</label><input type="text" id="${id}" value="" placeholder="Em branco até o credenciamento"></div>`;
    }
    if (f.tel) {
      // Telefone: valor inicial já formatado, máscara em tempo real (data-mask) e
      // placeholder guiando o padrão BR. data-cel marca campos que exigem celular.
      const ph = f.cel ? "(62) 99999-9999" : "(62) 99999-9999 ou (62) 3333-4444";
      return `<div class="${cls}"><label class="${f.req ? "req" : ""}">${f.l}${ico}</label><input type="text" id="${id}" inputmode="tel" data-mask="tel"${f.cel ? ' data-cel="1"' : ""} placeholder="${ph}" value="${esc(fmtTel(val))}"></div>`;
    }
    const t = f.type === "num" ? "number" : f.type === "date" ? "date" : "text";
    return `<div class="${cls}"><label class="${f.req ? "req" : ""}">${f.l}${ico}</label><input type="${t}" id="${id}" value="${esc(val ?? "")}"></div>`;
  }

  function formHTML(e) {
    return FORM.map(sec => `<div class="sec"><h4>${sec.t}</h4><div class="grid2">${sec.f.map(f => fieldHTML(f, e ? e[f.k] : "")).join("")}</div></div>`).join("");
  }

  function kv(label, val) { return val ? `<dt>${esc(label)}</dt><dd>${esc(val)}</dd>` : ""; }

  // Paleta extra p/ classificações de pendência fora da lista conhecida —
  // garante que QUALQUER valor novo da planilha ganhe uma cor própria e estável
  // (determinística pelo texto), em vez de cair todo mundo em cinza.
  const PEND_EXTRA_HEX = ["#7b3fc4", "#0d8a74", "#c43f7b", "#1783b0", "#5b4fd1", "#b26a00"];
  function hashCor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return PEND_EXTRA_HEX[Math.abs(h) % PEND_EXTRA_HEX.length];
  }

  // Cor do badge de pendência (planilha Capilaridade-vsm, coluna I).
  // Os 4 status conhecidos têm cor fixa; valores novos recebem cor automática.
  function corPendencia(p) {
    const s = String(p || "").trim();
    switch (s) {
      case "": return hexCor("cinza");
      case "Sem pendência": return hexCor("verde");
      case "Falta assinar contrato": return hexCor("laranja");
      case "Falta treinar": return hexCor("azul");
      case "Falta treinar e assinar contrato": return hexCor("vermelho");
      default: return hashCor(s);
    }
  }

  // Bloco read-only com os dados do VSM (pendência + vendas + instalações).
  // Só aparece quando a empresa foi casada com a planilha de capilaridade.
  function capilaridadeVSM(e) {
    const temPend = !!(e.pendencia_vsm && String(e.pendencia_vsm).trim());
    const v = Number(e.vendas_vsm) || 0;
    const i = Number(e.instalacoes_vsm) || 0;
    if (!temPend && !v && !i) return "";
    const badge = temPend
      ? `<span style="display:inline-flex;align-items:center;font-size:12.5px;font-weight:700;border-radius:20px;padding:4px 12px;white-space:nowrap;color:#fff;background:${corPendencia(e.pendencia_vsm)}">${esc(e.pendencia_vsm)}</span>`
      : "";
    return `<div class="sec"><h4>Capilaridade VSM${infoIco("Dados do parceiro no VSM (planilha Vivensis): pendência de treino/contrato, vendas concluídas e instalações executadas. Atualizado por importação — não editável aqui.", "Capilaridade VSM")}</h4>
      <dl class="kv">
        ${temPend ? `<dt>Pendência</dt><dd>${badge}</dd>` : ""}
        ${kv("Vendas concluídas", v)}${kv("Instalações executadas", i)}
      </dl></div>`;
  }

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
    if (e.possui_estoque) chips.push("Possui estoque");
    const contatos = (e.contatos || []).map(c => {
      // Carimbo automático: quem registrou no sistema e o momento exato do registro.
      const carimbo = c.criado_por
        ? "registrado por " + esc(c.criado_por) + (c.criado_em ? " · " + esc(fmtData(c.criado_em)) : "")
        : (c.criado_em ? "registrado em " + esc(fmtData(c.criado_em)) : "");
      return `
      <div class="tl"><div class="m">${esc(fmtData(c.data) || c.data || "")} · ${esc(c.tipo || "")}${c.responsavel ? " · " + esc(c.responsavel) : ""}</div>
      <div class="x">${esc(c.resumo || "")}</div>
      ${c.proxima_acao ? `<div class="m">→ ${esc(c.proxima_acao)} ${c.proxima_acao_data ? "(" + esc(c.proxima_acao_data) + ")" : ""}</div>` : ""}
      ${carimbo ? `<div class="m" style="opacity:.72;font-size:11.5px">${carimbo}</div>` : ""}</div>`;
    }).join("");
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
          ${kv("CNPJ", e.cnpj)}${kv("Telefone", fmtTel(e.telefone_comercial))}${kv("WhatsApp", fmtTel(e.whatsapp))}
          ${kv("E-mail", e.email_comercial)}${kv("Site/Insta", e.site_instagram)}
          ${kv("Endereço", e.endereco)}${kv("Cidade", (e.cidade || "") + (e.uf ? " · " + e.uf : ""))}${kv("Microrregião", e.microrregiao)}
        </dl></div>

      <div class="sec"><h4>Responsável</h4><dl class="kv">
        ${kv("Nome", e.resp_nome)}${kv("Cargo", e.resp_cargo)}${kv("Telefone", fmtTel(e.resp_telefone))}${kv("E-mail", e.resp_email)}
      </dl></div>

      <div class="sec"><h4>Perfil comercial</h4>
        ${chips.length ? `<div class="chips">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
        <dl class="kv" style="margin-top:8px">
          ${kv("Segmento", e.segmento)}${kv("Produtos", e.produtos)}${kv("Interesse", e.interesse_parceiro)}
          ${kv("Potencial", e.faixa_potencial)}${kv("Já fez venda?", e.ja_vendeu ? "Sim" : "Não")}
          ${kv("Capacidade/mês", e.capacidade_vendas_mes)}${kv("Filiais", e.qtd_filiais)}${kv("Origem", e.origem_contato)}
          ${kv("Canal", e.canal)}${kv("Responsável interno", e.responsavel)}${kv("Prioridade", e.prioridade)}
          ${kv("Status Vivensis", e.status_vivensis)}${kv("ID VSM", e.id_vsm)}
        </dl></div>

      ${capilaridadeVSM(e)}

      ${e.observacoes ? `<div class="sec"><h4>Observações</h4><div>${esc(e.observacoes)}</div></div>` : ""}

      <div class="sec"><h4>Filiais / unidades</h4>
        ${filiais || '<span class="hint">Nenhuma filial cadastrada.</span>'}
        <div class="grid2" style="margin-top:10px">
          <div class="fld"><input id="fil-nome" placeholder="Nome/identificação"></div>
          <div class="fld"><input id="fil-cidade" placeholder="Cidade"></div>
          <div class="fld"><input id="fil-uf" placeholder="UF" maxlength="2"></div>
          <div class="fld"><input id="fil-tel" inputmode="tel" data-mask="tel" placeholder="(62) 99999-9999"></div>
        </div>
        <button class="btn" style="margin-top:8px;background:var(--soft);color:var(--brand)" onclick="App.addFilial()">+ Adicionar filial</button>
      </div>

      <div class="sec"><h4>Histórico de contatos${infoIco("Registre cada ligação, visita ou mensagem. A 'próxima ação' informada aqui alimenta o Follow-up e a data do último contato.", "Histórico de contatos")}</h4>
        <div class="timeline">${contatos || '<span class="hint">Sem registros ainda.</span>'}</div>

        <button class="btn" id="ct-abrir" style="margin-top:12px;background:var(--soft);color:var(--brand)" onclick="App.novoContato()">+ Registrar contato</button>

        <div id="ct-form" style="display:none;margin-top:12px">
          <div class="grid2">
            <div class="fld"><label class="req">Tipo</label><select id="ct-tipo">${selOpts(B.tipos_contato, "")}</select></div>
            <div class="fld"><label class="req">Data</label><input type="date" id="ct-data"></div>
            <div class="fld"><label>Responsável</label><select id="ct-resp">${selOpts(B.responsaveis, "— eu (quem registra) —")}</select></div>
            <div class="fld"><label class="req">Próxima ação (data)</label><input type="date" id="ct-pad"></div>
            <div class="fld full"><label class="req">Resumo</label><input id="ct-resumo" placeholder="O que aconteceu neste contato"></div>
            <div class="fld full"><label class="req">Próxima ação</label><input id="ct-pa" placeholder="O que fazer a seguir"></div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
            <button class="btn" style="background:var(--soft);color:var(--brand)" onclick="App.cancelarContato()">Cancelar</button>
            <button class="btn primary" id="ct-salvar" onclick="App.addContato()">Salvar atualização</button>
          </div>
        </div>
      </div>`;
  }

  function renderDrawer() {
    const e = cur;
    const nova = !e || !e.id;
    const nome = nova ? "Novo lojista" : (e.nome_fantasia || e.razao_social || "Empresa");
    const sub = nova ? "Preencha os dados e salve" :
      `${esc(e.codigo || "")}${e.cidade ? " · " + esc(e.cidade) : ""}${e.uf ? " · " + e.uf : ""}`;
    // Gating por papel (RBAC): consulta = somente leitura; excluir empresa = só admin.
    // O backend é a autoridade — isto é apenas UX (esconder o que não pode usar).
    const consulta = !!(ME && ME.papel === "consulta");
    const corpo = (!consulta && (editMode || nova)) ? formHTML(e) : viewHTML(e);
    let footer;
    if (consulta) {
      footer = `<span class="df-ro" style="color:var(--muted);font-size:13px">Perfil <b>Consulta</b> · somente leitura</span>`;
    } else if (editMode || nova) {
      footer = `<button class="btn primary" onclick="App.salvar()">Salvar</button>
         ${nova ? "" : `<button class="btn" style="background:var(--soft);color:var(--brand)" onclick="App.verFicha()">Cancelar</button>`}`;
    } else {
      footer = `<button class="btn primary" onclick="App.editarFicha()">Editar dados</button>`;
    }
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
    // Só há campos editáveis quando a ficha está em modo de edição/cadastro.
    if (!consulta && (editMode || nova)) wireSegmentoAuto();
  }

  // Auto-atribuição do varejo (Sunamita): todo lojista de "Móveis e eletro" é,
  // por definição, do canal Varejo (mercantil) e da carteira da Sunamita. Ao
  // escolher esse segmento na ficha, preenchemos canal + responsável sozinhos —
  // elimina o esquecimento de marcar o canal (hoje manual). Não é destrutivo:
  // o responsável só é preenchido se estiver vazio, e os selects seguem editáveis.
  const SEG_VAREJO = "Móveis e eletro";
  const CANAL_VAREJO = "Varejo (mercantil)";
  const RESP_VAREJO = "Sunamita";
  function temOpcao(sel, val) {
    return !!sel && Array.from(sel.options).some(o => o.value === val);
  }
  function wireSegmentoAuto() {
    const seg = $("fld-segmento");
    if (!seg) return;
    seg.addEventListener("change", () => {
      if (seg.value !== SEG_VAREJO) return;
      const canal = $("fld-canal"), resp = $("fld-responsavel");
      const mudou = [];
      // Canal é definicional do segmento → sempre alinha para Varejo.
      if (temOpcao(canal, CANAL_VAREJO) && canal.value !== CANAL_VAREJO) {
        canal.value = CANAL_VAREJO; mudou.push("canal Varejo (mercantil)");
      }
      // Responsável: só preenche se estiver vazio, para não tomar de alguém
      // que já esteja nomeado como responsável nesta ficha.
      if (temOpcao(resp, RESP_VAREJO) && !resp.value) {
        resp.value = RESP_VAREJO; mudou.push("responsável Sunamita");
      }
      if (mudou.length) toast("Móveis e eletro → " + mudou.join(" e ") + " (automático).");
    });
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
    // Telefones: bloqueia incompletos/inválidos. Legado inalterado (mesmo número já
    // gravado) não trava a edição de outros campos.
    const telErros = [];
    FORM.forEach(sec => sec.f.forEach(f => {
      if (!f.tel) return;
      const d = telDigitos(dados[f.k] || "");
      if (!d) return;
      if (telValido(d, !!f.cel)) return;
      if (cur && d === telDigitos(cur[f.k])) return; // legado inalterado
      telErros.push(f.l);
    }));
    if (telErros.length) { toast("Telefone inválido: " + telErros.join(", ") + ". Use DDD + número (celular com 9 dígitos)."); return; }
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

  // Abre o formulário de novo contato (passo 1). O registro só é efetivado
  // ao clicar em "Salvar atualização" (App.addContato).
  function novoContato() {
    const f = $("ct-form"); if (f) f.style.display = "";
    const b = $("ct-abrir"); if (b) b.style.display = "none";
    const t = $("ct-tipo"); if (t) t.focus();
  }
  function cancelarContato() {
    const f = $("ct-form"); if (f) f.style.display = "none";
    const b = $("ct-abrir"); if (b) b.style.display = "";
    ["ct-tipo", "ct-data", "ct-resp", "ct-pad", "ct-resumo", "ct-pa"].forEach(id => {
      const el = $(id); if (!el) return;
      if (el.tagName === "SELECT") el.selectedIndex = 0; else el.value = "";
    });
  }
  async function addContato() {
    const btn = $("ct-salvar");
    const body = {
      tipo: $("ct-tipo").value, data: $("ct-data").value, responsavel: $("ct-resp").value,
      resumo: $("ct-resumo").value, proxima_acao: $("ct-pa").value, proxima_acao_data: $("ct-pad").value,
    };
    const faltando = [];
    if (!body.tipo) faltando.push("Tipo");
    if (!body.data) faltando.push("Data");
    if (!body.proxima_acao_data) faltando.push("Próxima ação (data)");
    if (!body.resumo.trim()) faltando.push("Resumo");
    if (!body.proxima_acao.trim()) faltando.push("Próxima ação");
    if (faltando.length) { toast("Preencha: " + faltando.join(", ") + "."); return; }
    if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
    try {
      const r = await fetch("/api/empresas/" + cur.id + "/contatos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const js = await r.json().catch(() => ({}));
        toast(js.erro || "Não foi possível registrar o contato.");
        if (btn) { btn.disabled = false; btn.textContent = "Salvar atualização"; }
        return;
      }
      toast("Contato registrado.");
      // Mantém a ficha aberta: recarrega a base por baixo e re-renderiza a ficha,
      // que volta ao estado inicial (formulário fechado) já com o novo contato na timeline.
      await recarregar();
      await abrirFicha(cur.id);
    } catch (e) {
      toast("Não foi possível registrar o contato.");
      if (btn) { btn.disabled = false; btn.textContent = "Salvar atualização"; }
    }
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
    novoContato, cancelarContato, addContato, delContato, addFilial, delFilial, excluir, realce,
    apMetrica, apSelUF,
    exportar, modelo, abrirImport, fazerImport,
    pUfMudou, sugProspec, sugProspecSocial, buscarProspec, salvarProspec, salvarTodosProspec,
    varreduraAgora, fuFiltrar, fuBuscar,
    salvarPendente, descartarPendente, salvarTodosPendentes, descartarTodosPendentes,
    renderHist, abrirPesquisa, repesquisar, excluirPesquisa,
    navToggle,
    toggleUserMenu, abrirTrocarSenha, salvarSenha, abrirUsuarios, addUsuario, resetUsuario, delUsuario, fecharModal,
    toggleGerencial, gerPreset, gerCustom, gerToggleColab, gerTodosColab,
    setPapel, abrirMinhasSessoes, logoutAll, abrirSeguranca, segAba, segRevogar,
  };
})();

document.addEventListener("DOMContentLoaded", App.init);
