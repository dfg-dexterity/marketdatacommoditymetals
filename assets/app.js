/*
 * Cotação de Metais — script da página. Catálogo, conversões, curva e exportações vêm de lib/, os mesmos
 * módulos que as funções de /api e os testes usam; aqui fica só o que mexe na tela.
 *
 * Parâmetros de URL:
 *   ?embed=1          modo incorporado (iframe no site ou no Notion): sem título nem rodapé
 *   ?metal=cobre      abre direto no metal (sem ele, o painel com todos)
 *   ?moeda=BRL        USD, BRL, CNY ou original
 *   ?unidade=t        t, kg, g, lb, oz ou original
 *   ?praca=comex      praça da curva de preços
 */
import { METAIS, metalDe, pracaDe, instrumentoDe, pracaAtiva, nomeCurto } from "../lib/catalogo.js";
import { converterPreco, cotacaoDestino, rotuloCotacao, fatorUnidade, variacaoPct, casasDoPreco, UNIDADES, MOEDAS } from "../lib/unidades.js";
import { analisarCurva, interpolarPreco, nomeEstrutura } from "../lib/curva.js";
import { cotacoesDoMetal, linhasDoPainel, curvaDoMetal, pracasComCurva, mediasMensais } from "../lib/painel.js";
import { fmtData, rotuloMes, somarDias, somarMesesAoDia, hojeEm, mesDe, dataValida, compacta } from "../lib/datas.js";
import { fmtNum, fmtInteiro, fmtPreco, fmtPct, fmtDiferenca, seta, classeDir } from "../lib/formatos.js";
import { COLUNAS_SAP, LARGURAS_SAP, unidadeSapSugerida, validarCamposSap, linhasSap, chavesRepetidasSap, textoCsv, nomeDeArquivo } from "../lib/exportacao.js";
import { taxaVigente } from "../lib/bcb.js";

const PARAMS = new URLSearchParams(location.search);

// Moldura do site (assets/moldura.js). Se o arquivo não carregar, os diálogos seguem funcionando.
const Moldura = window.Moldura || {
  embutido: false,
  abrirModal(el) { el.hidden = false; const b = el.querySelector("button, input, select"); if (b) b.focus(); },
  fecharModal(el) { if (el) el.hidden = true; },
  aviso() {}
};

// localStorage pode lançar exceção em iframe de terceiros ou com bloqueio de dados do site
const armazenamento = {
  ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* segue sem lembrar */ } }
};
function lerJson(chave) {
  try { return JSON.parse(armazenamento.ler(chave) || "{}") || {}; } catch (e) { return {}; }
}

// Bibliotecas pesadas só descem quando são usadas (o SheetJS sozinho tem ~900 KB)
const LIBS = { XLSX: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" };
const libsPendentes = {};
function carregarLib(nome) {
  if (window[nome]) return Promise.resolve(window[nome]);
  if (!libsPendentes[nome]) {
    libsPendentes[nome] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIBS[nome];
      s.async = true;
      s.onload = () => (window[nome] ? resolve(window[nome]) : reject(new Error(`${nome} indisponível`)));
      s.onerror = () => { delete libsPendentes[nome]; s.remove(); reject(new Error(`falha ao baixar ${nome}`)); };
      document.head.appendChild(s);
    });
  }
  return libsPendentes[nome];
}

const $ = (id) => document.getElementById(id);
const FUSO = "America/Sao_Paulo";

// ================= ESTADO =================

/** Respostas das funções de /api já carregadas (ver lib/painel.js). */
const fontes = { cambio: null, lme: null, comex: null, shfe: null, b3: null, spot: null, mensal: null, curvasComex: {} };

/** As praças que a página carrega na abertura; a B3 demora e chega depois das outras. */
const FONTES_BASE = [
  { id: "cambio", rotulo: "PTAX", caminho: "/api/cambio", sempre: true },
  { id: "lme", rotulo: "LME", caminho: "/api/lme" },
  { id: "comex", rotulo: "COMEX", caminho: "/api/comex" },
  { id: "shfe", rotulo: "SHFE", caminho: "/api/shfe" },
  { id: "b3", rotulo: "B3", caminho: "/api/b3" },
  { id: "spot", rotulo: "Spot", caminho: "/api/spot" }
].filter((f) => f.sempre || pracaAtiva(f.id));

/** Situação de cada fonte: { estado: "carregando" | "ok" | "erro", mensagem }. */
const situacao = {};

let metalAtual = null;        // null = painel com todos os metais
let moeda = "original";
let unidade = "original";
let semIva = false;
let pracaCurva = null;
let serieHist = null;
let periodoHist = "1a";
let modoHist = "diario";
let histDados = null;         // { metal, serie, pontos, ptax, mensal }
let cargaHist = 0;            // descarta respostas antigas quando a pessoa troca rápido
const falhasCurva = {};       // metal → mensagem, quando a curva da COMEX não veio
const graficos = {};

// ================= REDE =================

async function pedir(caminho) {
  const res = await fetch(caminho);
  let corpo = null;
  try { corpo = await res.json(); } catch (e) { /* corpo não é JSON */ }
  if (!res.ok) throw new Error((corpo && corpo.erro) || `HTTP ${res.status}`);
  if (!corpo || typeof corpo !== "object") throw new Error("resposta inesperada da API");
  return corpo;
}

// Consultas sob demanda (curva, histórico): uma vez por endereço; falha sai do cache para tentar de novo
const cachePedidos = new Map();
function pedirUmaVez(caminho) {
  if (!cachePedidos.has(caminho)) {
    const p = pedir(caminho);
    cachePedidos.set(caminho, p);
    p.catch(() => cachePedidos.delete(caminho));
  }
  return cachePedidos.get(caminho);
}

function carregarBase() {
  for (const f of FONTES_BASE) {
    situacao[f.id] = { estado: "carregando", mensagem: "" };
    pedir(f.caminho).then((corpo) => {
      fontes[f.id] = corpo;
      situacao[f.id] = { estado: "ok", mensagem: "" };
    }).catch((e) => {
      fontes[f.id] = null;
      situacao[f.id] = { estado: "erro", mensagem: e.message };
    }).finally(agendarDesenho);
  }
  agendarDesenho();
}

// ================= FORMATOS =================

function badge(texto, classe, titulo) {
  const b = document.createElement("span");
  b.className = "dxt-badge" + (classe ? ` ${classe}` : "");
  b.textContent = texto;
  if (titulo) b.title = titulo;
  return b;
}

function setTexto(el, texto, erro = false) {
  el.textContent = "";
  if (erro) {
    const s = document.createElement("span");
    s.className = "erro";
    s.textContent = texto;
    el.appendChild(s);
  } else {
    el.textContent = texto;
  }
}

/** Preço com a unidade em letra menor: "12.230,50 US$/t". */
function noPreco(valor, moedaCot, unidadeCot) {
  const frag = document.createDocumentFragment();
  if (!Number.isFinite(valor)) { frag.append("—"); return frag; }
  frag.append(fmtPreco(valor) + " ");
  const u = document.createElement("span");
  u.className = "unid";
  u.textContent = rotuloCotacao(moedaCot, unidadeCot);
  frag.append(u);
  return frag;
}

/**
 * Destino da conversão pedido nos seletores do topo. Com moeda e unidade "da praça" o preço é o que a
 * bolsa publica: o IVA de Xangai só sai quando há conversão (e na coluna comparável, sempre).
 */
const convertendo = () => moeda !== "original" || unidade !== "original";
const destino = () => ({ moeda, unidade, semIva: semIva && convertendo() });
/** O preço do instrumento, no destino pedido, está saindo sem o IVA chinês? */
const tirouIva = (inst) => !!(inst && inst.iva && semIva && convertendo());

/** Para pôr praças lado a lado: o que a pessoa escolheu ou, em "da praça", a base de comparação do metal. */
function destinoComparavel(metal) {
  return {
    moeda: moeda === "original" ? metal.comparacao.moeda : moeda,
    unidade: unidade === "original" ? metal.comparacao.unidade : unidade,
    semIva
  };
}

const converter = (preco, origem, dest) => converterPreco(preco, origem, dest, fontes.cambio);

// ================= TABELA GENÉRICA (ordenável, exportável) =================

/**
 * colunas: [{ k, rotulo, direita, valor(l) → para ordenar e exportar, celula(l, td) → preenche a célula,
 *             exportar(l) → valor no CSV/Excel quando difere de valor(l), titulo → cabeçalho no arquivo,
 *             casas → casas decimais do número no arquivo (padrão 6),
 *             soExporta → coluna que só existe no CSV/Excel (a unidade, que na tela vai junto do preço) }]
 */
