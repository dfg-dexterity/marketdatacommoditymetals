// Funções de /api chamadas direto, com a rede trocada por respostas guardadas em tests/fixtures/.
// Confere o contrato de cada uma: 200 com cache e CORS, 400 sem ir à rede, 404 e 502 em JSON { erro }.
// Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import lme from "../api/lme.js";
import comex from "../api/comex.js";
import shfe from "../api/shfe.js";
import b3 from "../api/b3.js";
import cambio from "../api/cambio.js";
import spot from "../api/spot.js";
import mensal from "../api/mensal.js";
import { pracaDe } from "../lib/catalogo.js";
import { fixarRelogio } from "../lib/relogio.js";

// Segunda-feira 23/11/2026, 06h em Brasília (04h em Nova York, 17h em Xangai): as respostas guardadas
// são desse dia, e o relógio das funções fica parado nele.
fixarRelogio("2026-11-23T09:00:00Z");

const bytes = (nome) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url));
const texto = (nome) => bytes(nome).toString("utf8");

function resFalsa() {
  const cabecalhos = {};
  return {
    statusCode: 200, corpo: undefined, cabecalhos,
    setHeader(k, v) { cabecalhos[k.toLowerCase()] = v; },
    getHeader(k) { return cabecalhos[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.corpo = b; },
    send(b) { this.corpo = b; }
  };
}

/**
 * Chama a função com `query`, respondendo a cada fetch pelo `roteador(url, opcoes)`: devolve
 * { status, corpo } (corpo texto ou Buffer), ou lança erro para simular rede fora do ar.
 */
async function chamar(funcao, query, roteador = () => ({ status: 500, corpo: "sem roteador" })) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, opcoes) => {
    urls.push(String(url));
    const r = await roteador(String(url), opcoes);
    return new Response(r.corpo ?? "", { status: r.status ?? 200 });
  };
  const res = resFalsa();
  try {
    await funcao({ query }, res);
  } finally {
    globalThis.fetch = original;
  }
  return { res, urls };
}

function confereErro(res, status, padrao) {
  assert.equal(res.statusCode, status);
  assert.match(res.corpo.erro, padrao);
  assert.equal(res.cabecalhos["cache-control"], "no-store");
  assert.equal(res.cabecalhos["access-control-allow-origin"], "*");
}

// ------------------------------------------------------------------ LME

test("/api/lme: painel com os seis metais, cache de CDN e CORS", async () => {
  const { res, urls } = await chamar(lme, {}, () => ({ corpo: texto("westmetall-cobre-2026.html") }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.cabecalhos["access-control-allow-origin"], "*");
  assert.equal(res.cabecalhos["cache-control"], "s-maxage=1800, stale-while-revalidate=86400");
  assert.equal(urls.length, 6);
  assert.ok(urls.some((u) => u.endsWith("field=LME_Ni_cash")));
  assert.equal(res.corpo.praca, "lme");
  assert.equal(res.corpo.data, "2026-11-20");
  assert.deepEqual(res.corpo.cotacoes.map((c) => c.metal), ["cobre", "aluminio", "zinco", "niquel", "chumbo", "estanho"]);
  assert.equal(res.corpo.cotacoes[0].cash, 12230.5);
  assert.deepEqual(res.corpo.falhas, []);
});

test("/api/lme: um metal fora do ar não derruba os outros; todos fora dá 502", async () => {
  const parcial = await chamar(lme, {}, (url) => (url.includes("LME_Sn_") ? { status: 503 } : { corpo: texto("westmetall-cobre-2026.html") }));
  assert.equal(parcial.res.statusCode, 200);
  assert.equal(parcial.res.corpo.cotacoes.length, 5);
  assert.deepEqual(parcial.res.corpo.falhas.map((f) => f.metal), ["estanho"]);

  const fora = await chamar(lme, {}, () => ({ status: 503 }));
  confereErro(fora.res, 502, /LME/);
  // página de bloqueio com HTTP 200 também é 502, não 200 enganoso
  const bloqueio = await chamar(lme, {}, () => ({ corpo: "<html>Just a moment...</html>" }));
  confereErro(bloqueio.res, 502, /sem a tabela/);
});

test("/api/lme: histórico por ano e parâmetros inválidos sem ir à rede", async () => {
  const ok = await chamar(lme, { metal: "cobre", ano: "2025" }, () => ({ corpo: texto("westmetall-cobre-2026.html") }));
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.res.cabecalhos["cache-control"], "s-maxage=604800, stale-while-revalidate=86400"); // ano fechado
  assert.ok(ok.urls[0].endsWith("field=LME_Cu_cash&year=2025"));
  assert.equal(ok.res.corpo.pontos.length, 226);
  assert.equal(ok.res.corpo.unidade, "t");

  for (const query of [{ metal: "ouro" }, { metal: "cobre", ano: "1999" }, { metal: "cobre", ano: "20x6" }, { ano: "2025" }]) {
    const r = await chamar(lme, query);
    confereErro(r.res, 400, /inválido/);
    assert.equal(r.urls.length, 0);
  }
});

