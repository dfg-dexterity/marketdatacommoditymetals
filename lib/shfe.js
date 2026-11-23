/*
 * SHFE (Shanghai Futures Exchange) e INE: boletim diário oficial, com todos os vencimentos de todos os
 * produtos num arquivo JSON por pregão. Funções puras (sem rede), usadas por api/shfe.js.
 *
 *   boletim   https://www.shfe.com.cn/data/tradedata/future/dailydata/kxAAAAMMDD.dat
 *   pregões   https://www.shfe.com.cn/data/config/currentTradingday.dat  → { currentTradingday, lastTradingday }
 *
 * `o_curinstrument[]` traz uma linha por contrato: PRODUCTID ("cu_f"), DELIVERYMONTH ("2701"),
 * SETTLEMENTPRICE (ajuste), PRESETTLEMENTPRICE (ajuste anterior), CLOSEPRICE, VOLUME, OPENINTEREST.
 * Há linhas de subtotal ("小计") e total ("总计"), e os arquivos antigos têm espaços à direita nos textos.
 * Durante o pregão o arquivo do dia já existe, mas sem ajuste: é tratado como incompleto.
 *
 * Preços em CN¥ por tonelada (ouro em CN¥/g, prata em CN¥/kg). Os contratos domésticos embutem o IVA
 * chinês de 13%; o cobre internacional (bc, da INE) e o ouro não.
 */
import { compacta, deCompacta } from "./datas.js";
import { METAIS } from "./catalogo.js";

export const HOST_SHFE = "https://www.shfe.com.cn";
export const URL_PREGOES_SHFE = `${HOST_SHFE}/data/config/currentTradingday.dat`;
export const FUSO_XANGAI = "Asia/Shanghai";

export function urlBoletimShfe(dia) {
  return `${HOST_SHFE}/data/tradedata/future/dailydata/kx${compacta(dia)}.dat`;
}

/** Produto da bolsa → { praca, metal }, tirado do catálogo (shfe e ine vêm no mesmo arquivo). */
export function produtosShfe() {
  const mapa = new Map();
  for (const m of METAIS) {
    for (const praca of ["shfe", "ine"]) {
      const i = m.instrumentos[praca];
      if (i && i.produto) mapa.set(i.produto, { praca, metal: m.id });
    }
  }
  return mapa;
}

/** "2701" → "2027-01"; null para subtotal e total. */
export function vencimentoShfe(mesEntrega) {
  const m = /^(\d{2})(\d{2})$/.exec(String(mesEntrega ?? "").trim());
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return `20${m[1]}-${m[2]}`;
}

function numero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Datas dos pregões informadas pela bolsa: { atual, anterior } em "AAAA-MM-DD" (null se ilegível). */
export function lerPregoesShfe(json) {
  return {
    atual: deCompacta(json && json.currentTradingday),
    anterior: deCompacta(json && json.lastTradingday)
  };
}

/**
 * Lê o boletim: { data, completo, pracas: { shfe: { cobre: [contratos] }, ine: { cobre: [contratos] } } }.
 * Cada contrato: { contrato: "2701", vencimento: "2027-01", data, preco (ajuste), anterior (ajuste
 * anterior), fechamento, volume, emAberto }, em ordem de vencimento. `completo` é false quando nenhum
 * contrato tem ajuste (arquivo do dia, ainda em pregão). Lança erro se o formato for outro.
 */
export function lerBoletimShfe(json) {
  if (!json || !Array.isArray(json.o_curinstrument)) throw new Error("boletim da SHFE fora do formato esperado (sem o_curinstrument)");
  const data = deCompacta(json.report_date);
  if (!data) throw new Error("boletim da SHFE sem a data do pregão (report_date)");

  const produtos = produtosShfe();
  const pracas = { shfe: {}, ine: {} };
  let comAjuste = 0;

  for (const linha of json.o_curinstrument) {
    if (!linha || typeof linha !== "object") continue;
    const destino = produtos.get(String(linha.PRODUCTID ?? "").trim());
    const vencimento = vencimentoShfe(linha.DELIVERYMONTH);
    if (!destino || !vencimento) continue;
    const preco = numero(linha.SETTLEMENTPRICE);
    if (preco !== null && preco > 0) comAjuste++;
    const lista = (pracas[destino.praca][destino.metal] ||= []);
    lista.push({
      contrato: String(linha.DELIVERYMONTH).trim(),
      vencimento,
      data,
      preco: preco !== null && preco > 0 ? preco : null,
      anterior: numero(linha.PRESETTLEMENTPRICE),
      fechamento: numero(linha.CLOSEPRICE),
      volume: numero(linha.VOLUME),
      emAberto: numero(linha.OPENINTEREST)
    });
  }

  for (const praca of Object.values(pracas)) {
    for (const lista of Object.values(praca)) lista.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
  }
  return { data, completo: comAjuste > 0, pracas };
}

/**
 * Contrato principal de uma curva: o de maior posição em aberto entre os que têm ajuste (convenção do
 * mercado chinês para "contrato de referência"). Empate ou falta de posição: o primeiro vencimento.
 */
export function contratoPrincipal(contratos) {
  const validos = (contratos || []).filter((c) => Number.isFinite(c.preco));
  if (!validos.length) return null;
  return validos.reduce((melhor, c) => ((c.emAberto ?? -1) > (melhor.emAberto ?? -1) ? c : melhor), validos[0]);
}
