/*
 * COMEX e NYMEX (CME Group) pelo Yahoo Finance: fechamento diário de cada contrato, que no dia encerrado
 * coincide com o ajuste (settlement) da bolsa. Funções puras (sem rede), usadas por api/comex.js.
 *
 *   vários símbolos  https://query1.finance.yahoo.com/v8/finance/spark?symbols=GCZ26.CMX,…&range=1mo&interval=1d
 *   um símbolo       https://query1.finance.yahoo.com/v8/finance/chart/GC=F?period1=…&period2=…&interval=1d
 *
 * Símbolos: contrato = raiz + código do mês + ano de 2 dígitos + ".CMX" (COMEX) ou ".NYM" (NYMEX), ex.:
 * GCZ26.CMX; contínuo (1º vencimento) = raiz + "=F". O spark aceita até 20 símbolos e simplesmente omite
 * os que não existem.
 *
 * Barra do dia em curso: durante o pregão a última barra é o último negócio (com ~10 min de atraso), não
 * o ajuste. Por isso a cotação de referência é sempre a última barra ENCERRADA; a do dia em curso sai à
 * parte, em `intradia`.
 */
import { codigoDoVencimento, vencimentoDoCodigo, somarMeses, mesDe, hojeEm, horaEm, mesValido } from "./datas.js";

export const HOST_YAHOO = "https://query1.finance.yahoo.com";
export const FUSO_NY = "America/New_York";
export const LIMITE_SPARK = 20;

/** Hora de Nova York a partir da qual a barra do dia é tratada como encerrada (pregão fecha às 17h). */
const HORA_ENCERRAMENTO = 18;

export function simboloContinuo(raiz) {
  return `${raiz}=F`;
}

/** ("GC", "2026-12", "CMX") → "GCZ26.CMX". */
export function simboloContrato(raiz, vencimento, sufixo) {
  const codigo = codigoDoVencimento(vencimento);
  return codigo ? `${raiz}${codigo}.${sufixo}` : null;
}

/** "GCZ26.CMX" → { raiz: "GC", codigo: "Z26", vencimento: "2026-12" }; null para contínuo ou outro formato. */
export function contratoDoSimbolo(simbolo) {
  const m = /^([A-Z0-9]+?)([FGHJKMNQUVXZ]\d{2})\.(CMX|NYM)$/.exec(String(simbolo ?? ""));
  if (!m) return null;
  return { raiz: m[1], codigo: m[2], vencimento: vencimentoDoCodigo(m[2]) };
}

/** Meses de `inicio` ("AAAA-MM") em diante, `quantos` meses. */
export function mesesAFrente(inicio, quantos) {
  return Array.from({ length: quantos }, (_, i) => somarMeses(inicio, i));
}

/**
 * Vencimento de referência do painel: o primeiro mês do ciclo de maior liquidez DEPOIS do mês corrente
 * (em novembro, o ouro de referência é dezembro; em dezembro, já é fevereiro, porque o contrato do mês
 * está em entrega). Sem ciclo (alumínio, aço), o mês seguinte.
 */
export function vencimentoDeReferencia(ciclo, mesAtual) {
  if (!mesValido(mesAtual)) return null;
  for (let i = 1; i <= 24; i++) {
    const mes = somarMeses(mesAtual, i);
    if (!ciclo || ciclo.includes(Number(mes.slice(5)))) return mes;
  }
  return null;
}

export function urlSpark(simbolos, range = "1mo") {
  return `${HOST_YAHOO}/v8/finance/spark?symbols=${simbolos.map(encodeURIComponent).join(",")}&range=${range}&interval=1d`;
}

/** Histórico diário de um símbolo entre dois instantes (epoch em segundos). */
export function urlChart(simbolo, inicio, fim) {
  return `${HOST_YAHOO}/v8/finance/chart/${encodeURIComponent(simbolo)}?period1=${inicio}&period2=${fim}&interval=1d`;
}