test("praça desativada no catálogo responde 404 sem consultar a fonte", async () => {
  const praca = pracaDe("lme");
  praca.ativa = false;
  try {
    const r = await chamar(lme, {});
    confereErro(r.res, 404, /desativada/);
    assert.equal(r.urls.length, 0);
  } finally {
    praca.ativa = true;
  }
});

// ------------------------------------------------------------------ COMEX

test("/api/comex: painel usa o contrato de referência e cai no contínuo quando ele não existe", async () => {
  const { res, urls } = await chamar(comex, {}, () => ({ corpo: texto("yahoo-spark.json") }));
  assert.equal(res.statusCode, 200);
  assert.equal(urls.length, 1); // todos os símbolos num pedido só
  assert.equal(res.cabecalhos["cache-control"], "s-maxage=600, stale-while-revalidate=86400");
  const minerio = res.corpo.cotacoes.find((c) => c.metal === "minerio");
  assert.equal(minerio.simbolo, "TIO=F");
  assert.equal(minerio.contrato, null);
  assert.equal(minerio.preco, 90.67);
  assert.ok(res.corpo.cotacoes.every((c) => Number.isFinite(c.preco) && /^\d{4}-\d{2}-\d{2}$/.test(c.data)));
});

test("/api/comex: curva em dois lotes, histórico do contínuo e erros", async () => {
  const curva = await chamar(comex, { metal: "ouro" }, () => ({ corpo: texto("yahoo-spark.json") }));
  assert.equal(curva.res.statusCode, 200);
  assert.equal(curva.urls.length, 2); // 40 meses, 20 símbolos por pedido
  assert.deepEqual(curva.res.corpo.contratos.map((c) => c.contrato), ["Z26", "G27", "Z27", "M28"]);
  assert.equal(curva.res.corpo.unidade, "oz");

  const hist = await chamar(comex, { metal: "cobre", de: "2026-11-01", ate: "2026-11-30" }, () => ({ corpo: texto("yahoo-chart-cobre.json") }));
  assert.equal(hist.res.statusCode, 200);
  assert.equal(hist.res.corpo.simbolo, "HG=F");
  assert.ok(hist.urls[0].includes("/v8/finance/chart/HG%3DF?period1="));
  assert.equal(hist.res.corpo.pontos[0].data, "2026-11-10");

  confereErro((await chamar(comex, { metal: "minerio" })).res, 400, /não tem curva/);
  confereErro((await chamar(comex, { metal: "zinco" })).res, 400, /Metal inválido/);
  confereErro((await chamar(comex, { metal: "ouro", de: "2026-13-01" })).res, 400, /Período inválido/);
  confereErro((await chamar(comex, { metal: "ouro", de: "2026-11-20", ate: "2026-11-01" })).res, 400, /invertido/);
  confereErro((await chamar(comex, { metal: "ouro", de: "1985-06-01" })).res, 400, /mais antiga/);
  confereErro((await chamar(comex, { metal: "ouro", de: "0001-01-01" })).res, 400, /Período inválido/);

  const fora = await chamar(comex, {}, () => ({ status: 500 }));
  confereErro(fora.res, 502, /COMEX/);
  assert.equal(fora.urls.length, 2); // uma nova tentativa antes de desistir
  const html = await chamar(comex, {}, () => ({ corpo: "<html>Too Many Requests</html>" }));
  confereErro(html.res, 502, /não é JSON/);
});

