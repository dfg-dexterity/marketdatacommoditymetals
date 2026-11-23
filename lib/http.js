/*
 * Utilitários das funções de /api (Vercel, Node, sem dependências): resposta, erro em JSON e busca na
 * fonte com tempo limite e uma nova tentativa. Não é usado pela página.
 *
 * Regras de todas as funções:
 *   - CORS aberto (`Access-Control-Allow-Origin: *`) antes de qualquer resposta, inclusive nos erros;
 *   - erro sempre em JSON { "erro": "…" } com `Cache-Control: no-store`: 400 para parâmetro inválido,
 *     404 para praça desativada no catálogo, 502 quando a fonte falha ou responde fora do formato —
 *     nunca um 200 enganoso;
 *   - sucesso com cache de CDN (`s-maxage`) e `stale-while-revalidate`, para poupar as fontes.
 */
import { pracaDe } from "./catalogo.js";

/** Identificação genérica: sem nome de pessoa, e-mail ou empresa. */
export const AGENTE = "Mozilla/5.0 (compatible; dados-de-mercado/1.0)";

export const TEMPO_LIMITE_MS = 20000;

/** Parâmetro repetido na URL chega como lista: vale o primeiro. */
export function primeiro(v) {
  return Array.isArray(v) ? v[0] : v;
}

/** Texto de um parâmetro de consulta, sem espaços nas pontas ("" quando ausente). */
export function parametro(req, nome) {
  return String(primeiro((req.query || {})[nome]) ?? "").trim();
}

export function abrirCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
}

export function erro(res, status, mensagem) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json({ erro: mensagem });
}

/** `segundos` de cache na CDN; a resposta velha segue servindo por um dia enquanto revalida. */
export function responder(res, corpo, segundos = 900) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", `s-maxage=${segundos}, stale-while-revalidate=86400`);
  res.status(200).json(corpo);
}

/**
 * Confere se a praça está ativa no catálogo. Se não estiver, responde 404 e devolve false.
 * Uso: `if (!exigirPraca(res, "lme")) return;`
 */
export function exigirPraca(res, id) {
  const p = pracaDe(id);
  if (p && p.ativa) return true;
  erro(res, 404, `A praça "${id}" está desativada nesta ferramenta.`);
  return false;
}

/** Erro de fonte com o status HTTP que ela devolveu (0 = sem resposta). */
export class ErroFonte extends Error {
  constructor(mensagem, status = 0) {
    super(mensagem);
    this.name = "ErroFonte";
    this.status = status;
  }
}

/**
 * Busca na fonte. `tipo`: "texto" | "json" | "bytes". Tenta de novo uma vez em falha de rede, tempo
 * esgotado ou HTTP 5xx/429; não repete em 4xx (repetir não muda nada). Lança ErroFonte com mensagem em
 * português que cita `nome` (a fonte) — a função acrescenta o contexto e devolve 502.
 * Com `aceitar404: true`, um 404 devolve null (dia sem arquivo na fonte).
 */
export async function buscar(url, { nome = "a fonte", tipo = "texto", tentativas = 2, tempo = TEMPO_LIMITE_MS, cabecalhos = {}, metodo = "GET", corpo, aceitar404 = false } = {}) {
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    try {
      const r = await fetch(url, {
        method: metodo,
        body: corpo,
        headers: { "User-Agent": AGENTE, Accept: "*/*", ...cabecalhos },
        signal: AbortSignal.timeout(tempo)
      });
      if (r.status === 404 && aceitar404) return null;
      if (!r.ok) {
        ultimo = new ErroFonte(`${nome} respondeu HTTP ${r.status}`, r.status);
        if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
        continue;
      }
      if (tipo === "bytes") return Buffer.from(await r.arrayBuffer());
      const texto = await r.text();
      if (tipo === "texto") return texto;
      try {
        return JSON.parse(texto);
      } catch {
        ultimo = new ErroFonte(`${nome} respondeu algo que não é JSON`, r.status);
      }
    } catch (e) {
      const esgotou = e && (e.name === "TimeoutError" || e.name === "AbortError");
      ultimo = new ErroFonte(esgotou ? `${nome} não respondeu a tempo` : `falha ao consultar ${nome} (${e && e.message ? e.message : e})`);
    }
  }
  throw ultimo;
}