function criarTabela(tabela, vazioEl) {
  const cabecalho = tabela.querySelector("thead tr");
  const corpo = tabela.querySelector("tbody");
  let colunas = [], linhas = [], visiveis = [];
  let ordem = { k: null, dir: "asc" };

  function comparar(a, b) {
    const va = a === undefined ? null : a, vb = b === undefined ? null : b;
    const semA = va === null || (typeof va === "number" && !Number.isFinite(va));
    const semB = vb === null || (typeof vb === "number" && !Number.isFinite(vb));
    if (semA || semB) return semA === semB ? 0 : semA ? 1 : -1; // sem valor sempre no fim
    if (typeof va === "number" && typeof vb === "number") return ordem.dir === "asc" ? va - vb : vb - va;
    const c = String(va).localeCompare(String(vb), "pt-BR");
    return ordem.dir === "asc" ? c : -c;
  }

  function desenhar() {
    const naTela = colunas.filter((c) => !c.soExporta);
    cabecalho.replaceChildren(...naTela.map((c) => {
      const th = document.createElement("th");
      th.dataset.k = c.k;
      th.scope = "col";
      if (c.direita) th.className = "right";
      if (c.dica) th.title = c.dica;
      th.textContent = c.rotulo;
      if (c.k === ordem.k) {
        th.setAttribute("aria-sort", ordem.dir === "asc" ? "ascending" : "descending");
        th.append(" ");
        const sp = document.createElement("span");
        sp.className = "seta";
        sp.setAttribute("aria-hidden", "true");
        sp.textContent = ordem.dir === "asc" ? "▲" : "▼";
        th.appendChild(sp);
      } else {
        th.setAttribute("aria-sort", "none");
      }
      return th;
    }));

    visiveis = [...linhas];
    const col = colunas.find((c) => c.k === ordem.k);
    if (col) visiveis.sort((a, b) => comparar(col.valor(a), col.valor(b)));

    const frag = document.createDocumentFragment();
    for (const l of visiveis) {
      const tr = document.createElement("tr");
      for (const c of naTela) {
        const td = document.createElement("td");
        if (c.direita) td.className = "right";
        if (c.celula) c.celula(l, td);
        else {
          const v = c.valor(l);
          td.textContent = v === null || v === undefined ? "—" : String(v);
        }
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    corpo.replaceChildren(frag);
    if (vazioEl) vazioEl.hidden = visiveis.length > 0;
  }

  cabecalho.addEventListener("click", (e) => {
    const th = e.target.closest ? e.target.closest("th") : null;
    if (!th) return;
    ordem = ordem.k === th.dataset.k ? { k: ordem.k, dir: ordem.dir === "asc" ? "desc" : "asc" } : { k: th.dataset.k, dir: "desc" };
    desenhar();
  });

  return {
    definir(novasColunas, novasLinhas) {
      colunas = novasColunas;
      linhas = novasLinhas;
      if (!colunas.some((c) => c.k === ordem.k)) ordem = { k: null, dir: "asc" };
      desenhar();
    },
    /** Cabeçalho e linhas como estão na tela, para CSV e Excel. */
    exportar() {
      return {
        cabecalho: colunas.map((c) => c.titulo || c.rotulo),
        linhas: visiveis.map((l) => colunas.map((c) => {
          const v = c.exportar ? c.exportar(l) : c.valor(l);
          if (v === undefined || v === null) return null;
          // Número sem o ruído das contas: 6 casas nos preços, 4 nas variações (c.casas)
          if (typeof v === "number") return Number.isFinite(v) ? Number(v.toFixed(c.casas ?? 6)) : null;
          return v;
        }))
      };
    },
    quantas: () => visiveis.length
  };
}

const celulaVariacao = (pct) => (l, td) => {
  const v = pct(l);
  td.className = "right" + (!Number.isFinite(v) ? " sem-valor" : v > 0 ? " alta" : v < 0 ? " baixa" : "");
  td.textContent = Number.isFinite(v) ? `${seta(v)} ${fmtPct(v)}` : "—";
};

function celulaComDetalhe(texto, detalhe) {
  return (l, td) => {
    td.textContent = texto(l);
    const d = detalhe(l);
    if (d) {
      const s = document.createElement("small");
      s.textContent = d;
      td.appendChild(s);
    }
  };
}

// ================= EXPORTAÇÕES =================

function baixar(nome, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportarCsv(tabela, nome) {
  const { cabecalho, linhas } = tabela.exportar();
  if (!linhas.length) return;
  baixar(`${nome}.csv`, new Blob([textoCsv(cabecalho, linhas)], { type: "text/csv;charset=utf-8" }));
  Moldura.aviso(`Arquivo ${nome}.csv gerado.`);
}

async function exportarXlsx(tabela, nome, aba, statusEl) {
  const { cabecalho, linhas } = tabela.exportar();
  if (!linhas.length) return;
  try {
    const XLSX = await carregarLib("XLSX");
    const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);
    ws["!cols"] = cabecalho.map((c) => ({ wch: Math.max(12, String(c).length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, aba.slice(0, 31));
    XLSX.writeFile(wb, `${nome}.xlsx`);
    Moldura.aviso(`Arquivo ${nome}.xlsx gerado.`);
  } catch (e) {
    if (statusEl) setTexto(statusEl, `Não foi possível gerar o Excel: ${e.message}`, true);
    Moldura.aviso(`Não foi possível gerar o Excel: ${e.message}`, true);
  }
}

const sufixoHoje = () => compacta(hojeEm(FUSO));

// ================= TOPO: CHIPS, CÂMBIO E FONTES =================

const chipsEl = $("chips");
const selMoeda = $("selMoeda");
const selUnidade = $("selUnidade");
const chkIva = $("chkIva");

function chip(texto, ativo, aoClicar, titulo) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dxt-chip" + (ativo ? " is-active" : "");
  b.setAttribute("aria-pressed", String(ativo));
  b.textContent = texto;
  if (titulo) b.title = titulo;
  b.addEventListener("click", aoClicar);
  return b;
}

function renderChips() {
  const itens = [chip("Painel", !metalAtual, () => selecionarMetal(null), "Todos os metais, em todas as praças")];
  let grupo = null;
  for (const m of METAIS) {
    const b = chip(nomeCurto(m), !!metalAtual && metalAtual.id === m.id, () => selecionarMetal(m), m.nome);
    if (m.grupo !== grupo) b.classList.add("novo-grupo");
    grupo = m.grupo;
    itens.push(b);
  }
  chipsEl.replaceChildren(...itens);
}

function renderInfoCambio() {
  const el = $("infoCambio");
  const c = fontes.cambio;
  el.replaceChildren();
  if (!c) {
    const s = situacao.cambio || {};
    el.append(s.estado === "erro"
      ? `Câmbio do Banco Central indisponível (${s.mensagem}): as cotações saem na moeda de cada praça.`
      : "Consultando o câmbio do Banco Central…");
    return;
  }
  const b = document.createElement("b");
  b.textContent = `PTAX de venda de ${fmtData(c.data)}`;
  const a = document.createElement("a");
  a.href = c.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Banco Central";
  const taxas = [`US$ 1 = R$ ${fmtNum(c.brl.USD, 4)}`];
  if (Number.isFinite(c.brl.CNY)) taxas.push(`CN¥ 1 = R$ ${fmtNum(c.brl.CNY, 4)}`);
  el.append("Conversão pela ", b, ` — ${taxas.join(" · ")} · `, a, ". Cada preço traz a data do seu próprio pregão.");
}

function dataDaFonte(id) {
  const f = fontes[id];
  if (!f) return null;
  if (id === "spot") return f.atualizado_em ? new Date(f.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
  return f.data ? fmtData(f.data).slice(0, 5) : null;
}

function renderFontes() {
  $("fontes").replaceChildren(...FONTES_BASE.map((f) => {
    const s = situacao[f.id] || { estado: "carregando" };
    const b = document.createElement("span");
    b.className = "dxt-badge" + (s.estado === "erro" ? " falhou" : "");
    const forte = document.createElement("b");
    forte.textContent = s.estado === "ok" ? (dataDaFonte(f.id) || "ok") : s.estado === "erro" ? "indisponível" : "consultando…";
    b.append(`${f.rotulo}: `, forte);
    const praca = pracaDe(f.id);
    b.title = s.estado === "erro" ? s.mensagem : praca ? `${praca.titulo} · fonte: ${praca.fonte} · ${praca.atraso}` : "Banco Central do Brasil — boletim de fechamento da PTAX";
    return b;
  }));
}

// ================= INDICADORES (KPI) =================

function renderKpis(cartoes) {
  for (let i = 0; i < 3; i++) {
    const k = cartoes[i] || { titulo: "—", valor: null, badges: [] };
    $(`kpi${i + 1}Titulo`).textContent = k.titulo;
    const v = $(`kpi${i + 1}Valor`);
    v.replaceChildren();
    if (k.valor && Number.isFinite(k.valor.preco)) {
      v.append(fmtPreco(k.valor.preco) + " ");
      const u = document.createElement("small");
      u.textContent = rotuloCotacao(k.valor.moeda, k.valor.unidade);
      v.appendChild(u);
    } else {
      v.textContent = k.texto || "—";
    }
    $(`kpi${i + 1}Pe`).replaceChildren(...(k.badges || []).filter(Boolean).map(([t, c, d]) => badge(t, c, d)));
  }
}

/** Preço da linha na moeda e unidade escolhidas no topo (ou na da praça). */
function cotacaoEscolhida(linha) {
  const dest = destino();
  const preco = converter(linha.preco, linha, dest);
  const cot = cotacaoDestino(linha, dest);
  // Sem câmbio para a moeda pedida: melhor mostrar a da praça do que nada
  if (preco === null) return { preco: converter(linha.preco, linha, { unidade, semIva: dest.semIva }), ...cotacaoDestino(linha, { unidade }) };
  return { preco, ...cot };
}

function kpiDaLinha(metal, linha, comMetal) {
  const praca = pracaDe(linha.praca);
  const v = variacaoPct(linha.preco, linha.anterior);
  return {
    titulo: comMetal ? `${metal.nome} · ${praca.bolsa}` : `${praca.nome} · ${linha.referencia}`,
    valor: cotacaoEscolhida(linha),
    badges: [
      Number.isFinite(v) ? [`${seta(v)} ${fmtPct(v)} no dia`, classeDir(v)] : null,
      [comMetal ? `${linha.referencia} · ${fmtData(linha.data)}` : `Pregão de ${fmtData(linha.data)}`],
      tirouIva(linha) ? ["Sem IVA de 13%", "dxt-badge--info", "Preço doméstico de Xangai convertido sem o IVA chinês"] : null
    ]
  };
}

const DESTAQUES = ["cobre", "aluminio", "ouro"];

function kpisDoPainel() {
  return DESTAQUES.map((id) => {
    const metal = metalDe(id);
    const linha = cotacoesDoMetal(metal, fontes)[0];
    return linha ? kpiDaLinha(metal, linha, true) : { titulo: metal.nome, texto: "—", badges: [] };
  });
}

function kpisDoMetal(metal) {
  const linhas = cotacoesDoMetal(metal, fontes);
  const p = linhas[0];
  if (!p) {
    const carregando = FONTES_BASE.some((f) => (situacao[f.id] || {}).estado === "carregando");
    return [{ titulo: metal.nome, texto: carregando ? "Consultando…" : "—", badges: [] }, { titulo: "Em reais" }, { titulo: "Estrutura a termo" }];
  }

  const k1 = kpiDaLinha(metal, p, false);
  // Médias do mês (período de cotação) da LME — só quando a moeda é a da praça: média × câmbio de hoje enganaria
  const cLme = p.praca === "lme" && fontes.lme ? fontes.lme.cotacoes.find((c) => c.metal === metal.id) : null;
  if (cLme && (moeda === "original" || moeda === p.moeda)) {
    const f = unidade === "original" ? 1 : fatorUnidade(p.unidade, unidade);
    for (const m of [cLme.mediaMes, cLme.mediaMesAnterior]) {
      if (m && f) k1.badges.push([`Média de ${rotuloMes(m.mes)}: ${fmtPreco(m.media * f)}`, "", `Média simples do cash settlement em ${m.dias} pregões`]);
    }
  }

  // Segundo cartão: o mesmo preço em reais (ou em dólares, se a pessoa já escolheu reais)
  const outra = moeda === "BRL" ? "USD" : "BRL";
  const unid = unidade !== "original" ? unidade : outra === "BRL" && metal.grupo === "preciosos" ? "g" : metal.comparacao.unidade;
  const preco2 = converter(p.preco, p, { moeda: outra, unidade: unid, semIva });
  const c = fontes.cambio;
  const k2 = {
    titulo: outra === "BRL" ? "Em reais" : "Em dólares",
    valor: preco2 === null ? null : { preco: preco2, moeda: outra, unidade: unid },
    texto: c ? "—" : "Sem câmbio",
    badges: c ? [
      [`PTAX venda ${fmtData(c.data)}: R$ ${fmtNum(c.brl.USD, 4)}`],
      [`${pracaDe(p.praca).bolsa} · ${p.referencia}`],
      p.iva && semIva ? ["Sem IVA de 13%", "dxt-badge--info", "Preço doméstico de Xangai convertido sem o IVA chinês"] : null
    ] : []
  };

  // Terceiro cartão: estrutura da curva na praça escolhida
  const k3 = { titulo: "Estrutura a termo", texto: "—", badges: [] };
  if (pracaCurva) {
    const a = analisarCurva(curvaDoMetal(metal, pracaCurva, fontes));
    k3.titulo = `Estrutura a termo · ${pracaDe(pracaCurva).bolsa}`;
    if (a.estrutura) {
      k3.texto = nomeEstrutura(a.estrutura) + (a.mista ? " (mista)" : "");
      k3.badges = [
        [`${fmtPct(a.spreadPct)} até ${a.ultimo.contrato}`, classeDir(a.spreadPct), "Último vencimento contra o primeiro"],
        Number.isFinite(a.anualizado) ? [`${fmtPct(a.anualizado)} ao ano`, "", "Spread anualizado de forma linear, base 365 dias"] : null
      ];
    } else if (pracaCurva === "comex" && !fontes.curvasComex[metal.id] && !falhasCurva[metal.id]) {
      k3.texto = "Consultando…";
    }
  } else {
    k3.badges = [["Sem curva por vencimento"]];
  }
  return [k1, k2, k3];
}

// ================= PAINEL (todos os metais) =================

const tblPainel = criarTabela($("tblPainel"), $("vazioPainel"));
const filtroPainel = $("filtroPainel");

function renderPainel() {
  const q = filtroPainel.value.trim().toLowerCase();
  const todas = linhasDoPainel(fontes).map((l) => {
    const metal = metalDe(l.metal);
    const dest = destinoComparavel(metal);
    return { ...l, metalObj: metal, pracaObj: pracaDe(l.praca), comparavel: converter(l.preco, l, dest), cot: cotacaoDestino(l, dest), variacao: variacaoPct(l.preco, l.anterior) };
  });
  const linhas = q
    ? todas.filter((l) => `${l.metalObj.nome} ${l.pracaObj.nome} ${l.referencia}`.toLowerCase().includes(q))
    : todas;

  tblPainel.definir([
    { k: "metal", rotulo: "Metal", valor: (l) => l.metalObj.nome, celula: (l, td) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link-metal";
      b.textContent = l.metalObj.nome;
      b.addEventListener("click", () => selecionarMetal(l.metalObj));
      td.appendChild(b);
    } },
    { k: "praca", rotulo: "Praça", valor: (l) => l.pracaObj.nome },
    { k: "referencia", rotulo: "Referência", valor: (l) => l.referencia, celula: celulaComDetalhe((l) => l.referencia, (l) => l.detalhe) },
    { k: "data", rotulo: "Data", valor: (l) => l.data, celula: (l, td) => { td.textContent = fmtData(l.data); }, exportar: (l) => fmtData(l.data) },
    { k: "preco", rotulo: "Preço na praça", titulo: "Preço na praça", direita: true, valor: (l) => l.preco, celula: (l, td) => td.appendChild(noPreco(l.preco, l.moeda, l.unidade)) },
    { k: "cotacao", rotulo: "Cotação", soExporta: true, valor: (l) => rotuloCotacao(l.moeda, l.unidade) + (l.iva ? " (com IVA)" : "") },
    { k: "variacao", rotulo: "Var. dia", titulo: "Variação no dia (%)", direita: true, casas: 4, valor: (l) => l.variacao, celula: celulaVariacao((l) => l.variacao) },
    { k: "comparavel", rotulo: "Comparável", titulo: "Preço comparável", direita: true, dica: "Mesmo preço convertido para a moeda e a unidade escolhidas — ou, em “da praça”, para a base de comparação do metal",
      valor: (l) => l.comparavel, celula: (l, td) => td.appendChild(noPreco(l.comparavel, l.cot.moeda, l.cot.unidade)) },
    { k: "base", rotulo: "Comparável em", soExporta: true, valor: (l) => (l.comparavel === null ? null : rotuloCotacao(l.cot.moeda, l.cot.unidade)) }
  ], linhas);

  const n = tblPainel.quantas();
  $("contPainel").textContent = n ? `${n} ${n === 1 ? "cotação" : "cotações"}` : "—";
  $("csvPainel").disabled = $("xlsxPainel").disabled = n === 0;
  $("vazioPainel").textContent = todas.length ? "Nenhuma cotação com esse filtro." : FONTES_BASE.some((f) => (situacao[f.id] || {}).estado === "carregando") ? "Consultando as praças…" : "Nenhuma praça respondeu. Tente atualizar em instantes.";
}

// ================= METAL: PRAÇAS =================

const tblPracas = criarTabela($("tblPracas"), $("vazioPracas"));

function renderPracas(metal) {
  const dest = destinoComparavel(metal);
  const base = cotacoesDoMetal(metal, fontes);
  const linhas = base.map((l) => ({ ...l, pracaObj: pracaDe(l.praca), comparavel: converter(l.preco, l, dest), cot: cotacaoDestino(l, dest), variacao: variacaoPct(l.preco, l.anterior) }));
  const referencia = linhas.find((l) => Number.isFinite(l.comparavel)) || null;
  for (const l of linhas) l.diferenca = referencia && l !== referencia ? variacaoPct(l.comparavel, referencia.comparavel) : null;

  $("tituloPracas").textContent = `${metal.nome} por praça`;
  const rotuloBase = rotuloCotacao(dest.moeda, dest.unidade);
  tblPracas.definir([
    { k: "praca", rotulo: "Praça", valor: (l) => l.pracaObj.nome, celula: (l, td) => {
      celulaComDetalhe((x) => x.pracaObj.nome, (x) => `Fonte: ${x.pracaObj.fonte}`)(l, td);
      const inst = instrumentoDe(metal, l.praca);
      if (inst && inst.descricao) td.title = inst.descricao;
    } },
    { k: "referencia", rotulo: "Referência", valor: (l) => l.referencia, celula: celulaComDetalhe((l) => l.referencia, (l) =>
      l.intradia ? `${l.detalhe} · em pregão ${fmtData(l.intradia.data).slice(0, 5)}: ${fmtPreco(l.intradia.preco)}` : l.detalhe) },
    { k: "data", rotulo: "Data", valor: (l) => l.data, celula: (l, td) => { td.textContent = fmtData(l.data); }, exportar: (l) => fmtData(l.data) },
    { k: "preco", rotulo: "Preço na praça", direita: true, valor: (l) => l.preco, celula: (l, td) => td.appendChild(noPreco(l.preco, l.moeda, l.unidade)) },
    { k: "cotacao", rotulo: "Cotação", soExporta: true, valor: (l) => rotuloCotacao(l.moeda, l.unidade) + (l.iva ? " (com IVA)" : "") },
    { k: "variacao", rotulo: "Var. dia", titulo: "Variação no dia (%)", direita: true, casas: 4, valor: (l) => l.variacao, celula: celulaVariacao((l) => l.variacao) },
    { k: "comparavel", rotulo: `Em ${rotuloBase}`, direita: true, valor: (l) => l.comparavel, celula: (l, td) => { td.textContent = fmtPreco(l.comparavel); if (l.comparavel === null) td.classList.add("sem-valor"); } },
    { k: "diferenca", rotulo: "Dif. p/ 1ª praça", titulo: "Diferença para a primeira praça (%)", direita: true, dica: referencia ? `Contra ${referencia.pracaObj.nome} · ${referencia.referencia}, na mesma moeda e unidade` : "",
      casas: 4, valor: (l) => l.diferenca, celula: celulaVariacao((l) => l.diferenca) }
  ], linhas);

  const n = tblPracas.quantas();
  $("contPracas").textContent = n ? `${n} ${n === 1 ? "referência" : "referências"}` : "—";
  $("csvPracas").disabled = $("xlsxPracas").disabled = n === 0;
  $("vazioPracas").textContent = FONTES_BASE.some((f) => (situacao[f.id] || {}).estado === "carregando") ? "Consultando as praças…" : "Nenhuma praça respondeu para este metal.";

  const partes = [];
  if (linhas.some((l) => l.iva)) {
    partes.push(semIva
      ? "Os preços de Xangai (SHFE) estão convertidos sem o IVA chinês de 13%, para comparar com Londres e Nova York."
      : "O preço doméstico de Xangai (SHFE) embute o IVA chinês de 13%: marque “Xangai sem IVA” para comparar com Londres e Nova York.");
  }
  if (new Set(linhas.map((l) => l.data)).size > 1) partes.push("As praças fecham em horários e dias diferentes: confira a data de cada linha antes de ler a diferença como arbitragem.");
  if (linhas.some((l) => l.comparavel === null)) partes.push("Sem o câmbio do Banco Central não há conversão entre moedas.");
  if (linhas.some((l) => l.chave === "spot")) partes.push("O preço à vista é indicativo e não é referência de bolsa.");
  $("notaPracas").textContent = partes.join(" ");
}

// ================= METAL: CURVA DE PREÇOS =================

const tblCurva = criarTabela($("tblCurva"), $("vazioCurva"));
const dataTermo = $("dataTermo");
let curvaNaTela = null; // { metal, praca, inst, cot, analise, brutos }

const PREFERENCIA_CURVA = ["comex", "shfe", "b3", "ine", "lme"];

function escolherPracaCurva(metal) {
  const disponiveis = pracasComCurva(metal);
  const pedida = PARAMS.get("praca");
  if (pracaCurva && disponiveis.includes(pracaCurva)) return pracaCurva;
  if (pedida && disponiveis.includes(pedida)) return pedida;
  return PREFERENCIA_CURVA.find((p) => disponiveis.includes(p)) || null;
}

function renderChipsCurva(metal) {
  $("chipsCurva").replaceChildren(...pracasComCurva(metal).map((id) => {
    const p = pracaDe(id);
    return chip(p.nome, id === pracaCurva, () => {
      if (pracaCurva === id) return;
      pracaCurva = id;
      carregarCurva();
      agendarDesenho();
    }, p.titulo);
  }));
}

/** A curva da COMEX é pedida quando a pessoa a escolhe; as demais já vêm com o painel. */
function carregarCurva() {
  const metal = metalAtual;
  if (!metal || pracaCurva !== "comex" || fontes.curvasComex[metal.id]) return;
  delete falhasCurva[metal.id];
  pedirUmaVez(`/api/comex?metal=${encodeURIComponent(metal.id)}`).then((corpo) => {
    fontes.curvasComex[metal.id] = corpo;
  }).catch((e) => {
    falhasCurva[metal.id] = e.message;
  }).finally(agendarDesenho);
}

function opcoesDoGrafico({ rotuloY, casas }) {
  const FONTE_MONO = "'IBM Plex Mono', ui-monospace, monospace";
  const ticks = { color: "#908C85", font: { family: FONTE_MONO, size: 10 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1B1B1B", borderColor: "rgba(247,243,231,.13)", borderWidth: 1,
        titleColor: "#908C85", bodyColor: "#F7F3E7",
        titleFont: { family: FONTE_MONO, size: 10 }, bodyFont: { family: FONTE_MONO, size: 12 },
        cornerRadius: 0, displayColors: false,
        callbacks: { label: (c) => ` ${fmtPreco(c.parsed.y, casas)} ${rotuloY}` }
      }
    },
    scales: {
      x: { ticks: { ...ticks, maxTicksLimit: 10, maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { color: "rgba(247,243,231,.13)" } },
      y: {
        ticks: { ...ticks, callback: (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas }) },
        grid: { color: "rgba(247,243,231,.06)" }, border: { color: "rgba(247,243,231,.13)" },
        title: { display: true, text: rotuloY, color: "#908C85", font: { family: FONTE_MONO, size: 10 } }
      }
    }
  };
}

function desenharGrafico(id, statusEl, { rotulos, valores, rotuloY, pontos }) {
  if (graficos[id]) { graficos[id].destroy(); graficos[id] = null; }
  if (!window.Chart) {
    if (statusEl && valores.length) setTexto(statusEl, "Gráfico indisponível • a tabela segue abaixo");
    return;
  }
  if (!valores.length) return;
  const finitos = valores.filter(Number.isFinite);
  const casas = finitos.length ? casasDoPreco(Math.max(...finitos.map(Math.abs))) : 2;
  graficos[id] = new Chart($(id), {
    type: "line",
    data: {
      labels: rotulos,
      datasets: [{
        data: valores, borderColor: "#00B3AC", backgroundColor: "rgba(0,179,172,.12)", fill: true,
        tension: 0.15, borderWidth: 2, spanGaps: true,
        pointRadius: pontos ? 3 : 0, pointHoverRadius: 4, pointBackgroundColor: "#00B3AC"
      }]
    },
    options: opcoesDoGrafico({ rotuloY, casas })
  });
}

function renderCurva(metal) {
  renderChipsCurva(metal);
  const statusEl = $("statusCurva");
  const praca = pracaCurva ? pracaDe(pracaCurva) : null;
  const inst = praca ? instrumentoDe(metal, pracaCurva) : null;
  const brutos = praca ? curvaDoMetal(metal, pracaCurva, fontes) : [];

  // Converte os preços; sem câmbio para a moeda pedida, a curva sai na moeda da praça
  let dest = destino();
  if (inst && brutos.length && converter(brutos[0].preco, inst, dest) === null) dest = { unidade, semIva: dest.semIva };
  const cot = inst ? cotacaoDestino(inst, dest) : null;
  const pontos = inst ? brutos.map((p) => ({ ...p, precoPraca: p.preco, preco: converter(p.preco, inst, dest), anterior: converter(p.anterior, inst, dest) })) : [];
  const a = analisarCurva(pontos);
  curvaNaTela = praca && a.pontos.length ? { metal, praca, inst, cot, analise: a, brutos } : null;

  const rotuloY = cot ? rotuloCotacao(cot.moeda, cot.unidade) : "";
  // Mesmas casas em toda a coluna (preço e spread), pela ordem de grandeza do 1º vencimento
  const casas = a.primeiro ? casasDoPreco(a.primeiro.preco) : 2;
  const pill = $("curvaEstruturaPill");
  pill.classList.remove("dxt-badge--up", "dxt-badge--down");
  $("curvaEstrutura").textContent = a.estrutura ? nomeEstrutura(a.estrutura) + (a.mista ? " (mista)" : "") : "—";
  pill.title = a.estrutura === "contango" ? "Vencimentos longos mais caros que o primeiro: custo de carrego positivo"
    : a.estrutura === "backwardation" ? "Vencimentos longos mais baratos que o primeiro: prêmio pela entrega imediata" : "";
  if (a.estrutura === "contango") pill.classList.add("dxt-badge--up");
  if (a.estrutura === "backwardation") pill.classList.add("dxt-badge--down");
  $("curvaPrimeiro").textContent = a.primeiro ? `${fmtPreco(a.primeiro.preco, casas)} (${a.primeiro.contrato})` : "—";
  $("curvaUltimo").textContent = a.ultimo && a.pontos.length > 1 ? `${fmtPreco(a.ultimo.preco, casas)} (${a.ultimo.contrato})` : "—";
  $("curvaSpread").textContent = Number.isFinite(a.spread) ? `${fmtDiferenca(a.spread, casas)} (${fmtPct(a.spreadPct)})` : "—";
  $("curvaAnual").textContent = Number.isFinite(a.anualizado) ? fmtPct(a.anualizado) : "—";
  for (const [id, v] of [["curvaSpreadPill", a.spread], ["curvaAnualPill", a.anualizado]]) {
    $(id).classList.remove("dxt-badge--up", "dxt-badge--down");
    const c = classeDir(v);
    if (c) $(id).classList.add(c);
  }

  desenharGrafico("graficoCurva", statusEl, {
    rotulos: a.pontos.map((p) => (pracaCurva === "lme" ? p.contrato : rotuloMes(p.vencimento, true))),
    valores: a.pontos.map((p) => p.preco), rotuloY, pontos: true
  });

  tblCurva.definir([
    { k: "vencimento", rotulo: "Vencimento", valor: (l) => l.dataVencimento, celula: celulaComDetalhe((l) => (pracaCurva === "lme" ? l.contrato : rotuloMes(l.vencimento)), (l) => fmtData(l.dataVencimento)), exportar: (l) => fmtData(l.dataVencimento) },
    { k: "contrato", rotulo: "Contrato", valor: (l) => l.contrato },
    { k: "preco", rotulo: `Ajuste (${rotuloY})`, direita: true, valor: (l) => l.preco, celula: (l, td) => { td.textContent = fmtPreco(l.preco, casas); } },
    { k: "variacao", rotulo: "Var. dia", titulo: "Variação no dia (%)", direita: true, casas: 4, valor: (l) => l.variacao, celula: celulaVariacao((l) => l.variacao) },
    { k: "spread", rotulo: "Spread", titulo: `Spread contra o 1º vencimento (${rotuloY})`, direita: true, dica: "Diferença de preço contra o primeiro vencimento", valor: (l) => l.spread, celula: (l, td) => { td.textContent = l.dias ? fmtDiferenca(l.spread, casas) : "—"; } },
    { k: "spreadPct", rotulo: "Spread %", titulo: "Spread contra o 1º vencimento (%)", direita: true, casas: 4, valor: (l) => l.spreadPct, celula: (l, td) => (l.dias ? celulaVariacao((x) => x.spreadPct)(l, td) : (td.textContent = "—")) },
    { k: "anualizado", rotulo: "% ao ano", titulo: "Spread anualizado (% ao ano, linear)", direita: true, dica: "Spread % × 365 ÷ dias entre os vencimentos", casas: 4, valor: (l) => l.anualizado, celula: (l, td) => { td.textContent = Number.isFinite(l.anualizado) ? fmtPct(l.anualizado) : "—"; } },
    { k: "volume", rotulo: "Volume", direita: true, valor: (l) => l.volume, celula: (l, td) => { td.textContent = fmtInteiro(l.volume); } },
    { k: "emAberto", rotulo: "Em aberto", titulo: "Posição em aberto", direita: true, valor: (l) => l.emAberto, celula: (l, td) => { td.textContent = fmtInteiro(l.emAberto); } },
    { k: "data", rotulo: "Pregão", valor: (l) => l.data, celula: (l, td) => { td.textContent = fmtData(l.data); }, exportar: (l) => fmtData(l.data) }
  ], a.pontos);

  const n = a.pontos.length;
  $("contCurva").textContent = n ? `${n} ${n === 1 ? "vencimento" : "vencimentos"}` : "—";
  $("csvCurva").disabled = $("xlsxCurva").disabled = $("sapCurva").disabled = n === 0;

  const falhaComex = pracaCurva === "comex" ? falhasCurva[metal.id] : null;
  const carregandoComex = pracaCurva === "comex" && !fontes.curvasComex[metal.id] && !falhaComex;
  const fonteBase = pracaCurva === "ine" ? "shfe" : pracaCurva;
  const carregandoBase = praca && pracaCurva !== "comex" && (situacao[fonteBase] || {}).estado === "carregando";
  const falhaBase = praca && pracaCurva !== "comex" && (situacao[fonteBase] || {}).estado === "erro" ? situacao[fonteBase].mensagem : null;
  if (!praca) {
    setTexto(statusEl, "Sem curva por vencimento");
    $("vazioCurva").textContent = "A fonte só publica o primeiro vencimento deste metal: não há curva para mostrar.";
  } else if (n) {
    const datas = [...new Set(a.pontos.map((p) => p.data))].sort();
    setTexto(statusEl, `${praca.bolsa} · pregão de ${fmtData(datas[datas.length - 1])} · fonte: ${praca.fonte}${tirouIva(inst) ? " · sem IVA de 13%" : ""}`);
  } else if (carregandoComex || carregandoBase) {
    setTexto(statusEl, `Consultando ${praca.bolsa}…`);
    $("vazioCurva").textContent = "Consultando a praça…";
  } else {
    const motivo = falhaComex || falhaBase;
    setTexto(statusEl, motivo ? `Erro ao buscar a curva: ${motivo}` : `${praca.bolsa} sem dados agora`, !!motivo);
    $("vazioCurva").textContent = "A praça não respondeu. Tente atualizar em instantes.";
  }

  // Preço a termo: só dentro do intervalo da curva
  const tem = a.pontos.length >= 2;
  dataTermo.disabled = !tem;
  if (tem) {
    dataTermo.min = a.primeiro.dataVencimento;
    dataTermo.max = a.ultimo.dataVencimento;
    if (dataTermo.value && (dataTermo.value < dataTermo.min || dataTermo.value > dataTermo.max)) dataTermo.value = "";
  } else {
    dataTermo.value = "";
  }
  const regra = pracaCurva === "lme" ? "O cash liquida em 2 dias úteis e o 3 meses, 3 meses depois do pregão."
    : pracaCurva === "shfe" || pracaCurva === "ine" ? "Vencimento aproximado: dia 15 do mês de entrega, ou a segunda-feira seguinte."
    : "Vencimento aproximado: último dia de semana do mês de entrega.";
  $("notaTermo").textContent = tem
    ? `Escolha um dia entre ${fmtData(a.primeiro.dataVencimento)} e ${fmtData(a.ultimo.dataVencimento)}. ${regra} A conta não extrapola além do último vencimento.`
    : "";
  renderTermo();
}

function renderTermo() {
  const el = $("resTermo");
  el.replaceChildren();
  const c = curvaNaTela;
  if (!c || !dataValida(dataTermo.value)) { el.textContent = "—"; return; }
  const r = interpolarPreco(c.analise.pontos, dataTermo.value);
  if (!r) { el.textContent = "Fora do intervalo da curva"; return; }
  el.append(fmtPreco(r.preco, casasDoPreco(c.analise.primeiro.preco)) + " ");
  const u = document.createElement("small");
  u.textContent = `${rotuloCotacao(c.cot.moeda, c.cot.unidade)} · ${r.exato ? `vencimento ${r.antes.contrato}` : `entre ${r.antes.contrato} e ${r.depois.contrato}`}`;
  el.appendChild(u);
}

// ================= METAL: HISTÓRICO E MÉDIAS =================

const tblHist = criarTabela($("tblHist"), $("vazioHist"));
const filtroHist = $("filtroHist");

const PERIODOS = [
  { id: "3m", rotulo: "3M", meses: 3 }, { id: "1a", rotulo: "1A", meses: 12 }, { id: "2a", rotulo: "2A", meses: 24 },
  { id: "5a", rotulo: "5A", meses: 60 }, { id: "10a", rotulo: "10A", meses: 120 }, { id: "tudo", rotulo: "Tudo", meses: null }
];

/** Séries de histórico que o metal tem: LME (cash e 3 meses), COMEX (1º vencimento) e Banco Mundial (mensal). */
function seriesDoMetal(metal) {
  const s = [];
  if (instrumentoDe(metal, "lme")) {
    s.push({ id: "lme:cash", rotulo: "LME cash", praca: "lme", chave: "cash", periodos: ["3m", "1a", "2a", "5a", "10a"] });
    s.push({ id: "lme:3m", rotulo: "LME 3 meses", praca: "lme", chave: "tresMeses", periodos: ["3m", "1a", "2a", "5a", "10a"] });
  }
  if (instrumentoDe(metal, "comex")) s.push({ id: "comex", rotulo: "COMEX 1º venc.", praca: "comex", periodos: ["3m", "1a", "2a", "5a", "10a", "tudo"] });
  if (instrumentoDe(metal, "bm")) s.push({ id: "bm", rotulo: "Banco Mundial (mensal)", praca: "bm", mensal: true, periodos: ["1a", "2a", "5a", "10a", "tudo"] });
  return s;
}

const serieAtual = (metal) => seriesDoMetal(metal).find((s) => s.id === serieHist) || null;

function renderSeletoresHist(metal) {
  const series = seriesDoMetal(metal);
  const atual = serieAtual(metal);
  $("chipsHist").replaceChildren(...series.map((s) => chip(s.rotulo, s.id === serieHist, () => {
    if (serieHist === s.id) return;
    serieHist = s.id;
    if (!s.periodos.includes(periodoHist)) periodoHist = "1a";
    carregarHist();
  }, pracaDe(s.praca).titulo)));

  $("rngHist").replaceChildren(...PERIODOS.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rng" + (p.id === periodoHist ? " active" : "");
    b.textContent = p.rotulo;
    b.setAttribute("aria-pressed", String(p.id === periodoHist));
    b.disabled = !atual || !atual.periodos.includes(p.id);
    b.addEventListener("click", () => { if (periodoHist !== p.id) { periodoHist = p.id; carregarHist(); } });
    return b;
  }));

  document.querySelectorAll("#modoHist .rng").forEach((b) => {
    const forcado = !!(atual && atual.mensal);
    const ativo = forcado ? b.dataset.modo === "mensal" : b.dataset.modo === modoHist;
    b.classList.toggle("active", ativo);
    b.setAttribute("aria-pressed", String(ativo));
    b.disabled = forcado && b.dataset.modo === "diario";
  });
}

/**
 * Primeiro dia do período. Sempre o dia 1º de um mês: assim a média mensal do primeiro mês da janela é
 * a do mês inteiro, não a de um pedaço dele.
 */
function inicioDoPeriodo(serie) {
  const p = PERIODOS.find((x) => x.id === periodoHist) || PERIODOS[1];
  const hoje = hojeEm(FUSO);
  if (p.meses) return `${mesDe(somarMesesAoDia(hoje, -p.meses))}-01`;
  return serie.praca === "bm" ? "1960-01-01" : "2000-01-01";
}

/** Busca em lotes de 3, para não disparar dez pedidos de uma vez contra a mesma fonte. */
async function emLotesDe3(caminhos) {
  const saida = [];
  for (let i = 0; i < caminhos.length; i += 3) saida.push(...await Promise.all(caminhos.slice(i, i + 3).map(pedirUmaVez)));
  return saida;
}

async function carregarHist() {
  const metal = metalAtual;
  const serie = metal ? serieAtual(metal) : null;
  const minha = ++cargaHist;
  renderSeletoresHist(metal);
  if (!metal || !serie) { histDados = null; $("statusHist").textContent = "—"; renderHist(); return; }

  const statusEl = $("statusHist");
  const praca = pracaDe(serie.praca);
  setTexto(statusEl, `Consultando ${praca.bolsa}…`);
  const de = inicioDoPeriodo(serie);
  const hoje = hojeEm(FUSO);

  try {
    let pontos;
    if (serie.praca === "lme") {
      const anos = [];
      for (let a = Number(de.slice(0, 4)); a <= Number(hoje.slice(0, 4)); a++) anos.push(a);
      const respostas = await emLotesDe3(anos.map((a) => `/api/lme?metal=${metal.id}&ano=${a}`));
      pontos = respostas.flatMap((r) => r.pontos).filter((p) => p.data >= de).map((p) => ({ data: p.data, valor: p[serie.chave] }));
    } else if (serie.praca === "comex") {
      const r = await pedirUmaVez(`/api/comex?metal=${metal.id}&de=${de}`);
      pontos = r.pontos.map((p) => ({ data: p.data, valor: p.preco }));
    } else {
      if (!fontes.mensal) fontes.mensal = await pedirUmaVez("/api/mensal");
      const s = fontes.mensal.series[metal.id];
      if (!s) throw new Error("o Banco Mundial não publica a média mensal deste metal");
      pontos = s.pontos.filter(([mes]) => mes >= mesDe(de)).map(([mes, valor]) => ({ data: `${mes}-01`, valor }));
    }
    pontos = pontos.filter((p) => Number.isFinite(p.valor));

    // Em reais, cada dia é convertido pela PTAX de venda do próprio dia (ou do último dia útil no Brasil)
    let ptax = null;
    if (moeda === "BRL" && !serie.mensal && pontos.length) {
      const r = await pedirUmaVez(`/api/cambio?de=${somarDias(pontos[0].data, -10)}&ate=${hoje}`);
      ptax = r.pontos;
    }
    if (minha !== cargaHist) return;
    histDados = { metal, serie, pontos, ptax, de };
    statusEl.textContent = "";
  } catch (e) {
    if (minha !== cargaHist) return;
    histDados = null;
    setTexto(statusEl, `Erro ao buscar: ${e.message}`, true);
  }
  renderHist();
}

function renderHist() {
  const metal = metalAtual;
  if (!metal) return;
  renderSeletoresHist(metal);
  const d = histDados && histDados.metal === metal ? histDados : null;
  const serie = d ? d.serie : serieAtual(metal);
  const statusEl = $("statusHist");
  const notaEl = $("notaHist");
  notaEl.hidden = true;

  let linhas = [], colunas = [], rotuloY = "", rotulos = [], valores = [];
  let casas = 2;
  const preco = (v) => fmtPreco(v, casas);
  if (d && serie) {
    const inst = instrumentoDe(metal, serie.praca);
    const unid = unidade === "original" ? inst.unidade : unidade;
    const f = fatorUnidade(inst.unidade, unid) || 1;
    // Moeda: a da praça, ou reais pela PTAX do dia (séries diárias). Outra conversão não tem série de câmbio.
    const emReais = moeda === "BRL" && !serie.mensal && Array.isArray(d.ptax);
    const moedaTela = emReais ? "BRL" : inst.moeda;
    if (moeda !== "original" && moeda !== moedaTela) {
      notaEl.hidden = false;
      notaEl.textContent = serie.mensal
        ? `As médias mensais do Banco Mundial saem em ${MOEDAS[inst.moeda].simbolo}: converter uma média pelo câmbio de hoje distorceria a série.`
        : `O histórico sai em ${MOEDAS[inst.moeda].simbolo}: a conversão dia a dia só existe para reais, pela PTAX.`;
    }
    rotuloY = rotuloCotacao(moedaTela, unid);
    const taxa = emReais ? taxaVigente(d.ptax) : null;
    const diarios = d.pontos.map((p) => {
      const t = taxa ? taxa(p.data) : null;
      return { data: p.data, original: p.valor * f, ptax: t ? t.venda : null, valor: taxa ? (t ? p.valor * f * t.venda : null) : p.valor * f };
    }).filter((p) => Number.isFinite(p.valor));

    // Mesmas casas na coluna inteira, pela ordem de grandeza do maior valor
    if (diarios.length) casas = casasDoPreco(Math.max(...diarios.map((p) => Math.abs(p.valor))));
    const mensal = serie.mensal || modoHist === "mensal";
    if (mensal) {
      const medias = serie.mensal
        ? diarios.map((p) => ({ mes: mesDe(p.data), media: p.valor, minimo: null, maximo: null, dias: null }))
        : mediasMensais(diarios);
      // O mês em curso só tem os pregões até hoje: a média dele é parcial, e a tela diz isso
      const mesCorrente = mesDe(hojeEm(FUSO));
      const nomeDoMes = (l) => rotuloMes(l.mes) + (!serie.mensal && l.mes === mesCorrente ? " (parcial)" : "");
      linhas = medias.map((m, i) => ({ ...m, variacao: i ? variacaoPct(m.media, medias[i - 1].media) : null }));
      for (const l of linhas) l.rotulo = nomeDoMes(l);
      rotulos = linhas.map((l) => rotuloMes(l.mes, true));
      valores = linhas.map((l) => l.media);
      colunas = [
        { k: "mes", rotulo: "Mês", valor: (l) => l.mes, celula: (l, td) => { td.textContent = l.rotulo; }, exportar: (l) => l.rotulo },
        { k: "media", rotulo: `Média (${rotuloY})`, direita: true, valor: (l) => l.media, celula: (l, td) => { td.textContent = preco(l.media); } },
        { k: "variacao", rotulo: "Var. mês", titulo: "Variação contra o mês anterior (%)", direita: true, casas: 4, valor: (l) => l.variacao, celula: celulaVariacao((l) => l.variacao) },
        ...(serie.mensal ? [] : [
          { k: "minimo", rotulo: "Mínimo", direita: true, valor: (l) => l.minimo, celula: (l, td) => { td.textContent = preco(l.minimo); } },
          { k: "maximo", rotulo: "Máximo", direita: true, valor: (l) => l.maximo, celula: (l, td) => { td.textContent = preco(l.maximo); } },
          { k: "dias", rotulo: "Pregões", direita: true, valor: (l) => l.dias, celula: (l, td) => { td.textContent = fmtInteiro(l.dias); } }
        ])
      ];
    } else {
      linhas = diarios.map((p, i) => ({ ...p, variacao: i ? variacaoPct(p.valor, diarios[i - 1].valor) : null }));
      rotulos = linhas.map((l) => fmtData(l.data).slice(0, 5) + "/" + l.data.slice(2, 4));
      valores = linhas.map((l) => l.valor);
      colunas = [
        { k: "data", rotulo: "Data", valor: (l) => l.data, celula: (l, td) => { td.textContent = fmtData(l.data); }, exportar: (l) => fmtData(l.data) },
        { k: "valor", rotulo: `Preço (${rotuloY})`, direita: true, valor: (l) => l.valor, celula: (l, td) => { td.textContent = preco(l.valor); } },
        { k: "variacao", rotulo: "Var. dia", titulo: "Variação no dia (%)", direita: true, casas: 4, valor: (l) => l.variacao, celula: celulaVariacao((l) => l.variacao) },
        ...(emReais ? [
          { k: "original", rotulo: `Preço (${rotuloCotacao(inst.moeda, unid)})`, direita: true, valor: (l) => l.original, celula: (l, td) => { td.textContent = fmtPreco(l.original); } },
          { k: "ptax", rotulo: "PTAX venda", direita: true, valor: (l) => l.ptax, celula: (l, td) => { td.textContent = fmtNum(l.ptax, 4); } }
        ] : [])
      ];
    }

    const praca = pracaDe(serie.praca);
    if (linhas.length && !statusEl.querySelector(".erro")) {
      const ini = mensal ? rotuloMes(linhas[0].mes) : fmtData(linhas[0].data);
      const fim = mensal ? rotuloMes(linhas[linhas.length - 1].mes) : fmtData(linhas[linhas.length - 1].data);
      setTexto(statusEl, `${serie.rotulo} · ${ini} → ${fim} · fonte: ${praca.fonte}${emReais && mensal ? " · média de preço × PTAX do dia" : ""}`);
    } else if (!linhas.length && !statusEl.querySelector(".erro")) {
      setTexto(statusEl, "Sem dados no período");
    }
  }

  // Estatísticas sobre a série inteira do período (o filtro de texto só afeta a tabela)
  const finitos = valores.filter(Number.isFinite);
  $("histRotulo").textContent = rotuloY || "—";
  $("histMin").textContent = finitos.length ? preco(Math.min(...finitos)) : "—";
  $("histMax").textContent = finitos.length ? preco(Math.max(...finitos)) : "—";
  $("histMed").textContent = finitos.length ? preco(finitos.reduce((x, y) => x + y, 0) / finitos.length) : "—";
  const varPeriodo = finitos.length > 1 ? variacaoPct(finitos[finitos.length - 1], finitos[0]) : null;
  $("histVar").textContent = fmtPct(varPeriodo);
  const pill = $("histVarPill");
  pill.classList.remove("dxt-badge--up", "dxt-badge--down");
  if (classeDir(varPeriodo)) pill.classList.add(classeDir(varPeriodo));

  desenharGrafico("graficoHist", statusEl, { rotulos, valores, rotuloY, pontos: valores.length <= 40 });

  const q = filtroHist.value.trim().toLowerCase();
  // No mensal o filtro aceita "nov/2026", "2026-11" e "11/2026"; no diário, "20/11/2026" e "2026-11-20"
  const procuravel = (l) => (l.mes ? `${rotuloMes(l.mes)} ${l.mes} ${l.mes.slice(5)}/${l.mes.slice(0, 4)}` : `${fmtData(l.data)} ${l.data}`).toLowerCase();
  const filtradas = q ? linhas.filter((l) => procuravel(l).includes(q)) : linhas;
  // Mais recente primeiro, como nas outras ferramentas
  tblHist.definir(colunas, [...filtradas].reverse());
  const n = tblHist.quantas();
  const mensalNaTela = !!(serie && (serie.mensal || modoHist === "mensal"));
  $("contHist").textContent = n ? `${n} ${mensalNaTela ? (n === 1 ? "mês" : "meses") : (n === 1 ? "pregão" : "pregões")}` : "—";
  $("csvHist").disabled = $("xlsxHist").disabled = n === 0;
  // A planilha SAP leva cotações diárias na moeda da praça: média mensal do Banco Mundial não é cotação de DCS
  $("sapHist").disabled = !d || !d.pontos.length || !!serie.mensal;
}

// ================= PLANILHA DE APOIO SAP =================

const modalSap = $("modalSap");
const CHAVE_SAP = "metais_sap";
let contextoSap = null; // { chave, cotacoes, moeda, descricao, nome }

function abrirSap(contexto, gatilho) {
  contextoSap = contexto;
  const salvo = lerJson(CHAVE_SAP)[contexto.chave] || {};
  $("sapDcs").value = salvo.dcs || "";
  $("sapMic").value = salvo.mic || contexto.inst.mic || "";
  $("sapTipo").value = salvo.tipo || "";
  $("sapUnidade").value = salvo.unidade || unidadeSapSugerida(contexto.inst.unidade);
  $("sapOrigem").textContent = contexto.descricao;
  $("sapDica").textContent = contexto.dica;
  $("sapAviso").hidden = true;
  $("sapResumo").textContent = `${contexto.cotacoes.length} ${contexto.cotacoes.length === 1 ? "linha" : "linhas"} · ${rotuloCotacao(contexto.inst.moeda, contexto.inst.unidade)}`;
  Moldura.abrirModal(modalSap, gatilho);
  carregarLib("XLSX").catch(() => { /* o erro aparece ao gerar */ });
}

function avisoSap(texto) {
  const el = $("sapAviso");
  el.textContent = texto;
  el.hidden = false;
  if (Moldura.enviarAltura) Moldura.enviarAltura(true);
}

async function gerarSap() {
  const c = contextoSap;
  if (!c) return;
  const v = validarCamposSap({ dcs: $("sapDcs").value, mic: $("sapMic").value, tipo: $("sapTipo").value, moeda: c.inst.moeda, unidade: $("sapUnidade").value });
  if (!v.ok) return avisoSap(v.erro);
  const linhas = linhasSap(c.cotacoes, v.valores);
  if (!linhas.length) return avisoSap("Não há cotações para exportar.");
  if (chavesRepetidasSap(linhas).length) return avisoSap("Há cotações com a mesma data de preço e o mesmo vencimento: o SAP recusaria a segunda. Recarregue a página e tente de novo.");
  $("sapAviso").hidden = true;

  const botao = $("btnSapGerar");
  botao.disabled = true;
  try {
    const XLSX = await carregarLib("XLSX");
    const ws = XLSX.utils.aoa_to_sheet([COLUNAS_SAP, ...linhas]);
    // Códigos e datas como texto (AAAAMMDD não pode virar número); só o preço é numérico
    for (const endereco of Object.keys(ws)) {
      if (endereco[0] === "!") continue;
      const celula = ws[endereco];
      if (XLSX.utils.decode_cell(endereco).c !== 5 && celula.t !== "s") { celula.t = "s"; celula.v = String(celula.v); }
    }
    ws["!cols"] = LARGURAS_SAP.map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const nome = `Precos DCS ${v.valores.dcs}_${v.valores.mic}_${c.nome}.xlsx`;
    XLSX.writeFile(wb, nome, { bookSST: true });

    const todos = lerJson(CHAVE_SAP);
    todos[c.chave] = { dcs: v.valores.dcs, mic: v.valores.mic, tipo: v.valores.tipo, unidade: v.valores.unidade };
    armazenamento.gravar(CHAVE_SAP, JSON.stringify(todos));
    Moldura.fecharModal(modalSap);
    Moldura.aviso(`Planilha ${nome} gerada com ${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"}.`);
  } catch (e) {
    avisoSap(`Não foi possível gerar a planilha: ${e.message}`);
  } finally {
    botao.disabled = false;
  }
}

function abrirSapDaCurva(gatilho) {
  const c = curvaNaTela;
  if (!c) return;
  const pregao = c.brutos.map((p) => p.data).sort().pop();
  abrirSap({
    chave: `${c.metal.id}:${c.praca.id}`,
    inst: c.inst,
    // Preço como a praça publica (sem conversão): é o que o cadastro da DCS espera
    cotacoes: c.analise.pontos.map((p) => ({ dataPreco: p.data, dataVencimento: p.dataVencimento, preco: p.precoPraca })),
    descricao: `Curva de ${c.metal.nome} em ${c.praca.nome}, pregão de ${fmtData(pregao)}: ${c.analise.pontos.length} vencimentos, em ${rotuloCotacao(c.inst.moeda, c.inst.unidade)}, como a praça publica.`,
    dica: c.praca.id === "lme"
      ? "A data-chave do cash é a liquidação em 2 dias úteis e a do 3 meses, 3 meses depois do pregão: confira com o calendário de datas prompt da LME."
      : "A data-chave de vencimento é aproximada (dia convencional do mês de entrega): ajuste para a data do contrato cadastrada na DCS.",
    nome: `${nomeDeArquivo(c.metal.nome)}_curva_${compacta(pregao)}`
  }, gatilho);
}

function abrirSapDoHist(gatilho) {
  const d = histDados;
  if (!d || !d.pontos.length || d.serie.mensal) return;
  const inst = instrumentoDe(d.metal, d.serie.praca);
  const praca = pracaDe(d.serie.praca);
  const ini = d.pontos[0].data, fim = d.pontos[d.pontos.length - 1].data;
  abrirSap({
    chave: `${d.metal.id}:${d.serie.id}`,
    inst,
    cotacoes: d.pontos.map((p) => ({ dataPreco: p.data, dataVencimento: null, preco: p.valor })),
    descricao: `${d.serie.rotulo} de ${d.metal.nome}, de ${fmtData(ini)} a ${fmtData(fim)}: ${d.pontos.length} cotações diárias, em ${rotuloCotacao(inst.moeda, inst.unidade)}, como ${praca.bolsa === "LME" ? "a LME" : "a praça"} publica.`,
    dica: "Série histórica sem data-chave de vencimento: use um tipo de preço à vista ou de primeiro vencimento do seu cadastro.",
    nome: `${nomeDeArquivo(d.metal.nome)}_${nomeDeArquivo(d.serie.rotulo)}_${compacta(ini)}-${compacta(fim)}`
  }, gatilho);
}

// ================= DESENHO =================

// Junta as respostas que chegam quase juntas num desenho só. Com setTimeout, e não requestAnimationFrame,
// para a tela também se atualizar com a aba em segundo plano (onde o navegador suspende os quadros).
let desenhoPendente = false;
function agendarDesenho() {
  if (desenhoPendente) return;
  desenhoPendente = true;
  setTimeout(() => { desenhoPendente = false; desenhar(); }, 0);
}

function desenhar() {
  renderInfoCambio();
  renderFontes();
  const metal = metalAtual;
  $("cartaoPainel").hidden = !!metal;
  $("cartaoPracas").hidden = $("cartaoCurva").hidden = !metal;
  // Metal sem série histórica pública (vergalhão): o cartão não aparece
  $("cartaoHist").hidden = !metal || !seriesDoMetal(metal).length;
  if (metal) {
    renderPracas(metal);
    renderCurva(metal);
    renderKpis(kpisDoMetal(metal));
  } else {
    renderKpis(kpisDoPainel());
    renderPainel();
  }
}

function selecionarMetal(metal) {
  metalAtual = metal;
  armazenamento.gravar("metais_ult_metal", metal ? metal.id : "");
  renderChips();
  if (metal) {
    pracaCurva = null;
    pracaCurva = escolherPracaCurva(metal);
    const series = seriesDoMetal(metal);
    if (!series.some((s) => s.id === serieHist)) serieHist = series.length ? series[0].id : null;
    const s = serieAtual(metal);
    if (s && !s.periodos.includes(periodoHist)) periodoHist = "1a";
    dataTermo.value = "";
    filtroHist.value = "";
    histDados = null;
    carregarCurva();
    desenhar();
    renderHist();
    carregarHist();
  } else {
    desenhar();
  }
}

// ================= INÍCIO =================

function escolhaInicial(parametro, chave, validos, padrao) {
  const daUrl = PARAMS.get(parametro);
  if (daUrl && validos.includes(daUrl)) return daUrl;
  const salvo = armazenamento.ler(chave);
  return salvo && validos.includes(salvo) ? salvo : padrao;
}

moeda = escolhaInicial("moeda", "metais_moeda", ["original", ...Object.keys(MOEDAS)], "original");
unidade = escolhaInicial("unidade", "metais_unidade", ["original", "t", "kg", "g", "lb", "oz"].filter((u) => u === "original" || UNIDADES[u]), "original");
semIva = armazenamento.ler("metais_sem_iva") === "1";
selMoeda.value = moeda;
selUnidade.value = unidade;
chkIva.checked = semIva;

selMoeda.addEventListener("change", () => {
  moeda = selMoeda.value;
  armazenamento.gravar("metais_moeda", moeda);
  desenhar();
  // Em reais o histórico precisa da PTAX de cada dia: busca de novo
  if (metalAtual) carregarHist();
});
selUnidade.addEventListener("change", () => {
  unidade = selUnidade.value;
  armazenamento.gravar("metais_unidade", unidade);
  desenhar();
  if (metalAtual) renderHist();
});
chkIva.addEventListener("change", () => {
  semIva = chkIva.checked;
  armazenamento.gravar("metais_sem_iva", semIva ? "1" : "0");
  desenhar();
});

$("btnAtualizar").addEventListener("click", () => {
  cachePedidos.clear();
  fontes.curvasComex = {};
  fontes.mensal = null;
  for (const k of Object.keys(falhasCurva)) delete falhasCurva[k];
  carregarBase();
  if (metalAtual) { carregarCurva(); carregarHist(); }
});

filtroPainel.addEventListener("input", renderPainel);
filtroHist.addEventListener("input", renderHist);
dataTermo.addEventListener("input", renderTermo);
document.querySelectorAll("#modoHist .rng").forEach((b) => b.addEventListener("click", () => {
  if (modoHist === b.dataset.modo) return;
  modoHist = b.dataset.modo;
  renderHist();
}));

const nomeDoMetal = () => (metalAtual ? nomeDeArquivo(metalAtual.nome) : "painel");
$("csvPainel").addEventListener("click", () => exportarCsv(tblPainel, `metais_painel_${sufixoHoje()}`));
$("xlsxPainel").addEventListener("click", () => exportarXlsx(tblPainel, `metais_painel_${sufixoHoje()}`, "Cotações por praça", $("contPainel")));
$("csvPracas").addEventListener("click", () => exportarCsv(tblPracas, `metais_${nomeDoMetal()}_pracas_${sufixoHoje()}`));
$("xlsxPracas").addEventListener("click", () => exportarXlsx(tblPracas, `metais_${nomeDoMetal()}_pracas_${sufixoHoje()}`, "Praças", $("contPracas")));
$("csvCurva").addEventListener("click", () => exportarCsv(tblCurva, `metais_${nomeDoMetal()}_curva_${pracaCurva}_${sufixoHoje()}`));
$("xlsxCurva").addEventListener("click", () => exportarXlsx(tblCurva, `metais_${nomeDoMetal()}_curva_${pracaCurva}_${sufixoHoje()}`, "Curva", $("statusCurva")));
$("csvHist").addEventListener("click", () => exportarCsv(tblHist, `metais_${nomeDoMetal()}_historico_${nomeDeArquivo(serieHist)}_${periodoHist}`));
$("xlsxHist").addEventListener("click", () => exportarXlsx(tblHist, `metais_${nomeDoMetal()}_historico_${nomeDeArquivo(serieHist)}_${periodoHist}`, "Histórico", $("statusHist")));

$("sapCurva").addEventListener("click", (e) => abrirSapDaCurva(e.currentTarget));
$("sapHist").addEventListener("click", (e) => abrirSapDoHist(e.currentTarget));
$("btnSapGerar").addEventListener("click", gerarSap);
$("modalSapFechar").addEventListener("click", () => Moldura.fecharModal(modalSap));
modalSap.addEventListener("click", (e) => { if (e.target === modalSap) Moldura.fecharModal(modalSap); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modalSap.hidden) Moldura.fecharModal(modalSap); });

const inicial = PARAMS.has("metal") ? metalDe(PARAMS.get("metal")) : metalDe(armazenamento.ler("metais_ult_metal"));
carregarBase();
selecionarMetal(inicial);
