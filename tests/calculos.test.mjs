// Catálogo, datas, conversões, curva e painel — funções puras, sem rede. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { METAIS, PRACAS, metalDe, pracaDe, instrumentoDe, metaisDaPraca, pracasDoMetal } from "../lib/catalogo.js";
import {
  dataValida, somarDias, diasEntre, compacta, deCompacta, fmtData, rotuloMes, somarMeses, mesesEntre,
  ultimoDiaDoMes, somarMesesAoDia, hojeEm, horaEm, diasDeSemanaAte, somarDiasDeSemana, ajustarParaDiaDeSemana,
  vencimentoDoCodigo, codigoDoVencimento
} from "../lib/datas.js";
import { UNIDADES, MOEDAS, fatorUnidade, taxaEntre, converterPreco, cotacaoDestino, rotuloCotacao, casasDoPreco, variacaoPct } from "../lib/unidades.js";
import { diaDoVencimento, ordenarCurva, analisarCurva, interpolarPreco } from "../lib/curva.js";
import { cotacoesDoMetal, linhasDoPainel, curvaDoMetal, pracasComCurva, mediasMensais, rotuloContrato } from "../lib/painel.js";

const perto = (a, b, tolerancia = 1e-6) => assert.ok(Math.abs(a - b) <= tolerancia, `${a} deveria ser ≈ ${b}`);

// ------------------------------------------------------------------ catálogo

test("catálogo: ids únicos, na ordem publicada, e cada instrumento aponta para uma praça que existe", () => {
  assert.deepEqual(METAIS.map((m) => m.id), ["cobre", "aluminio", "zinco", "niquel", "chumbo", "estanho", "ouro", "prata", "platina", "paladio", "minerio", "aco", "vergalhao"]);
  assert.deepEqual(PRACAS.map((p) => p.id), ["lme", "comex", "shfe", "ine", "b3", "bcb", "spot", "bm"]);
  for (const m of METAIS) {
    assert.ok(Object.keys(m.instrumentos).length > 0, `${m.id} sem instrumento`);
    assert.ok(MOEDAS[m.comparacao.moeda] && UNIDADES[m.comparacao.unidade], `${m.id}: comparação inválida`);
    for (const [praca, i] of Object.entries(m.instrumentos)) {
      assert.ok(pracaDe(praca), `${m.id}: praça ${praca} não existe`);
      assert.ok(MOEDAS[i.moeda], `${m.id}/${praca}: moeda ${i.moeda}`);
      assert.ok(UNIDADES[i.unidade], `${m.id}/${praca}: unidade ${i.unidade}`);
    }
  }
});

test("catálogo: instrumento resolve MIC e IVA; metal ou praça inexistente dá null", () => {
  assert.equal(instrumentoDe("cobre", "lme").mic, "XLME");
  assert.equal(instrumentoDe("cobre", "comex").mic, "XCEC");
  assert.equal(instrumentoDe("platina", "comex").mic, "XNYM"); // platina e paládio são NYMEX
  assert.equal(instrumentoDe("cobre", "shfe").iva, true);
  assert.equal(instrumentoDe("cobre", "ine").iva, false); // cobre internacional é sem IVA
  assert.equal(instrumentoDe("ouro", "shfe").iva, false); // ouro é isento
  assert.equal(instrumentoDe("ouro", "lme"), null);
  assert.equal(instrumentoDe("urânio", "lme"), null);
  assert.equal(metalDe("COBRE").id, "cobre");
  assert.deepEqual(metaisDaPraca("lme").map((m) => m.id), ["cobre", "aluminio", "zinco", "niquel", "chumbo", "estanho"]);
  assert.deepEqual(metaisDaPraca("b3").map((m) => m.id), ["ouro"]);
  assert.deepEqual(pracasDoMetal("ouro").map((p) => p.id), ["comex", "shfe", "b3", "bcb", "spot", "bm"]);
});

// ------------------------------------------------------------------ datas

