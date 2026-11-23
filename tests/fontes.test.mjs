// Leitores das fontes, com respostas reais guardadas em tests/fixtures/ (capturadas em 23/11/2026).
// Sem rede. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { urlTabelaLme, dataPorExtenso, numeroIngles, lerTabelaLme, mediaDoMes, resumoLme } from "../lib/westmetall.js";
import {
  simboloContinuo, simboloContrato, contratoDoSimbolo, mesesAFrente, vencimentoDeReferencia, urlSpark, urlChart,
  emLotes, lerSpark, lerChart, barraEncerrada, mesAtualNY
} from "../lib/yahoo.js";
import { urlBoletimShfe, produtosShfe, vencimentoShfe, lerPregoesShfe, lerBoletimShfe, contratoPrincipal } from "../lib/shfe.js";
import { arquivoSprd, urlSprd, xmlDoSprd, lerContratosB3 } from "../lib/b3.js";
import { urlFechamento, numeroBrasileiro, dataBrasileira, lerFechamento, urlDolarPeriodo, lerDolarPeriodo, taxaVigente } from "../lib/bcb.js";
import { urlSpot, simbolosSpot, lerSpot } from "../lib/spot.js";
import { acharLinkPlanilha, lerAbaXlsx, periodoBancoMundial, lerPlanilhaMensal } from "../lib/bancomundial.js";
import { entradasZip, pareceZip } from "../lib/zip.js";

const bytes = (nome) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url));
const texto = (nome) => bytes(nome).toString("utf8");
const json = (nome) => JSON.parse(texto(nome));

// Segunda-feira 23/11/2026, 04h em Nova York: a barra do dia 23 ainda está em pregão
const CEDO = new Date("2026-11-23T09:00:00Z");
// Mesma segunda, 18h30 em Nova York: o pregão do dia 23 já fechou
const TARDE = new Date("2026-11-23T23:30:00Z");

// ------------------------------------------------------------------ LME (Westmetall)

test("LME: URL, data por extenso e número no padrão inglês", () => {
  assert.equal(urlTabelaLme("Cu"), "https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Cu_cash");
  assert.equal(urlTabelaLme("Al", 2025), "https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash&year=2025");
  assert.equal(dataPorExtenso("20. November 2026"), "2026-11-20");
  assert.equal(dataPorExtenso("02. January 2026"), "2026-01-02");
  assert.equal(dataPorExtenso("date"), null);
  assert.equal(dataPorExtenso("31. February 2026"), null);
  assert.equal(numeroIngles("12,230.50"), 12230.5);
  assert.equal(numeroIngles("-4,800"), -4800);
  assert.equal(numeroIngles("66"), 66);
  assert.equal(numeroIngles("-"), null);
  assert.equal(numeroIngles(""), null);
  assert.equal(numeroIngles("12.230,50"), null); // padrão alemão não é aceito em silêncio
});

test("LME: tabela diária do cobre em 2026, em ordem cronológica e sem as linhas de cabeçalho repetidas", () => {
  const pontos = lerTabelaLme(texto("westmetall-cobre-2026.html"));
  assert.equal(pontos.length, 226);
  assert.deepEqual(pontos[0], { data: "2026-01-02", cash: 12571, tresMeses: 12511, estoque: 145325 });
  assert.deepEqual(pontos.at(-1), { data: "2026-11-20", cash: 12230.5, tresMeses: 12237, estoque: 332025 });
  assert.ok(pontos.every((p, i) => i === 0 || pontos[i - 1].data < p.data));
});

test("LME: resumo do painel com variação do dia, do estoque e médias do mês", () => {
  const pontos = lerTabelaLme(texto("westmetall-cobre-2026.html"));
  const r = resumoLme("cobre", pontos);
  assert.equal(r.data, "2026-11-20");
  assert.equal(r.dataAnterior, "2026-11-19");
  assert.equal(r.anteriorCash, 12570);
  assert.equal(r.anteriorTresMeses, 12555);
  assert.equal(r.variacaoEstoque, 4500);
  // As médias batem com as publicadas pela própria Westmetall: 13.608,47 (nov, parcial) e 14.532,48 (out)
  assert.equal(r.mediaMes.dias, 15);
  assert.equal(r.mediaMes.media.toFixed(2), "13608.47");
  assert.equal(r.mediaMesAnterior.mes, "2026-10");
  assert.equal(r.mediaMesAnterior.media.toFixed(2), "14532.48");
  assert.equal(mediaDoMes(pontos, "2025-12"), null);
  assert.equal(resumoLme("cobre", []), null);
});

