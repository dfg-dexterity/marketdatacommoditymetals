/*
 * Conversão de unidade de peso e de moeda das cotações de metais. Funções puras.
 *
 * Um preço é sempre "moeda por unidade" (US$/t, US$/lb, CN¥/g…). Para comparar praças:
 *   1. imposto — os futuros domésticos de Xangai embutem o IVA chinês de 13%; "sem IVA" divide por 1,13;
 *   2. unidade — preço por kg = preço ÷ kg da unidade de origem; depois × kg da unidade de destino;
 *   3. moeda   — pelo real como ponte, com a PTAX de venda do Banco Central (R$ por 1 unidade da moeda).
 */

/** Quilogramas em cada unidade de cotação. */
export const UNIDADES = {
  t: { id: "t", nome: "tonelada", simbolo: "t", kg: 1000 },
  kg: { id: "kg", nome: "quilograma", simbolo: "kg", kg: 1 },
  g: { id: "g", nome: "grama", simbolo: "g", kg: 0.001 },
  lb: { id: "lb", nome: "libra-peso", simbolo: "lb", kg: 0.45359237 },
  oz: { id: "oz", nome: "onça troy", simbolo: "oz t", kg: 0.0311034768 },
  st: { id: "st", nome: "tonelada curta", simbolo: "t curta", kg: 907.18474 }
};

export const MOEDAS = {
  USD: { id: "USD", nome: "dólar dos EUA", simbolo: "US$" },
  BRL: { id: "BRL", nome: "real", simbolo: "R$" },
  CNY: { id: "CNY", nome: "iuane chinês", simbolo: "CN¥" }
};

/** IVA embutido nos preços domésticos chineses (SHFE), menos no ouro e no cobre internacional (INE). */
export const IVA_CHINA = 0.13;

/** Fator que leva um preço "por `de`" a um preço "por `para`" (US$/lb × 2.204,62 = US$/t). */
export function fatorUnidade(de, para) {
  const a = UNIDADES[de], b = UNIDADES[para];
  if (!a || !b) return null;
  return b.kg / a.kg;
}

/**
 * Quantas unidades de `para` valem 1 unidade de `de`, com o real como ponte.
 * `cambio.brl` = { USD: 5.8889, CNY: 0.8834, … } (R$ por 1 unidade; BRL = 1 implícito).
 */
export function taxaEntre(de, para, cambio) {
  if (de === para) return 1;
  const brl = (cambio && cambio.brl) || {};
  const a = de === "BRL" ? 1 : brl[de];
  const b = para === "BRL" ? 1 : brl[para];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return a / b;
}

/**
 * Converte um preço.
 *   origem  = { moeda, unidade, iva }   iva = true quando o preço embute o IVA chinês
 *   destino = { moeda, unidade, semIva } moeda/unidade ausentes ou "original" = manter a da origem
 * Devolve null quando falta a taxa de câmbio ou a unidade é desconhecida — nunca um número inventado.
 */
export function converterPreco(preco, origem, destino = {}, cambio = null) {
  if (!Number.isFinite(preco) || !origem) return null;
  const moeda = destino.moeda && destino.moeda !== "original" ? destino.moeda : origem.moeda;
  const unidade = destino.unidade && destino.unidade !== "original" ? destino.unidade : origem.unidade;
  let v = preco;
  if (origem.iva && destino.semIva) v /= 1 + IVA_CHINA;
  if (unidade !== origem.unidade) {
    const f = fatorUnidade(origem.unidade, unidade);
    if (f === null) return null;
    v *= f;
  }
  if (moeda !== origem.moeda) {
    const t = taxaEntre(origem.moeda, moeda, cambio);
    if (t === null) return null;
    v *= t;
  }
  return v;
}

/** Moeda e unidade em que o preço sai depois de `converterPreco` com o mesmo destino. */
export function cotacaoDestino(origem, destino = {}) {
  return {
    moeda: destino.moeda && destino.moeda !== "original" ? destino.moeda : origem.moeda,
    unidade: destino.unidade && destino.unidade !== "original" ? destino.unidade : origem.unidade
  };
}

/** "US$/t", "R$/g", "CN¥/kg". */
export function rotuloCotacao(moeda, unidade) {
  const m = MOEDAS[moeda] ? MOEDAS[moeda].simbolo : moeda;
  const u = UNIDADES[unidade] ? UNIDADES[unidade].simbolo : unidade;
  return `${m}/${u}`;
}

/**
 * Casas decimais para exibir um preço, pela ordem de grandeza: 2 de 100 para cima (ouro, metais em
 * US$/t), 3 nas dezenas (prata em US$/oz, minério), 4 nas unidades (cobre em US$/lb) e 6 abaixo de 1.
 */
export function casasDoPreco(valor) {
  const a = Math.abs(valor);
  if (!Number.isFinite(a)) return 2;
  if (a >= 100) return 2;
  if (a >= 10) return 3;
  if (a >= 1) return 4;
  return 6;
}

/** Tira o ruído binário de uma conta (0.1 + 0.2) sem perder precisão útil. */
export function limparNumero(n, casas = 8) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/** Variação percentual de `anterior` para `atual`; null se não der para calcular. */
export function variacaoPct(atual, anterior) {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null;
  return (atual / anterior - 1) * 100;
}