test("datas: validação, soma de dias e de meses, formatos", () => {
  assert.equal(dataValida("2026-02-28"), true);
  assert.equal(dataValida("2026-02-30"), false);
  assert.equal(dataValida("20261120"), false);
  assert.equal(somarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(diasEntre("2026-11-20", "2026-12-31"), 41);
  assert.equal(compacta("2026-11-20"), "20261120");
  assert.equal(deCompacta("20261120"), "2026-11-20");
  assert.equal(deCompacta("20261340"), null);
  assert.equal(fmtData("2026-11-20"), "20/11/2026");
  assert.equal(rotuloMes("2026-12"), "dez/2026");
  assert.equal(rotuloMes("2026-12", true), "dez/26");
  assert.equal(somarMeses("2026-11", 3), "2027-02");
  assert.equal(somarMeses("2026-01", -1), "2025-12");
  assert.equal(mesesEntre("2026-11", "2027-02"), 3);
  assert.equal(ultimoDiaDoMes("2028-02"), "2028-02-29");
  assert.equal(somarMesesAoDia("2026-11-30", 3), "2027-02-28"); // 30/02 não existe
  assert.equal(somarMesesAoDia("2026-11-20", 3), "2027-02-20");
});

test("datas: dia e hora por fuso, dias de semana e códigos de vencimento", () => {
  const instante = new Date("2026-11-23T03:30:00Z"); // 22/11 22h30 em Nova York, 23/11 11h30 em Xangai
  assert.equal(hojeEm("America/New_York", instante), "2026-11-22");
  assert.equal(hojeEm("Asia/Shanghai", instante), "2026-11-23");
  assert.equal(horaEm("America/New_York", instante), 22);
  assert.equal(horaEm("America/Sao_Paulo", new Date("2026-11-23T03:00:00Z")), 0); // meia-noite é 0, não 24
  assert.deepEqual(diasDeSemanaAte("2026-11-23", 3), ["2026-11-23", "2026-11-20", "2026-11-19"]); // pula o fim de semana
  assert.deepEqual(diasDeSemanaAte("2026-11-22", 1), ["2026-11-20"]); // domingo recua para sexta
  assert.equal(somarDiasDeSemana("2026-11-20", 2), "2026-11-24"); // sexta + 2 dias úteis = terça
  assert.equal(ajustarParaDiaDeSemana("2027-02-20"), "2027-02-22"); // sábado → segunda
  assert.equal(ajustarParaDiaDeSemana("2027-02-28", "anterior"), "2027-02-26"); // domingo → sexta
  assert.equal(ajustarParaDiaDeSemana("2027-02-28", "modificado"), "2027-02-26"); // a segunda já seria março
  assert.equal(ajustarParaDiaDeSemana("2027-02-20", "modificado"), "2027-02-22");
  assert.equal(ajustarParaDiaDeSemana("2026-11-24", "modificado"), "2026-11-24"); // dia de semana fica
  assert.equal(vencimentoDoCodigo("Z26"), "2026-12");
  assert.equal(vencimentoDoCodigo("F27"), "2027-01");
  assert.equal(vencimentoDoCodigo("A26"), null);
  assert.equal(codigoDoVencimento("2027-02"), "G27");
});

// ------------------------------------------------------------------ unidades e moedas

const CAMBIO = { data: "2026-11-19", brl: { USD: 5.8889, CNY: 0.8834 } };

test("unidades: fatores entre libra, onça troy, tonelada e tonelada curta", () => {
  perto(fatorUnidade("lb", "t"), 2204.622621848776, 1e-9);
  perto(fatorUnidade("oz", "kg"), 32.15074656862798, 1e-9);
  perto(fatorUnidade("g", "oz"), 31.1034768, 1e-9); // preço por grama × 31,1035 = preço por onça troy
  perto(fatorUnidade("st", "t"), 1.1023113109243878, 1e-12);
  assert.equal(fatorUnidade("t", "arroba"), null);
});

test("conversão: cobre da COMEX em US$/lb vira US$/t e R$/t pela PTAX", () => {
  const origem = { moeda: "USD", unidade: "lb" };
  perto(converterPreco(5.485, origem, { unidade: "t" }, CAMBIO), 12092.355, 0.001);
  perto(converterPreco(5.485, origem, { moeda: "BRL", unidade: "t" }, CAMBIO), 12092.355 * 5.8889, 0.01);
  assert.equal(converterPreco(5.485, origem, { moeda: "original", unidade: "original" }, null), 5.485);
  assert.deepEqual(cotacaoDestino(origem, { moeda: "BRL" }), { moeda: "BRL", unidade: "lb" });
});

test("conversão: SHFE em CN¥/t com IVA para US$/t sem IVA, e ouro de CN¥/g para US$/oz", () => {
  const cobre = { moeda: "CNY", unidade: "t", iva: true };
  const usd = taxaEntre("CNY", "USD", CAMBIO);
  perto(usd, 0.8834 / 5.8889, 1e-12);
  perto(converterPreco(93360, cobre, { moeda: "USD" }, CAMBIO), 93360 * usd, 1e-6);
  perto(converterPreco(93360, cobre, { moeda: "USD", semIva: true }, CAMBIO), 93360 / 1.13 * usd, 1e-6);
  // ouro não embute IVA: "sem IVA" não muda o preço
  const ouro = { moeda: "CNY", unidade: "g", iva: false };
  perto(converterPreco(778.64, ouro, { moeda: "USD", unidade: "oz", semIva: true }, CAMBIO), 778.64 * 31.1034768 * usd, 1e-6);
  perto(converterPreco(778.64, ouro, { moeda: "USD", unidade: "oz" }, CAMBIO), 778.64 * 31.1034768 * usd, 1e-6);
});

test("conversão: sem taxa de câmbio devolve null, nunca um número inventado", () => {
  assert.equal(converterPreco(100, { moeda: "USD", unidade: "t" }, { moeda: "BRL" }, null), null);
  assert.equal(converterPreco(100, { moeda: "USD", unidade: "t" }, { moeda: "CNY" }, { brl: { USD: 5.9 } }), null);
  assert.equal(converterPreco(NaN, { moeda: "USD", unidade: "t" }, {}, CAMBIO), null);
  assert.equal(taxaEntre("BRL", "USD", CAMBIO), 1 / 5.8889);
  assert.equal(rotuloCotacao("USD", "t"), "US$/t");
  assert.equal(rotuloCotacao("BRL", "oz"), "R$/oz t");
  assert.equal(casasDoPreco(12230.5), 2);
  assert.equal(casasDoPreco(5.485), 4);
  assert.equal(casasDoPreco(41.07), 3);
  assert.equal(casasDoPreco(0.9726), 6);
  perto(variacaoPct(110, 100), 10, 1e-9);
  assert.equal(variacaoPct(110, 0), null);
});

// ------------------------------------------------------------------ curva

const CURVA_OURO = [
  { contrato: "G27", vencimento: "2027-02", preco: 3544.1, anterior: 3715.3 },
  { contrato: "Z26", vencimento: "2026-12", preco: 3515.4, anterior: 3685.5 },
  { contrato: "Z27", vencimento: "2027-12", preco: 3695.1, anterior: 3876.7 },
  { contrato: "sem preço", vencimento: "2027-06", preco: null }
];

test("curva: ordena por vencimento, descarta ponto sem preço e calcula spread e taxa anualizada", () => {
  const a = analisarCurva(CURVA_OURO);
  assert.deepEqual(a.pontos.map((p) => p.contrato), ["Z26", "G27", "Z27"]);
  assert.equal(a.pontos[0].dataVencimento, "2026-12-31");
  assert.equal(a.pontos[0].spread, 0);
  perto(a.pontos[1].spread, 28.7, 1e-9);
  assert.equal(a.pontos[2].dias, 365);
  perto(a.pontos[2].spreadPct, (3695.1 / 3515.4 - 1) * 100, 1e-9);
  perto(a.pontos[2].anualizado, a.pontos[2].spreadPct, 1e-9); // 365 dias: a taxa anual é o próprio spread
  perto(a.pontos[0].variacao, (3515.4 / 3685.5 - 1) * 100, 1e-9);
  assert.equal(a.estrutura, "contango");
  assert.equal(a.mista, false);
  perto(a.spread, 179.7, 1e-9);
});

test("curva: backwardation, plana, mista e curva de um ponto só", () => {
  const cobre = analisarCurva([
    { contrato: "2612", vencimento: "2026-12", preco: 96040 },
    { contrato: "2701", vencimento: "2027-01", preco: 93360 },
    { contrato: "2711", vencimento: "2027-11", preco: 91730 }
  ]);
  assert.equal(cobre.estrutura, "backwardation");
  assert.ok(cobre.spreadPct < 0 && cobre.anualizado < 0);

  assert.equal(analisarCurva([{ vencimento: "2026-12", preco: 100 }, { vencimento: "2027-12", preco: 100.02 }]).estrutura, "plana");
  const mista = analisarCurva([{ vencimento: "2026-12", preco: 100 }, { vencimento: "2027-03", preco: 95 }, { vencimento: "2027-12", preco: 104 }]);
  assert.equal(mista.estrutura, "contango");
  assert.equal(mista.mista, true);

  const um = analisarCurva([{ vencimento: "2026-12", preco: 100 }]);
  assert.equal(um.estrutura, null);
  assert.equal(um.spread, null);
  // preço zero não é cotação: fica fora da curva
  assert.deepEqual(analisarCurva([{ vencimento: "2026-12", preco: 0 }, { vencimento: "2027-12", preco: 101 }]).pontos.map((p) => p.preco), [101]);
  assert.deepEqual(analisarCurva([]).pontos, []);
  assert.equal(analisarCurva(null).estrutura, null);
});

test("curva: dia do vencimento pela regra da praça e interpolação linear sem extrapolar", () => {
  assert.equal(diaDoVencimento("2026-12", "fim"), "2026-12-31");
  assert.equal(diaDoVencimento("2027-02", "fim"), "2027-02-26"); // 28/02/2027 é domingo: último dia de semana
  assert.equal(diaDoVencimento("2027-02", 15), "2027-02-15");
  assert.equal(diaDoVencimento("2027-05", 15), "2027-05-17"); // 15/05/2027 é sábado: segunda seguinte
  assert.equal(diaDoVencimento("2027-13", 15), null);

  const pontos = [
    { contrato: "A", vencimento: "2026-12", dataVencimento: "2026-12-01", preco: 100 },
    { contrato: "B", vencimento: "2026-12", dataVencimento: "2026-12-31", preco: 130 }
  ];
  assert.deepEqual(ordenarCurva(pontos).map((p) => p.contrato), ["A", "B"]);
  const meio = interpolarPreco(pontos, "2026-12-16");
  perto(meio.preco, 115, 1e-9);
  assert.equal(meio.exato, false);
  assert.equal(meio.antes.contrato, "A");
  assert.equal(interpolarPreco(pontos, "2026-12-31").exato, true);
  assert.equal(interpolarPreco(pontos, "2027-01-01"), null); // depois do último vencimento
  assert.equal(interpolarPreco(pontos, "2026-11-30"), null); // antes do primeiro
  assert.equal(interpolarPreco(pontos, "amanhã"), null);
});

// ------------------------------------------------------------------ painel

const FONTES = {
  lme: { cotacoes: [{ metal: "cobre", data: "2026-11-20", cash: 12230.5, tresMeses: 12237, anteriorCash: 12570, anteriorTresMeses: 12555 }] },
  comex: {
    cotacoes: [
      { metal: "cobre", contrato: "Z26", vencimento: "2026-12", data: "2026-11-20", preco: 5.485, anterior: 5.634, intradia: { data: "2026-11-23", preco: 5.522 } },
      { metal: "minerio", contrato: null, vencimento: null, data: "2026-11-20", preco: 90.67, anterior: 90.86, intradia: null }
    ]
  },
  shfe: {
    pracas: {
      shfe: { cobre: [
        { contrato: "2612", vencimento: "2026-12", data: "2026-11-20", preco: 96040, anterior: 98020, volume: 129486, emAberto: 139861 },
        { contrato: "2701", vencimento: "2027-01", data: "2026-11-20", preco: 93360, anterior: 95600, volume: 301997, emAberto: 216672 }
      ] },
      ine: { cobre: [{ contrato: "2701", vencimento: "2027-01", data: "2026-11-20", preco: 83210, anterior: 84000, volume: 10, emAberto: 20 }] }
    }
  },
  b3: { metal: "ouro", contratos: [
    { contrato: "X26", vencimento: "2026-11", data: "2026-11-19", preco: 3694, anterior: 3755, emAberto: 2, negocios: null },
    { contrato: "Z26", vencimento: "2026-12", data: "2026-11-19", preco: 3694.25, anterior: 3755.5, emAberto: 132387, negocios: 1429 }
  ] },
  cambio: { data: "2026-11-19", brl: { USD: 5.8889, CNY: 0.8834 }, ouro: { compra: 695.359, venda: 695.4299 } },
  spot: { cotacoes: [{ metal: "ouro", preco: 3613.15, moeda: "USD", unidade: "oz", atualizado_em: "2026-11-23T09:09:41.000Z" }] }
};

test("painel: cotações do cobre saem na ordem das praças, com a referência de cada uma", () => {
  const linhas = cotacoesDoMetal(metalDe("cobre"), FONTES);
  assert.deepEqual(linhas.map((l) => l.chave), ["lme:cash", "lme:3m", "comex", "shfe", "ine"]);
  assert.deepEqual(linhas.map((l) => l.referencia), ["Cash settlement", "3 meses", "Z26 · dez/2026", "2701 · jan/2027", "2701 · jan/2027"]);
  const comex = linhas[2];
  assert.equal(comex.unidade, "lb");
  assert.equal(comex.intradia.preco, 5.522);
  // SHFE: o contrato principal é o de maior posição em aberto, não o primeiro vencimento
  assert.equal(linhas[3].preco, 93360);
  assert.equal(linhas[3].iva, true);
  assert.equal(linhas[4].iva, false);
});

test("painel: ouro junta B3, Banco Central e spot; fonte ausente só some da lista", () => {
  const ouro = cotacoesDoMetal(metalDe("ouro"), FONTES);
  assert.deepEqual(ouro.map((l) => l.chave), ["b3", "bcb", "spot"]);
  assert.equal(ouro[0].referencia, "GLDZ26 · dez/2026");
  assert.equal(ouro[1].preco, 695.4299);
  assert.equal(ouro[1].unidade, "g");
  assert.equal(ouro[2].data, "2026-11-23");
  // Spot das 21h30 de São Paulo: em UTC já é o dia seguinte, mas a data mostrada é a de São Paulo
  const noite = cotacoesDoMetal(metalDe("ouro"), { spot: { cotacoes: [{ metal: "ouro", preco: 3620, atualizado_em: "2026-11-24T00:30:00.000Z" }] } });
  assert.equal(noite[0].data, "2026-11-23");
  assert.deepEqual(cotacoesDoMetal(metalDe("ouro"), {}), []);
  assert.equal(cotacoesDoMetal(metalDe("minerio"), FONTES)[0].referencia, "1º vencimento");
  const todas = linhasDoPainel(FONTES);
  assert.equal(todas.length, 5 + 3 + 1);
  assert.equal(todas[0].metal, "cobre");
  assert.equal(rotuloContrato("Z26", null), "Z26");
});

test("painel: curva por praça ganha a data de vencimento da regra de cada bolsa", () => {
  const cobre = metalDe("cobre");
  const lme = curvaDoMetal(cobre, "lme", FONTES);
  // 20/02/2027 é sábado: a data prompt de 3 meses vai para a segunda, 22/02
  assert.deepEqual(lme.map((p) => [p.contrato, p.dataVencimento, p.preco]), [["Cash", "2026-11-24", 12230.5], ["3 meses", "2027-02-22", 12237]]);
  const fimDeMes = curvaDoMetal(cobre, "lme", { lme: { cotacoes: [{ metal: "cobre", data: "2026-11-30", cash: 100, tresMeses: 101 }] } });
  assert.equal(fimDeMes[1].dataVencimento, "2027-02-26"); // 28/02 é domingo e a segunda já é março: recua para sexta
  const shfe = curvaDoMetal(cobre, "shfe", FONTES);
  assert.deepEqual(shfe.map((p) => p.dataVencimento), ["2026-12-15", "2027-01-15"]);
  assert.deepEqual(curvaDoMetal(cobre, "comex", FONTES), []); // curva da COMEX ainda não pedida
  const comex = curvaDoMetal(cobre, "comex", { curvasComex: { cobre: { contratos: [{ contrato: "Z26", vencimento: "2026-12", data: "2026-11-20", preco: 5.485, anterior: 5.634 }] } } });
  assert.equal(comex[0].dataVencimento, "2026-12-31");
  const b3 = curvaDoMetal(metalDe("ouro"), "b3", FONTES);
  assert.deepEqual(b3.map((p) => p.contrato), ["GLDX26", "GLDZ26"]);
  assert.equal(b3[1].volume, 1429);
  assert.deepEqual(curvaDoMetal(cobre, "spot", FONTES), []);
  assert.deepEqual(pracasComCurva(cobre), ["lme", "comex", "shfe", "ine"]);
  assert.deepEqual(pracasComCurva(metalDe("minerio")), []); // só o contínuo: sem curva
  assert.deepEqual(pracasComCurva(metalDe("ouro")), ["comex", "shfe", "b3"]);
});

test("painel: médias mensais de uma série diária", () => {
  const m = mediasMensais([
    { data: "2026-10-30", valor: 10 }, { data: "2026-11-02", valor: 20 }, { data: "2026-11-03", valor: 30 },
    { data: "2026-11-04", valor: null }
  ]);
  assert.deepEqual(m, [
    { mes: "2026-10", media: 10, dias: 1, minimo: 10, maximo: 10 },
    { mes: "2026-11", media: 25, dias: 2, minimo: 20, maximo: 30 }
  ]);
  assert.deepEqual(mediasMensais([]), []);
});

// ------------------------------------------------------------------ formatos e exportações

import { fmtNum, fmtInteiro, fmtPreco, fmtCotacao, fmtPct, fmtDiferenca, seta, classeDir } from "../lib/formatos.js";
import { COLUNAS_SAP, LARGURAS_SAP, unidadeSapSugerida, validarCamposSap, linhasSap, chavesRepetidasSap, textoCsv, nomeDeArquivo } from "../lib/exportacao.js";

test("formatos: padrão brasileiro, ausente como travessão e sinal explícito nas variações", () => {
  assert.equal(fmtNum(12230.5), "12.230,50");
  assert.equal(fmtNum(null), "—");
  assert.equal(fmtInteiro(332025), "332.025");
  assert.equal(fmtPreco(12230.5), "12.230,50");
  assert.equal(fmtPreco(5.485), "5,4850"); // cobre em US$/lb: 4 casas, como na bolsa
  assert.equal(fmtPreco(5.485, 2), "5,49");
  assert.equal(fmtPreco(undefined), "—");
  assert.equal(fmtCotacao(12230.5, "USD", "t"), "12.230,50 US$/t");
  assert.equal(fmtPct(1.254), "+1,25%");
  assert.equal(fmtPct(-0.4), "−0,40%");
  assert.equal(fmtPct(-0.001), "0,00%"); // arredonda para zero sem sinal
  assert.equal(fmtPct(NaN), "—");
  assert.equal(fmtDiferenca(28.7), "+28,700");
  assert.equal(fmtDiferenca(0.0425, 4), "+0,0425");
  assert.equal(fmtDiferenca(-2680, 2), "−2.680,00");
  assert.equal(fmtDiferenca(-0.004, 2), "0,00"); // arredonda para zero: sem sinal
  assert.equal(fmtDiferenca(0.004, 2), "0,00");
  assert.equal(seta(1), "▲");
  assert.equal(seta(-1), "▼");
  assert.equal(seta(null), "");
  assert.equal(classeDir(0.1), "dxt-badge--up");
  assert.equal(classeDir(-0.1), "dxt-badge--down");
  assert.equal(classeDir(0), "");
});

test("planilha SAP: colunas do preço por DCS, datas como texto AAAAMMDD e preço numérico", () => {
  assert.deepEqual(COLUNAS_SAP, ["DCS ID", "MIC", "Tipo de preço", "Data do preço", "Data-chave de vencimento", "Preço", "Moeda", "Unidade de medida"]);
  assert.equal(LARGURAS_SAP.length, COLUNAS_SAP.length);
  assert.equal(unidadeSapSugerida("t"), "TO");
  assert.equal(unidadeSapSugerida("oz"), "OZ");

  const v = validarCamposSap({ dcs: " cu_cmx ", mic: "xcec", tipo: "settle", moeda: "usd", unidade: "lb" });
  assert.equal(v.ok, true);
  assert.deepEqual(v.valores, { dcs: "CU_CMX", mic: "XCEC", tipo: "SETTLE", moeda: "USD", unidade: "LB" });
  const linhas = linhasSap([
    { dataPreco: "2026-11-20", dataVencimento: "2026-12-31", preco: 5.485 },
    { dataPreco: "2026-11-20", dataVencimento: null, preco: 5.477 }, // série histórica: sem vencimento
    { dataPreco: "2026-11-20", dataVencimento: "2027-01-31", preco: null }, // sem preço: fica de fora
    { dataPreco: "ontem", dataVencimento: "2027-01-31", preco: 5.5 }
  ], v.valores);
  assert.deepEqual(linhas, [
    ["CU_CMX", "XCEC", "SETTLE", "20261120", "20261231", 5.485, "USD", "LB"],
    ["CU_CMX", "XCEC", "SETTLE", "20261120", "", 5.477, "USD", "LB"]
  ]);
  assert.deepEqual(chavesRepetidasSap(linhas), []);
  assert.equal(chavesRepetidasSap([linhas[0], linhas[0]]).length, 1);
});

test("planilha SAP: campos obrigatórios e formato do MIC", () => {
  const base = { dcs: "CU01", mic: "XLME", tipo: "01", moeda: "USD", unidade: "TO" };
  assert.match(validarCamposSap({ ...base, dcs: "" }).erro, /DCS ID/);
  assert.match(validarCamposSap({ ...base, mic: "LME" }).erro, /MIC tem 4/);
  assert.match(validarCamposSap({ ...base, tipo: "" }).erro, /tipo de preço/);
  assert.match(validarCamposSap({ ...base, unidade: "TONELADA" }).erro, /unidade de medida/);
  assert.match(validarCamposSap({ ...base, moeda: "" }).erro, /moeda/);
  assert.equal(validarCamposSap(base).ok, true);
});

test("CSV para o Excel brasileiro: BOM, ponto e vírgula, vírgula decimal e aspas escapadas", () => {
  const csv = textoCsv(["Metal", "Preço", "Nota"], [["Cobre", 12230.5, 'diz "oi"; fim'], ["Ouro", null, undefined], ["Prata", NaN, "linha\nnova"]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1), 'Metal;Preço;Nota\r\nCobre;12230,5;"diz ""oi""; fim"\r\nOuro;;\r\nPrata;;"linha\nnova"\r\n');
  assert.equal(nomeDeArquivo("Aço · bobina a quente"), "aco-bobina-a-quente");
  assert.equal(nomeDeArquivo("lme:cash"), "lme-cash");
});