// ------------------------------------------------------------------ SHFE

const roteadorShfe = (url) => {
  if (url.endsWith("currentTradingday.dat")) return { corpo: JSON.stringify({ currentTradingday: "20261123", lastTradingday: "20261120" }) };
  if (url.endsWith("kx20261123.dat")) return { corpo: texto("shfe-kx-em-pregao.json") };
  if (url.endsWith("kx20261120.dat")) return { corpo: texto("shfe-kx-20261120.json") };
  return { status: 404, corpo: "<html>404</html>" };
};

test("/api/shfe: sem data, pula o arquivo do dia ainda em pregão e devolve o último pregão encerrado", async () => {
  const { res, urls } = await chamar(shfe, {}, roteadorShfe);
  assert.equal(res.statusCode, 200);
  assert.equal(res.corpo.data, "2026-11-20");
  assert.ok(urls.some((u) => u.endsWith("kx20261123.dat")));
  assert.deepEqual(Object.keys(res.corpo.pracas), ["shfe", "ine"]);
  assert.equal(res.corpo.pracas.shfe.cobre.length, 12);
  assert.equal(res.cabecalhos["cache-control"], "s-maxage=900, stale-while-revalidate=86400");
});

test("/api/shfe: data explícita, dia sem pregão e data inválida", async () => {
  const ok = await chamar(shfe, { data: "2026-11-20" }, roteadorShfe);
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.urls.length, 1);
  assert.equal(ok.res.cabecalhos["cache-control"], "s-maxage=86400, stale-while-revalidate=86400");

  confereErro((await chamar(shfe, { data: "2026-11-21" }, roteadorShfe)).res, 404, /sem pregão/);
  confereErro((await chamar(shfe, { data: "2026-11-23" }, roteadorShfe)).res, 404, /ainda não tem preço de ajuste/);
  const invalida = await chamar(shfe, { data: "20/11/2026" });
  confereErro(invalida.res, 400, /Data inválida/);
  assert.equal(invalida.urls.length, 0);
  confereErro((await chamar(shfe, { data: "2999-01-01" })).res, 400, /futuro/);
  confereErro((await chamar(shfe, {}, () => ({ status: 503 }))).res, 502, /SHFE/);
});

// ------------------------------------------------------------------ B3

test("/api/b3: último pregão publicado, data explícita e dia sem pregão", async () => {
  const ultimo = await chamar(b3, {}, () => ({ corpo: bytes("b3-sprd-261119.zip") }));
  assert.equal(ultimo.res.statusCode, 200);
  assert.equal(ultimo.res.corpo.metal, "ouro");
  assert.equal(ultimo.res.corpo.data, "2026-11-19");
  assert.equal(ultimo.res.corpo.contratos.length, 6);
  assert.equal(ultimo.res.corpo.moeda, "USD");

  const porData = await chamar(b3, { data: "2026-11-19" }, () => ({ corpo: bytes("b3-sprd-261119.zip") }));
  assert.equal(porData.res.statusCode, 200);
  assert.ok(porData.urls[0].endsWith("filelist=SPRD261119.zip,"));
  assert.equal(porData.res.cabecalhos["cache-control"], "s-maxage=604800, stale-while-revalidate=86400");

  confereErro((await chamar(b3, { data: "2026-11-20" }, () => ({ corpo: bytes("b3-sprd-vazio.zip") }))).res, 404, /sem pregão/);
  confereErro((await chamar(b3, { data: "ontem" })).res, 400, /Data inválida/);
  // O nome do arquivo leva o ano com 2 dígitos: 1926 não pode virar o pregão de 2026
  const antiga = await chamar(b3, { data: "1926-11-19" });
  confereErro(antiga.res, 400, /antiga demais/);
  assert.equal(antiga.urls.length, 0);
  // A fonte devolveu o pregão de outro dia: não é resposta para a data pedida
  confereErro((await chamar(b3, { data: "2026-11-18" }, () => ({ corpo: bytes("b3-sprd-261119.zip") }))).res, 404, /sem pregão/);
  // todos os dias vazios: nenhum pregão publicado
  confereErro((await chamar(b3, {}, () => ({ corpo: bytes("b3-sprd-vazio.zip") }))).res, 502, /nenhum pregão publicado/);
  confereErro((await chamar(b3, {}, () => ({ corpo: "<html>manutenção</html>" }))).res, 502, /não é o arquivo de pregão/);
});