test("LME: página sem a tabela (layout mudou, bloqueio) lança erro em vez de devolver vazio", () => {
  assert.throws(() => lerTabelaLme("<html><body>Just a moment...</body></html>"), /sem a tabela/);
  const zero = lerTabelaLme("<table><tr><th>date</th><th>LME Lead Cash-Settlement</th><th>LME Lead 3-month</th><th>LME Lead stock</th></tr><tr><td>10. January 2008</td><td>0.00</td><td>0.00</td><td>45,000</td></tr><tr><td>11. January 2008</td><td>2,600.00</td><td>2,610.00</td><td>45,100</td></tr></table>");
  assert.deepEqual(zero.map((p) => p.data), ["2008-01-11"]); // preço zero = dia sem cotação
});

// ------------------------------------------------------------------ COMEX (Yahoo)

test("COMEX: símbolos por contrato e contínuo", () => {
  assert.equal(simboloContinuo("GC"), "GC=F");
  assert.equal(simboloContrato("GC", "2026-12", "CMX"), "GCZ26.CMX");
  assert.equal(simboloContrato("PL", "2027-01", "NYM"), "PLF27.NYM");
  assert.deepEqual(contratoDoSimbolo("ALIZ26.CMX"), { raiz: "ALI", codigo: "Z26", vencimento: "2026-12" });
  assert.deepEqual(contratoDoSimbolo("HGH27.CMX"), { raiz: "HG", codigo: "H27", vencimento: "2027-03" });
  assert.equal(contratoDoSimbolo("GC=F"), null);
  assert.deepEqual(mesesAFrente("2026-11", 3), ["2026-11", "2026-12", "2027-01"]);
  assert.equal(emLotes(Array.from({ length: 45 }, (_, i) => i)).length, 3);
  assert.ok(urlSpark(["GC=F", "GCZ26.CMX"]).endsWith("/v8/finance/spark?symbols=GC%3DF,GCZ26.CMX&range=1mo&interval=1d"));
  assert.ok(urlChart("HG=F", 10, 20).endsWith("/v8/finance/chart/HG%3DF?period1=10&period2=20&interval=1d"));
});

test("COMEX: vencimento de referência é o primeiro do ciclo depois do mês corrente", () => {
  const ouro = [2, 4, 6, 8, 12], prata = [3, 5, 7, 9, 12], platina = [1, 4, 7, 10];
  assert.equal(vencimentoDeReferencia(ouro, "2026-11"), "2026-12");
  assert.equal(vencimentoDeReferencia(ouro, "2026-12"), "2027-02"); // dezembro já está em entrega
  assert.equal(vencimentoDeReferencia(prata, "2026-12"), "2027-03");
  assert.equal(vencimentoDeReferencia(platina, "2026-11"), "2027-01");
  assert.equal(vencimentoDeReferencia(null, "2026-11"), "2026-12"); // sem ciclo: o mês seguinte
  assert.equal(vencimentoDeReferencia(ouro, "novembro"), null);
  assert.equal(mesAtualNY(new Date("2026-12-01T03:00:00Z")), "2026-11"); // ainda é 30/11 em Nova York
});

test("COMEX: durante o pregão a referência é o ajuste do dia anterior, e o negócio do dia sai à parte", () => {
  const s = lerSpark(json("yahoo-spark.json"), CEDO);
  assert.equal(Object.keys(s).length, 11);
  assert.deepEqual(s["GCZ26.CMX"], {
    data: "2026-11-20", preco: 3515.4, dataAnterior: "2026-11-19", anterior: 3685.5,
    intradia: { data: "2026-11-23", preco: 3611.7 }
  });
  // Contrato sem negócio no dia: a barra de hoje vem nula e não vira "intradia"
  assert.deepEqual(s["HRCZ26.CMX"], { data: "2026-11-20", preco: 1398, dataAnterior: "2026-11-19", anterior: 1401, intradia: null });
  assert.equal(s["TIO=F"].preco, 90.67);
});

test("COMEX: contrato sem barra num dia não ganha variação do dia contra um pregão mais antigo", () => {
  // Sexta 20/11 cedo: a referência é quinta 19/11. TIO e HRC não têm barra de 18/11, só de 17/11.
  const s = lerSpark(json("yahoo-spark.json"), new Date("2026-11-20T09:00:00Z"));
  assert.deepEqual(s["GCZ26.CMX"], { data: "2026-11-19", preco: 3685.5, dataAnterior: "2026-11-18", anterior: 3741.9, intradia: { data: "2026-11-20", preco: 3515.4 } });
  assert.equal(s["TIO=F"].data, "2026-11-19");
  assert.equal(s["TIO=F"].anterior, null);
  assert.equal(s["TIO=F"].dataAnterior, null);
  assert.equal(s["HRCZ26.CMX"].anterior, null);
});

