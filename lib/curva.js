/*
 * Curva de preços (estrutura a termo) de um metal numa praça. Funções puras.
 *
 * Um ponto da curva:
 *   { contrato: "Z26", vencimento: "2026-12", dataVencimento: "2026-12-29", data: "2026-11-20",
 *     preco: 3515.4, anterior: 3685.5, volume: 1234, emAberto: 5678 }
 * `vencimento` é o mês de entrega; `dataVencimento`, o dia usado nas contas de prazo (o da bolsa quando
 * ela informa — cash e 3 meses da LME —, senão o dia convencional da praça: ver `diaDoVencimento`).
 */
import { diasEntre, ultimoDiaDoMes, mesValido, dataValida, ajustarParaDiaDeSemana } from "./datas.js";
import { variacaoPct } from "./unidades.js";

/** Abaixo disto (em % entre o primeiro e o último vencimento) a curva é tratada como plana. */
export const LIMITE_PLANA = 0.05;

/**
 * Dia convencional do vencimento de um mês de entrega, quando a fonte não traz a data exata:
 *   "fim" — último dia de semana do mês (CME: a negociação termina no fim do mês de entrega);
 *   número — dia fixo ou, se cair em fim de semana, a segunda-feira seguinte (SHFE: dia 15).
 * É aproximação para prazo e interpolação — sem feriados —, não o calendário oficial da bolsa.
 */
export function diaDoVencimento(vencimento, regra = "fim") {
  if (!mesValido(vencimento)) return null;
  const dia = Number(regra);
  if (regra === "fim" || !Number.isInteger(dia) || dia < 1 || dia > 28) return ajustarParaDiaDeSemana(ultimoDiaDoMes(vencimento), "anterior");
  return ajustarParaDiaDeSemana(`${vencimento}-${String(dia).padStart(2, "0")}`, "seguinte");
}

/** Só os pontos com preço (maior que zero), em ordem de vencimento. Não altera a lista recebida. */
export function ordenarCurva(contratos) {
  return (contratos || [])
    .filter((c) => c && Number.isFinite(c.preco) && c.preco > 0 && (dataValida(c.dataVencimento) || mesValido(c.vencimento)))
    .map((c) => ({ ...c, dataVencimento: dataValida(c.dataVencimento) ? c.dataVencimento : diaDoVencimento(c.vencimento) }))
    .sort((a, b) => (a.dataVencimento < b.dataVencimento ? -1 : a.dataVencimento > b.dataVencimento ? 1 : 0));
}

/**
 * Analisa a curva: para cada ponto, o spread contra o primeiro vencimento (em preço e em %), a taxa
 * anualizada linear desse spread e a variação do dia; para a curva, a estrutura.
 *   contango       — vencimentos longos mais caros que o primeiro (custo de carrego positivo);
 *   backwardation  — longos mais baratos (prêmio pela entrega imediata, aperto de oferta);
 *   plana          — diferença menor que LIMITE_PLANA %.
 * A estrutura compara o primeiro e o último vencimento; `mista` avisa quando o sinal troca no caminho.
 */
export function analisarCurva(contratos) {
  const pontos = ordenarCurva(contratos);
  if (!pontos.length) return { pontos: [], estrutura: null, mista: false, primeiro: null, ultimo: null, spread: null, spreadPct: null, anualizado: null };

  const base = pontos[0];
  const linhas = pontos.map((p, i) => {
    const dias = diasEntre(base.dataVencimento, p.dataVencimento);
    const spread = i === 0 ? 0 : p.preco - base.preco;
    const spreadPct = i === 0 ? 0 : variacaoPct(p.preco, base.preco);
    return {
      ...p,
      dias,
      spread,
      spreadPct,
      anualizado: i === 0 || !dias || spreadPct === null ? null : spreadPct * 365 / dias,
      variacao: variacaoPct(p.preco, p.anterior)
    };
  });

  const ultimo = linhas[linhas.length - 1];
  let estrutura = null;
  if (linhas.length >= 2 && ultimo.spreadPct !== null) {
    estrutura = Math.abs(ultimo.spreadPct) < LIMITE_PLANA ? "plana" : ultimo.spreadPct > 0 ? "contango" : "backwardation";
  }
  // Curva que sobe e desce: algum trecho anda contra o sentido geral por mais que o limite de "plana"
  const sinais = new Set();
  for (let i = 1; i < linhas.length; i++) {
    const passo = variacaoPct(linhas[i].preco, linhas[i - 1].preco);
    if (passo !== null && Math.abs(passo) >= LIMITE_PLANA) sinais.add(Math.sign(passo));
  }

  return {
    pontos: linhas,
    estrutura,
    mista: sinais.size > 1,
    primeiro: linhas[0],
    ultimo,
    spread: linhas.length >= 2 ? ultimo.spread : null,
    spreadPct: linhas.length >= 2 ? ultimo.spreadPct : null,
    anualizado: linhas.length >= 2 ? ultimo.anualizado : null
  };
}

/**
 * Preço a termo para um dia, por interpolação linear no tempo entre os dois vencimentos vizinhos.
 * Fora do intervalo da curva devolve null (não extrapola). Resultado:
 *   { preco, antes, depois, exato }  — `exato` quando o dia coincide com um vencimento.
 */
export function interpolarPreco(contratos, dia) {
  if (!dataValida(dia)) return null;
  const pontos = ordenarCurva(contratos);
  if (!pontos.length) return null;
  const igual = pontos.find((p) => p.dataVencimento === dia);
  if (igual) return { preco: igual.preco, antes: igual, depois: igual, exato: true };
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1], b = pontos[i];
    if (a.dataVencimento < dia && dia < b.dataVencimento) {
      const total = diasEntre(a.dataVencimento, b.dataVencimento);
      const parte = diasEntre(a.dataVencimento, dia);
      return { preco: a.preco + (b.preco - a.preco) * (parte / total), antes: a, depois: b, exato: false };
    }
  }
  return null;
}

/** Texto da estrutura para a tela. */
export function nomeEstrutura(estrutura) {
  return estrutura === "contango" ? "Contango" : estrutura === "backwardation" ? "Backwardation" : estrutura === "plana" ? "Plana" : "—";
}
