/*
 * Formatação de números para a tela, no padrão brasileiro. Funções puras, usadas pela página e pelos
 * testes. Ausente é sempre "—", nunca zero.
 */
import { casasDoPreco, rotuloCotacao } from "./unidades.js";

export function fmtNum(n, casas = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Número inteiro com separador de milhar (volume, posição em aberto, estoque). */
export function fmtInteiro(n) {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}

/** Preço com as casas que a ordem de grandeza pede (ver `casasDoPreco`). */
export function fmtPreco(n, casas) {
  if (!Number.isFinite(n)) return "—";
  return fmtNum(n, casas ?? casasDoPreco(n));
}

/** "12.230,50 US$/t". */
export function fmtCotacao(n, moeda, unidade, casas) {
  if (!Number.isFinite(n)) return "—";
  return `${fmtPreco(n, casas)} ${rotuloCotacao(moeda, unidade)}`;
}

/** Variação em %, com sinal: "+1,25%", "−0,40%" (sinal de menos tipográfico), "0,00%". */
export function fmtPct(n, casas = 2) {
  if (!Number.isFinite(n)) return "—";
  const limpo = Math.abs(n) < 0.5 * 10 ** -casas ? 0 : n;
  const texto = fmtNum(Math.abs(limpo), casas);
  return `${limpo > 0 ? "+" : limpo < 0 ? "−" : ""}${texto}%`;
}

/** Diferença de preço com sinal: "+28,70", "−2.680,00". */
export function fmtDiferenca(n, casas) {
  if (!Number.isFinite(n)) return "—";
  const c = casas ?? casasDoPreco(n);
  // O que arredonda para zero sai sem sinal ("0,00", não "−0,00")
  const limpo = Math.abs(n) < 0.5 * 10 ** -c ? 0 : n;
  return `${limpo > 0 ? "+" : limpo < 0 ? "−" : ""}${fmtPreco(Math.abs(limpo), c)}`;
}

export const seta = (n) => (!Number.isFinite(n) ? "" : n > 0 ? "▲" : n < 0 ? "▼" : "▬");

/** Classe de cor pela direção: cerceta para alta, âmbar para baixa (assets/dexterity.css). */
export const classeDir = (n) => (!Number.isFinite(n) || n === 0 ? "" : n > 0 ? "dxt-badge--up" : "dxt-badge--down");
