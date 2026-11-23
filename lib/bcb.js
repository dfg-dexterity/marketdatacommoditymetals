/*
 * Banco Central do Brasil: câmbio para converter as cotações e o ouro em reais. Funções puras (sem
 * rede), usadas por api/cambio.js.
 *
 * 1. Boletim de fechamento da PTAX, um arquivo por dia útil (404 em feriado e fim de semana):
 *      https://www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv
 *    CSV sem cabeçalho, separador ";", decimal com vírgula:
 *      data;código;tipo;símbolo;taxa compra;taxa venda;paridade compra;paridade venda
 *      19/11/2026;220;A;USD;5,88830000;5,88890000;1,00000000;1,00000000
 *      19/11/2026;998;A;XAU;695,35900000;695,42990000;0,00846800;0,00846800
 *    As taxas são em reais por 1 unidade da moeda; a linha XAU é o ouro em reais por grama.
 *
 * 2. Série do dólar por período (API Olinda), para converter o histórico dia a dia:
 *      https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='MM-DD-AAAA'&@dataFinalCotacao='MM-DD-AAAA'&$format=json
 */
import { compacta, dataValida } from "./datas.js";

export const OLINDA = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

/** Moedas levadas para a página (além do ouro). */
export const MOEDAS_CAMBIO = ["USD", "CNY", "EUR", "GBP", "JPY"];

export function urlFechamento(dia) {
  return `https://www4.bcb.gov.br/Download/fechamento/${compacta(dia)}.csv`;
}

/** "5,88890000" → 5.8889; vazio ou texto → null. */
export function numeroBrasileiro(texto) {
  const s = String(texto ?? "").trim();
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "19/11/2026" → "2026-11-19". */
export function dataBrasileira(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? "").trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return dataValida(iso) ? iso : null;
}

/**
 * Lê o boletim de fechamento:
 *   { data, brl: { USD: 5.8889, CNY: 0.8834, … } (venda), compra: { USD: 5.8883, … },
 *     ouro: { compra, venda } (R$ por grama) ou null }
 * Lança erro se o arquivo não tiver a linha do dólar — sinal de formato diferente.
 */
export function lerFechamento(csv) {
  let data = null;
  const brl = {}, compra = {};
  let ouro = null;
  for (const linha of String(csv ?? "").split(/\r?\n/)) {
    const c = linha.split(";");
    if (c.length < 6) continue;
    const dia = dataBrasileira(c[0]);
    const simbolo = c[3].trim().toUpperCase();
    const tCompra = numeroBrasileiro(c[4]), tVenda = numeroBrasileiro(c[5]);
    if (!dia || tCompra === null || tVenda === null || tVenda <= 0) continue;
    data = data || dia;
    if (simbolo === "XAU") ouro = { compra: tCompra, venda: tVenda };
    else if (MOEDAS_CAMBIO.includes(simbolo)) { brl[simbolo] = tVenda; compra[simbolo] = tCompra; }
  }
  if (!data || !Number.isFinite(brl.USD)) throw new Error("boletim de fechamento do Banco Central fora do formato esperado (sem a linha do dólar)");
  return { data, brl, compra, ouro };
}

const mmddaaaa = (iso) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

export function urlDolarPeriodo(de, ate) {
  return `${OLINDA}/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial='${mmddaaaa(de)}'&@dataFinalCotacao='${mmddaaaa(ate)}'&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao`;
}

/**
 * Lê a série do dólar: [{ data, compra, venda }] em ordem cronológica, um ponto por dia (o último
 * boletim do dia, que é o de fechamento). Lança erro se a resposta não tiver a lista `value`.
 */
export function lerDolarPeriodo(json) {
  if (!json || !Array.isArray(json.value)) throw new Error("resposta do Banco Central fora do formato esperado (sem a lista value)");
  const porDia = new Map();
  for (const v of json.value) {
    const quando = String((v && v.dataHoraCotacao) ?? "");
    const data = quando.slice(0, 10);
    if (!dataValida(data) || !Number.isFinite(v.cotacaoVenda) || !Number.isFinite(v.cotacaoCompra)) continue;
    const atual = porDia.get(data);
    if (!atual || quando > atual.quando) porDia.set(data, { quando, data, compra: v.cotacaoCompra, venda: v.cotacaoVenda });
  }
  return [...porDia.keys()].sort().map((d) => {
    const { data, compra, venda } = porDia.get(d);
    return { data, compra, venda };
  });
}

/**
 * Taxa de venda vigente em cada dia pedido: a do próprio dia ou, se não houve boletim (feriado no
 * Brasil com pregão lá fora), a do último dia anterior com boletim. `serie` em ordem cronológica.
 * Devolve uma função dia → { data, venda } | null.
 */
export function taxaVigente(serie) {
  const dias = (serie || []).map((p) => p.data);
  return (dia) => {
    let lo = 0, hi = dias.length - 1, achado = -1;
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      if (dias[meio] <= dia) { achado = meio; lo = meio + 1; } else hi = meio - 1;
    }
    return achado >= 0 ? serie[achado] : null;
  };
}