/** Parte uma lista em lotes de até `tamanho`. */
export function emLotes(lista, tamanho = LIMITE_SPARK) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/** Barras diárias com fechamento: [{ data, preco }], data no calendário de Nova York. */
function barras(timestamps, fechamentos) {
  const lista = [];
  const n = Math.min((timestamps || []).length, (fechamentos || []).length);
  for (let i = 0; i < n; i++) {
    const preco = fechamentos[i];
    if (!Number.isFinite(preco) || !Number.isFinite(timestamps[i])) continue;
    // Os preços vêm em ponto flutuante de 32 bits (3515.39990234375, 6.543499946594238): 7 algarismos
    // significativos é o que esse formato guarda, e devolve o valor da bolsa (3515.4, 6.5435)
    lista.push({ data: hojeEm(FUSO_NY, new Date(timestamps[i] * 1000)), preco: Number(preco.toPrecision(7)) });
  }
  return lista;
}

/** A barra de `data` já é o ajuste? Sim se for de um dia anterior ao de Nova York, ou se o dia já fechou. */
export function barraEncerrada(data, agora = new Date()) {
  const hoje = hojeEm(FUSO_NY, agora);
  return data < hoje || (data === hoje && horaEm(FUSO_NY, agora) >= HORA_ENCERRAMENTO);
}

function resumir(lista, agora) {
  const encerradas = lista.filter((b) => barraEncerrada(b.data, agora));
  const aberta = lista.find((b) => !barraEncerrada(b.data, agora)) || null;
  if (!encerradas.length) return null;
  const u = encerradas[encerradas.length - 1];
  const a = encerradas.length > 1 ? encerradas[encerradas.length - 2] : null;
  return { data: u.data, preco: u.preco, dataAnterior: a ? a.data : null, anterior: a ? a.preco : null, intradia: aberta };
}

/**
 * Lê a resposta do spark (v8): { "<SÍMBOLO>": { timestamp[], close[] } }.
 * Devolve { "<SÍMBOLO>": { data, preco, dataAnterior, anterior, intradia } } só para os símbolos com
 * ao menos uma barra encerrada. Contrato sem negócio no dia traz `close` nulo: vale o último fechamento
 * não nulo, com a data dele. `anterior` só vem quando é o pregão imediatamente anterior a `data` entre
 * os dias vistos na resposta; senão fica null (sem variação do dia).
 */
export function lerSpark(json, agora = new Date()) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("resposta do Yahoo fora do formato esperado");
  const saida = {};
  const pregoes = new Set(); // dias com barra encerrada em algum símbolo: o calendário de fato
  for (const [simbolo, v] of Object.entries(json)) {
    if (!v || !Array.isArray(v.timestamp) || !Array.isArray(v.close)) continue;
    const lista = barras(v.timestamp, v.close);
    for (const b of lista) if (barraEncerrada(b.data, agora)) pregoes.add(b.data);
    const r = resumir(lista, agora);
    if (r) saida[simbolo] = r;
  }
  // Contrato que ficou sem negócio num dia não tem a barra dele: o "anterior" seria de dois pregões
  // atrás e a variação "do dia" sairia errada. Só vale o anterior que é mesmo o pregão anterior.
  const calendario = [...pregoes].sort();
  for (const r of Object.values(saida)) {
    const i = calendario.indexOf(r.data);
    if (r.dataAnterior !== (i > 0 ? calendario[i - 1] : null)) { r.dataAnterior = null; r.anterior = null; }
  }
  return saida;
}

/**
 * Lê a resposta do chart (v8): histórico diário em ordem cronológica, [{ data, preco }], só barras
 * encerradas. Lança erro se o formato for outro ou se o Yahoo devolver erro no corpo.
 */
export function lerChart(json, agora = new Date()) {
  const r = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
  if (!r) {
    const descricao = json && json.chart && json.chart.error && json.chart.error.description;
    throw new Error(descricao ? `o Yahoo recusou a consulta (${descricao})` : "resposta do Yahoo fora do formato esperado");
  }
  const fechamentos = r.indicators && r.indicators.quote && r.indicators.quote[0] ? r.indicators.quote[0].close : [];
  const porData = new Map();
  for (const b of barras(r.timestamp, fechamentos)) if (barraEncerrada(b.data, agora)) porData.set(b.data, b);
  return [...porData.keys()].sort().map((d) => porData.get(d));
}

/** Mês corrente em Nova York ("AAAA-MM"). */
export function mesAtualNY(agora = new Date()) {
  return mesDe(hojeEm(FUSO_NY, agora));
}