test("COMEX: ruído de ponto flutuante de 32 bits some com 7 algarismos significativos", () => {
  const ts = [Date.UTC(2026, 10, 19, 5) / 1000, Date.UTC(2026, 10, 20, 5) / 1000];
  const corpo = (valores) => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ close: valores.map(Math.fround) }] } }] } });
  assert.deepEqual(lerChart(corpo([3741.9, 3515.4]), CEDO).map((p) => p.preco), [3741.9, 3515.4]);
  assert.deepEqual(lerChart(corpo([45.059, 90.67]), CEDO).map((p) => p.preco), [45.059, 90.67]);
  assert.deepEqual(lerChart(corpo([5.485, 12345.67]), CEDO).map((p) => p.preco), [5.485, 12345.67]);
});

test("COMEX: depois do fechamento a barra do dia passa a ser a referência", () => {
  assert.equal(barraEncerrada("2026-11-23", CEDO), false);
  assert.equal(barraEncerrada("2026-11-20", CEDO), true);
  assert.equal(barraEncerrada("2026-11-23", TARDE), true);
  const s = lerSpark(json("yahoo-spark.json"), TARDE);
  assert.deepEqual(s["GCZ26.CMX"], { data: "2026-11-23", preco: 3611.7, dataAnterior: "2026-11-20", anterior: 3515.4, intradia: null });
});

test("COMEX: histórico do contínuo sem ruído de ponto flutuante e só com barras encerradas", () => {
  const pontos = lerChart(json("yahoo-chart-cobre.json"), CEDO);
  assert.equal(pontos.length, 9);
  assert.deepEqual(pontos[0], { data: "2026-11-10", preco: 6.2195 });
  assert.deepEqual(pontos.at(-1), { data: "2026-11-20", preco: 5.477 });
  assert.throws(() => lerChart({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }), /recusou a consulta/);
  assert.throws(() => lerChart({}), /fora do formato/);
  assert.throws(() => lerSpark([]), /fora do formato/);
  assert.deepEqual(lerSpark({ "XX=F": { timestamp: null } }, CEDO), {});
});

// ------------------------------------------------------------------ SHFE

test("SHFE: URL, vencimento e produtos tirados do catálogo", () => {
  assert.equal(urlBoletimShfe("2026-11-20"), "https://www.shfe.com.cn/data/tradedata/future/dailydata/kx20261120.dat");
  assert.equal(vencimentoShfe("2701"), "2027-01");
  assert.equal(vencimentoShfe("2612 "), "2026-12"); // arquivos antigos têm espaço à direita
  assert.equal(vencimentoShfe("小计"), null);
  assert.equal(vencimentoShfe("2713"), null);
  const p = produtosShfe();
  assert.deepEqual(p.get("cu_f"), { praca: "shfe", metal: "cobre" });
  assert.deepEqual(p.get("bc_f"), { praca: "ine", metal: "cobre" });
  assert.equal(p.has("ru_f"), false); // borracha não é metal
  assert.deepEqual(lerPregoesShfe({ currentTradingday: "20261124", lastTradingday: "20261123" }), { atual: "2026-11-24", anterior: "2026-11-23" });
  assert.deepEqual(lerPregoesShfe(null), { atual: null, anterior: null });
});

test("SHFE: boletim de 20/11/2026 com todos os vencimentos, sem subtotais nem produtos de fora", () => {
  const b = lerBoletimShfe(json("shfe-kx-20261120.json"));
  assert.equal(b.data, "2026-11-20");
  assert.equal(b.completo, true);
  assert.deepEqual(Object.keys(b.pracas.shfe), ["cobre", "aluminio", "zinco", "chumbo", "niquel", "estanho", "ouro", "prata", "vergalhao", "aco"]);
  assert.deepEqual(Object.keys(b.pracas.ine), ["cobre"]);
  const cobre = b.pracas.shfe.cobre;
  assert.equal(cobre.length, 12);
  assert.deepEqual(cobre[0], { contrato: "2612", vencimento: "2026-12", data: "2026-11-20", preco: 96040, anterior: 98020, fechamento: 95010, volume: 129486, emAberto: 139861 });
  assert.deepEqual(cobre.map((c) => c.vencimento), cobre.map((c) => c.vencimento).slice().sort());
  assert.equal(b.pracas.shfe.ouro.length, 8);
  // Cobre doméstico (com IVA de 13%) contra o internacional da INE (sem IVA), mesmo vencimento
  const razao = cobre[0].preco / b.pracas.ine.cobre[0].preco;
  assert.ok(razao > 1.08 && razao < 1.14, `razão cu/bc = ${razao}`);
});

