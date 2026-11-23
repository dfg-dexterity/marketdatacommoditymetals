// Médias mensais dos metais em dólar desde 1960 — Banco Mundial, Commodity Price Data (Pink Sheet),
// CC BY 4.0. Função da Vercel, Node, sem dependências.
//   GET /api/mensal   → { praca, fonte, atualizado, series: { cobre: { moeda, unidade, pontos: [["1960-01", 715.4], …] } } }
// O endereço da planilha muda a cada edição: a função acha o link na página do Banco Mundial e baixa o
// XLSX (cerca de 600 KB). Erros em JSON { "erro": "…" }: 404 praça desativada, 502 fonte fora do ar ou
// fora do formato (ver lib/http.js). O parse fica em lib/bancomundial.js.
import { pracaDe } from "../lib/catalogo.js";
import { abrirCors, erro, responder, exigirPraca, buscar } from "../lib/http.js";
import { PAGINA_BANCO_MUNDIAL, acharLinkPlanilha, lerPlanilhaMensal } from "../lib/bancomundial.js";
import { agora } from "../lib/relogio.js";

const PRACA = "bm";
const NOME_FONTE = "o Banco Mundial";

export default async function handler(req, res) {
  abrirCors(res);
  if (!exigirPraca(res, PRACA)) return;

  let lido, link;
  try {
    // Página e planilha em sequência: os tempos somados têm de caber nos 60 s da função
    link = acharLinkPlanilha(await buscar(PAGINA_BANCO_MUNDIAL, { nome: NOME_FONTE, tempo: 10000 }));
    if (!link) throw new Error("a página do Banco Mundial não traz mais o link da planilha mensal");
    lido = lerPlanilhaMensal(await buscar(link, { nome: NOME_FONTE, tipo: "bytes", tempo: 25000, tentativas: 1 }));
  } catch (e) {
    return erro(res, 502, `Não foi possível obter as médias mensais do Banco Mundial: ${e.message}.`);
  }

  const p = pracaDe(PRACA);
  responder(res, {
    praca: PRACA,
    fonte: "Banco Mundial — Commodity Price Data (The Pink Sheet), CC BY 4.0",
    url: p.url,
    planilha: link,
    atualizado: lido.atualizado,
    atualizado_em: agora().toISOString(),
    series: lido.series
  }, 43200);
}
