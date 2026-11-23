/*
 * Preço à vista (spot) indicativo dos metais preciosos e do cobre, pela API pública gold-api.com.
 * Não é referência de bolsa nem o fixing de Londres: serve para dar a ordem de grandeza do momento.
 * Funções puras (sem rede), usadas por api/spot.js.
 *
 *   https://api.gold-api.com/price/XAU  → { name, symbol, price, currency: "USD", updatedAt: "2026-11-23T06:18:41Z" }
 */
import { METAIS } from "./catalogo.js";

export const HOST_SPOT = "https://api.gold-api.com";

export function urlSpot(simbolo) {
  return `${HOST_SPOT}/price/${encodeURIComponent(simbolo)}`;
}

/** Metais com spot no catálogo: [{ metal, simbolo, moeda, unidade }]. */
export function simbolosSpot() {
  return METAIS.filter((m) => m.instrumentos.spot).map((m) => ({ metal: m.id, ...m.instrumentos.spot }));
}

/**
 * Lê uma resposta: { preco, moeda, atualizado_em } ou lança erro se vier fora do formato ou em moeda
 * diferente da esperada (a API converte para outras moedas quando pedem; aqui só interessa o dólar).
 */
export function lerSpot(json, moedaEsperada = "USD") {
  if (!json || !Number.isFinite(json.price) || json.price <= 0) throw new Error("resposta de preço à vista fora do formato esperado");
  const moeda = String(json.currency ?? "").toUpperCase();
  if (moeda !== moedaEsperada) throw new Error(`preço à vista veio em ${moeda || "moeda desconhecida"}, não em ${moedaEsperada}`);
  const quando = new Date(json.updatedAt);
  return { preco: json.price, moeda, atualizado_em: Number.isNaN(quando.getTime()) ? null : quando.toISOString() };
}