test("SHFE: contrato principal é o de maior posição em aberto; arquivo do dia em pregão é incompleto", () => {
  const b = lerBoletimShfe(json("shfe-kx-20261120.json"));
  assert.equal(contratoPrincipal(b.pracas.shfe.cobre).contrato, "2701");
  assert.equal(contratoPrincipal(b.pracas.shfe.ouro).contrato, "2702");
  assert.equal(contratoPrincipal([]), null);
  assert.equal(contratoPrincipal([{ contrato: "x", preco: null, emAberto: 9 }]), null);

  const emPregao = lerBoletimShfe(json("shfe-kx-em-pregao.json"));
  assert.equal(emPregao.data, "2026-11-23");
  assert.equal(emPregao.completo, false);
  assert.equal(emPregao.pracas.shfe.cobre[0].preco, null);
  assert.equal(emPregao.pracas.shfe.cobre[0].anterior, 96040);
  assert.throws(() => lerBoletimShfe({ o_code: "0000" }), /fora do formato/);
  assert.throws(() => lerBoletimShfe({ o_curinstrument: [] }), /sem a data/);
});

// ------------------------------------------------------------------ B3

test("B3: nome do arquivo e URL do boletim de pregão", () => {
  assert.equal(arquivoSprd("2026-11-19"), "SPRD261119.zip");
  assert.equal(urlSprd("2026-11-19"), "https://www.b3.com.br/pesquisapregao/download?filelist=SPRD261119.zip,");
});

test("B3: ZIP dentro de ZIP — vale o último XML, e os contratos do GLD saem em ordem de vencimento", () => {
  const xml = xmlDoSprd(bytes("b3-sprd-261119.zip"));
  const contratos = lerContratosB3(xml, "GLD");
  assert.deepEqual(contratos.map((c) => c.ticker), ["GLDX26", "GLDZ26", "GLDF27", "GLDG27", "GLDJ27", "GLDM27"]);
  assert.deepEqual(contratos[1], {
    contrato: "Z26", ticker: "GLDZ26", vencimento: "2026-12", data: "2026-11-19",
    preco: 3694.25, // o XML anterior do mesmo ZIP traz 3600,00: o leitor tem de preferir o último
    anterior: 3755.5, ultimo: 3623.25, emAberto: 132387, negocios: 1429, moeda: "USD"
  });
  assert.equal(contratos[2].emAberto, null); // vencimento sem posição em aberto
  assert.deepEqual(lerContratosB3(xml, "XYZ"), []);
});

test("B3: dia sem pregão devolve ZIP vazio (null); resposta que não é ZIP lança erro", () => {
  assert.equal(xmlDoSprd(bytes("b3-sprd-vazio.zip")), null);
  assert.throws(() => xmlDoSprd(Buffer.from("<html>erro</html>")), /não é o arquivo de pregão/);
  assert.equal(pareceZip(bytes("b3-sprd-vazio.zip")), true);
  assert.deepEqual(entradasZip(bytes("b3-sprd-vazio.zip")), []);
  assert.throws(() => entradasZip(Buffer.from("PK isto não é um zip de verdade")), /não é um ZIP/);
  // arquivo cortado no meio do download
  const inteiro = bytes("b3-sprd-261119.zip");
  assert.throws(() => xmlDoSprd(inteiro.subarray(0, inteiro.length >> 1)), /não é um ZIP/);
});

// ------------------------------------------------------------------ Banco Central

test("Banco Central: números e datas no padrão brasileiro", () => {
  assert.equal(numeroBrasileiro("5,88890000"), 5.8889);
  assert.equal(numeroBrasileiro("1.011,86000000"), 1011.86);
  assert.equal(numeroBrasileiro("abc"), null);
  assert.equal(dataBrasileira("19/11/2026"), "2026-11-19");
  assert.equal(dataBrasileira("2026-11-19"), null);
  assert.equal(urlFechamento("2026-11-19"), "https://www4.bcb.gov.br/Download/fechamento/20261119.csv");
});

