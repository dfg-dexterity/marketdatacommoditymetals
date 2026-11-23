/*
 * Banco Mundial — Commodity Price Data ("Pink Sheet"): médias mensais nominais em dólar desde 1960,
 * publicadas sob CC BY 4.0. Funções puras sobre o conteúdo já baixado, usadas por api/mensal.js.
 *
 * O endereço da planilha muda a cada edição (tem um código no caminho), então o link é achado na
 * página de mercados de commodities:
 *   página    https://www.worldbank.org/en/research/commodity-markets
 *   planilha  https://thedocs.worldbank.org/en/doc/<código>/related/CMO-Historical-Data-Monthly.xlsx
 *
 * Na aba "Monthly Prices": uma linha com "Updated on …", uma com os nomes das séries (Aluminum, Copper…),
 * a seguinte com as unidades ($/mt, $/troy oz…) e, depois, uma linha por mês com o período na coluna A
 * ("2026M10"). As colunas são achadas pelo NOME da série, nunca pela letra. Valor ausente vem como "…".
 *
 * O XLSX é um ZIP de XML: lido com lib/zip.js e expressões regulares, sem dependências.
 */
import { entradasZip, pareceZip } from "./zip.js";
import { METAIS } from "./catalogo.js";

export const PAGINA_BANCO_MUNDIAL = "https://www.worldbank.org/en/research/commodity-markets";
export const ABA_MENSAL = "Monthly Prices";

const RE_LINK = /https?:\/\/thedocs\.worldbank\.org\/[^"'\s<>]*CMO-Historical-Data-Monthly\.xlsx/i;

/** Link atual da planilha mensal dentro do HTML da página; null se não achar. */
export function acharLinkPlanilha(html) {
  const m = RE_LINK.exec(String(html ?? ""));
  return m ? m[0].replace(/&amp;/g, "&") : null;
}

const decodificar = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, "&");

/**
 * Linhas de uma aba do XLSX: [{ _linha: 7, A: "2026M10", BM: 10740.5, … }]. Texto compartilhado e
 * embutido viram string; o resto, número quando for número. Lança erro se a aba não existir.
 */
export function lerAbaXlsx(bytes, nomeDaAba) {
  if (!pareceZip(bytes)) throw new Error("a planilha do Banco Mundial não veio como arquivo XLSX");
  const arquivos = new Map(entradasZip(bytes).map((e) => [e.nome, e]));
  const texto = (nome) => (arquivos.has(nome) ? arquivos.get(nome).dados().toString("utf8") : null);

  const pasta = texto("xl/workbook.xml");
  const relacoes = texto("xl/_rels/workbook.xml.rels");
  if (!pasta || !relacoes) throw new Error("planilha do Banco Mundial sem a estrutura esperada de um XLSX");

  const abas = [...pasta.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    nome: decodificar((/\bname="([^"]*)"/.exec(m[0]) || [])[1] || ""),
    rid: (/\br:id="([^"]*)"/.exec(m[0]) || [])[1]
  }));
  const aba = abas.find((a) => a.nome === nomeDaAba);
  if (!aba) throw new Error(`planilha do Banco Mundial sem a aba "${nomeDaAba}"`);

  const alvos = new Map();
  for (const m of relacoes.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (/\bId="([^"]*)"/.exec(m[0]) || [])[1];
    const alvo = (/\bTarget="([^"]*)"/.exec(m[0]) || [])[1];
    if (id && alvo) alvos.set(id, alvo);
  }
  const alvo = alvos.get(aba.rid);
  const xml = alvo ? texto(alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`) : null;
  if (!xml) throw new Error(`planilha do Banco Mundial sem o conteúdo da aba "${nomeDaAba}"`);

  const compartilhados = [];
  for (const m of (texto("xl/sharedStrings.xml") || "").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    compartilhados.push(decodificar([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  }

  const linhas = [];
  for (const lm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha = {};
    for (const cm of lm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(cm[1]);
      if (!ref || cm[2] === undefined) continue;
      const tipo = (/\bt="(\w+)"/.exec(cm[1]) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(cm[2]) || /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cm[2]) || [])[1];
      if (v === undefined) continue;
      linha._linha = +ref[2];
      if (tipo === "s") linha[ref[1]] = compartilhados[+v];
      else if (tipo === "str" || tipo === "inlineStr") linha[ref[1]] = decodificar(v);
      else linha[ref[1]] = v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : decodificar(v);
    }
    if (linha._linha) linhas.push(linha);
  }
  return linhas;
}

/** "2026M10" → "2026-10". */
export function periodoBancoMundial(texto) {
  const m = /^(\d{4})M(\d{2})$/.exec(String(texto ?? "").trim());
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}` : null;
}

const limpo = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Lê a planilha mensal:
 *   { atualizado: "November 03, 2026", series: { cobre: { nome: "Copper", unidadeFonte: "($/mt)",
 *     moeda, unidade, pontos: [["1960-01", 715.4], …] } } }
 * Só entram os metais do catálogo com instrumento `bm`; meses sem valor ficam de fora.
 * Lança erro se a linha de nomes não for encontrada.
 */
export function lerPlanilhaMensal(bytes) {
  const linhas = lerAbaXlsx(bytes, ABA_MENSAL);
  const iNomes = linhas.findIndex((l) => Object.entries(l).some(([k, v]) => k !== "_linha" && limpo(v) === "Aluminum"));
  if (iNomes < 0) throw new Error("planilha do Banco Mundial sem a linha de nomes das séries (o layout mudou?)");
  const nomes = linhas[iNomes];
  const unidades = linhas[iNomes + 1] || {};

  const colunaDe = (nome) => {
    const achado = Object.entries(nomes).find(([k, v]) => k !== "_linha" && limpo(v) === nome);
    return achado ? achado[0] : null;
  };

  let atualizado = null;
  for (const l of linhas.slice(0, iNomes)) {
    for (const v of Object.values(l)) {
      const m = /^Updated on\s+(.+)$/i.exec(limpo(v));
      if (m) atualizado = m[1];
    }
  }

  const dados = linhas.map((l) => ({ periodo: periodoBancoMundial(l.A), linha: l })).filter((x) => x.periodo);
  const series = {};
  for (const metal of METAIS) {
    const inst = metal.instrumentos.bm;
    if (!inst) continue;
    const coluna = colunaDe(inst.coluna);
    if (!coluna) continue;
    const pontos = [];
    for (const { periodo, linha } of dados) {
      const v = linha[coluna];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) pontos.push([periodo, v]);
    }
    if (pontos.length) {
      series[metal.id] = { nome: inst.coluna, unidadeFonte: limpo(unidades[coluna]), moeda: inst.moeda, unidade: inst.unidade, pontos };
    }
  }
  if (!Object.keys(series).length) throw new Error("planilha do Banco Mundial sem as séries de metais esperadas");
  return { atualizado, series };
}
