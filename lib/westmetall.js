/*
 * LME (London Metal Exchange) pelas tabelas públicas da Westmetall: preço oficial cash settlement,
 * 3 meses e estoque, um ano por página, desde 2008. Funções puras (sem rede), usadas por api/lme.js.
 *
 *   https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Cu_cash[&year=2025]
 *
 * A página traz uma <table> com as colunas date | Cash-Settlement | 3-month | stock e uma linha por
 * pregão, da mais nova para a mais antiga; a linha de cabeçalho se repete a cada mês. Números no padrão
 * inglês ("12,230.50"); data por extenso em inglês ("20. November 2026").
 */
import { dataValida, mesDe } from "./datas.js";

export const URL_WESTMETALL = "https://www.westmetall.com/en/markdaten.php";

/** Primeiro ano com dados na Westmetall. */
export const PRIMEIRO_ANO_LME = 2008;

const MESES_INGLES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** URL da tabela diária de um campo da LME ("Cu", "Al"…). Sem `ano`, o ano corrente. */
export function urlTabelaLme(campo, ano) {
  const base = `${URL_WESTMETALL}?action=table&field=LME_${campo}_cash`;
  return ano ? `${base}&year=${ano}` : base;
}

/** "20. November 2026" → "2026-11-20"; null se não for data. */
export function dataPorExtenso(texto) {
  const m = /^(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{4})$/.exec(String(texto ?? "").trim());
  if (!m) return null;
  const mes = MESES_INGLES.indexOf(m[2].toLowerCase());
  if (mes < 0) return null;
  const iso = `${m[3]}-${String(mes + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return dataValida(iso) ? iso : null;
}

/** "12,230.50" → 12230.5; "-4,800" → -4800; "-", "" e texto → null. */
export function numeroIngles(texto) {
  const s = String(texto ?? "").replace(/−/g, "-").replace(/[\s ]/g, "");
  if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const textoDaCelula = (html) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function celulas(linha) {
  return [...linha.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => textoDaCelula(m[1]));
}

/**
 * Lê a tabela diária: [{ data, cash, tresMeses, estoque }] em ordem cronológica.
 * As colunas são achadas pelo NOME no cabeçalho (Cash-Settlement, 3-month, stock), não pela posição.
 * Preço zero é tratado como ausente (a fonte grava 0 em dias sem cotação). Lança erro se a página não
 * tiver a tabela — sinal de que o layout mudou.
 */
export function lerTabelaLme(html) {
  const texto = String(html ?? "");
  const linhas = [...texto.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => celulas(m[1]));
  const cabecalho = linhas.find((c) => c.length >= 2 && /^date$/i.test(c[0]) && c.some((x) => /cash-settlement/i.test(x)));
  if (!cabecalho) throw new Error("página da Westmetall sem a tabela de cotações da LME (o layout mudou?)");
  const iCash = cabecalho.findIndex((x) => /cash-settlement/i.test(x));
  const iTres = cabecalho.findIndex((x) => /3-month/i.test(x));
  const iEstoque = cabecalho.findIndex((x) => /stock/i.test(x));

  const preco = (c, i) => {
    const n = i >= 0 ? numeroIngles(c[i]) : null;
    return n !== null && n > 0 ? n : null;
  };
  const porData = new Map();
  for (const c of linhas) {
    const data = dataPorExtenso(c[0]);
    if (!data) continue;
    const ponto = { data, cash: preco(c, iCash), tresMeses: preco(c, iTres), estoque: iEstoque >= 0 ? numeroIngles(c[iEstoque]) : null };
    if (ponto.cash === null && ponto.tresMeses === null) continue;
    porData.set(data, ponto);
  }
  return [...porData.keys()].sort().map((d) => porData.get(d));
}

/** Média simples de `chave` nos pontos do mês "AAAA-MM"; null se o mês não tiver pontos. */
export function mediaDoMes(pontos, mes, chave = "cash") {
  const valores = pontos.filter((p) => mesDe(p.data) === mes).map((p) => p[chave]).filter(Number.isFinite);
  return valores.length ? { mes, media: valores.reduce((a, b) => a + b, 0) / valores.length, dias: valores.length } : null;
}

/**
 * Resumo do metal para o painel, a partir dos pontos diários (ordem cronológica): último pregão, o
 * anterior (para a variação do dia), variação do estoque e médias do mês corrente (parcial) e do anterior.
 */
export function resumoLme(metal, pontos) {
  if (!pontos || !pontos.length) return null;
  const u = pontos[pontos.length - 1];
  const a = pontos.length > 1 ? pontos[pontos.length - 2] : null;
  const mes = mesDe(u.data);
  const mesesAnteriores = [...new Set(pontos.map((p) => mesDe(p.data)))].filter((m) => m < mes);
  const mesAnterior = mesesAnteriores.length ? mesesAnteriores[mesesAnteriores.length - 1] : null;
  return {
    metal,
    data: u.data,
    cash: u.cash,
    tresMeses: u.tresMeses,
    estoque: u.estoque,
    dataAnterior: a ? a.data : null,
    anteriorCash: a ? a.cash : null,
    anteriorTresMeses: a ? a.tresMeses : null,
    variacaoEstoque: a && Number.isFinite(u.estoque) && Number.isFinite(a.estoque) ? u.estoque - a.estoque : null,
    mediaMes: mediaDoMes(pontos, mes),
    mediaMesAnterior: mesAnterior ? mediaDoMes(pontos, mesAnterior) : null
  };
}