test("Banco Central: boletim de fechamento com dólar, iuane e ouro em reais por grama", () => {
  const f = lerFechamento(bytes("bcb-fechamento-20261119.csv").toString("latin1"));
  assert.equal(f.data, "2026-11-19");
  assert.deepEqual(f.brl, { USD: 5.8889, JPY: 0.03685, GBP: 7.7262, CNY: 0.8834, EUR: 6.4672 });
  assert.equal(f.compra.USD, 5.8883);
  assert.deepEqual(f.ouro, { compra: 695.359, venda: 695.4299 });
  // Conferência de unidade: R$/g × 31,1035 g ÷ dólar ≈ ouro em US$/onça troy do mesmo dia
  const emDolarPorOnca = f.ouro.venda * 31.1034768 / f.brl.USD;
  assert.ok(emDolarPorOnca > 3600 && emDolarPorOnca < 3750, `ouro = ${emDolarPorOnca} US$/oz`);
  assert.throws(() => lerFechamento("<html>Not Found</html>"), /fora do formato/);
});

test("Banco Central: série do dólar por período e taxa vigente em dia sem boletim", () => {
  assert.ok(urlDolarPeriodo("2026-11-10", "2026-11-23").includes("@dataInicial='11-10-2026'&@dataFinalCotacao='11-23-2026'"));
  const serie = lerDolarPeriodo(json("bcb-dolar-periodo.json"));
  assert.equal(serie.length, 8);
  assert.deepEqual(serie[0], { data: "2026-11-10", compra: 5.5834, venda: 5.584 });
  assert.deepEqual(serie.at(-1), { data: "2026-11-19", compra: 5.8883, venda: 5.8889 });
  const taxa = taxaVigente(serie);
  assert.equal(taxa("2026-11-19").venda, 5.8889);
  assert.equal(taxa("2026-11-20").data, "2026-11-19"); // feriado no Brasil: vale o último boletim
  assert.equal(taxa("2026-11-14").data, "2026-11-13"); // sábado
  assert.equal(taxa("2026-11-09"), null); // antes do início da série
  assert.throws(() => lerDolarPeriodo({ erro: "x" }), /sem a lista value/);
});

// ------------------------------------------------------------------ spot

test("spot: símbolos do catálogo e leitura da resposta", () => {
  assert.equal(urlSpot("XAU"), "https://api.gold-api.com/price/XAU");
  assert.deepEqual(simbolosSpot().map((s) => `${s.metal}:${s.simbolo}`), ["cobre:HG", "ouro:XAU", "prata:XAG", "platina:XPT", "paladio:XPD"]);
  assert.deepEqual(lerSpot(json("gold-api-xau.json")), { preco: 3620.850098, moeda: "USD", atualizado_em: "2026-11-23T06:18:41.000Z" });
  assert.throws(() => lerSpot({ price: 21508.9, currency: "BRL" }), /veio em BRL/);
  assert.throws(() => lerSpot({ error: "rate limit" }), /fora do formato/);
});

// ------------------------------------------------------------------ Banco Mundial

test("Banco Mundial: link da planilha na página e período", () => {
  assert.equal(
    acharLinkPlanilha(texto("banco-mundial-pagina.html")),
    "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx"
  );
  assert.equal(acharLinkPlanilha("<html>sem link</html>"), null);
  assert.equal(periodoBancoMundial("2026M10"), "2026-10");
  assert.equal(periodoBancoMundial("2026M13"), null);
  assert.equal(periodoBancoMundial("Updated on"), null);
});

test("Banco Mundial: planilha mensal lida pelo nome da aba e das colunas", () => {
  const p = lerPlanilhaMensal(bytes("banco-mundial-mensal.xlsx"));
  assert.equal(p.atualizado, "November 03, 2026");
  assert.deepEqual(Object.keys(p.series), ["cobre", "aluminio", "zinco", "niquel", "chumbo", "estanho", "ouro", "prata", "platina", "minerio"]);
  assert.deepEqual(p.series.cobre.pontos[0], ["1960-01", 715]);
  assert.deepEqual(p.series.cobre.pontos.at(-1), ["2026-10", 14508]);
  assert.deepEqual(p.series.ouro.pontos.at(-1), ["2026-10", 4105]);
  assert.equal(p.series.cobre.unidadeFonte, "($/mt)");
  assert.equal(p.series.ouro.unidade, "oz");
  assert.throws(() => lerAbaXlsx(bytes("banco-mundial-mensal.xlsx"), "Aba que não existe"), /sem a aba/);
  assert.throws(() => lerPlanilhaMensal(Buffer.from("<html>erro</html>")), /não veio como arquivo XLSX/);
});