// ------------------------------------------------------------------ câmbio

test("/api/cambio: recua até o último boletim de fechamento e traz o ouro", async () => {
  let pedidos = 0;
  const { res, urls } = await chamar(cambio, {}, () => (++pedidos < 3 ? { status: 404, corpo: "<html>404</html>" } : { corpo: bytes("bcb-fechamento-20261119.csv") }));
  assert.equal(res.statusCode, 200);
  assert.equal(urls.length, 3);
  assert.equal(res.corpo.data, "2026-11-19");
  assert.equal(res.corpo.brl.USD, 5.8889);
  assert.equal(res.corpo.brl.CNY, 0.8834);
  assert.deepEqual(res.corpo.ouro, { compra: 695.359, venda: 695.4299, moeda: "BRL", unidade: "g" });

  confereErro((await chamar(cambio, {}, () => ({ status: 404 }))).res, 502, /nenhum boletim/);
  confereErro((await chamar(cambio, {}, () => ({ corpo: "<html>erro</html>" }))).res, 502, /fora do formato/);
});

test("/api/cambio: série do dólar por período e validações", async () => {
  const ok = await chamar(cambio, { de: "2026-11-10", ate: "2026-11-23" }, () => ({ corpo: texto("bcb-dolar-periodo.json") }));
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.res.corpo.pontos.length, 8);
  assert.ok(ok.urls[0].includes("CotacaoDolarPeriodo"));

  // 26 anos num pedido só (histórico inteiro da COMEX em reais) é aceito; mais de 30, não
  const longo = await chamar(cambio, { de: "2000-08-20", ate: "2026-11-23" }, () => ({ corpo: texto("bcb-dolar-periodo.json") }));
  assert.equal(longo.res.statusCode, 200);

  for (const query of [{ de: "2026-11-10" }, { de: "2026-11-23", ate: "2026-11-10" }, { de: "1990-01-01", ate: "2026-11-23" }]) {
    const r = await chamar(cambio, query);
    confereErro(r.res, 400, /Período/);
    assert.equal(r.urls.length, 0);
  }
});

// ------------------------------------------------------------------ spot e Banco Mundial

test("/api/spot: metal fora do ar entra em falhas; todos fora dá 502", async () => {
  const { res } = await chamar(spot, {}, (url) => (url.endsWith("/XPD") ? { status: 500 } : { corpo: texto("gold-api-xau.json") }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.corpo.cotacoes.map((c) => c.metal), ["cobre", "ouro", "prata", "platina"]);
  assert.deepEqual(res.corpo.falhas.map((f) => f.metal), ["paladio"]);
  assert.equal(res.corpo.cotacoes[1].unidade, "oz");
  confereErro((await chamar(spot, {}, () => ({ status: 500 }))).res, 502, /preço à vista/);
});

test("/api/mensal: acha o link na página, baixa a planilha e devolve as séries", async () => {
  const { res, urls } = await chamar(mensal, {}, (url) => (url.includes("thedocs.worldbank.org") ? { corpo: bytes("banco-mundial-mensal.xlsx") } : { corpo: texto("banco-mundial-pagina.html") }));
  assert.equal(res.statusCode, 200);
  assert.equal(urls.length, 2);
  assert.equal(res.corpo.atualizado, "November 03, 2026");
  assert.deepEqual(res.corpo.series.cobre.pontos.at(-1), ["2026-10", 14508]);
  assert.match(res.corpo.fonte, /CC BY 4\.0/);

  confereErro((await chamar(mensal, {}, () => ({ corpo: "<html>sem planilha</html>" }))).res, 502, /não traz mais o link/);
  confereErro((await chamar(mensal, {}, (url) => (url.includes("thedocs") ? { corpo: "<html>erro</html>" } : { corpo: texto("banco-mundial-pagina.html") }))).res, 502, /XLSX/);
});
