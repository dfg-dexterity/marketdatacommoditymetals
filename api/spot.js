// Preço à vista indicativo (ouro, prata, platina, paládio e cobre) pela gold-api.com. Função da
// Vercel, Node, sem dependências.
//   GET /api/spot   → { praca, fonte, cotacoes: [{ metal, preco, moeda, unidade, atualizado_em }], falhas }
// Não é preço de bolsa nem o fixing de Londres. Erros em JSON { "erro": "…" }: 404 praça desativada,
// 502 quando nenhum metal pôde ser lido (ver lib/http.js). O parse fica em lib/spot.js.
import { pracaDe } from "../lib/catalogo.js";
import { abrirCors, erro, responder, exigirPraca, buscar } from "../lib/http.js";
import { urlSpot, simbolosSpot, lerSpot } from "../lib/spot.js";
import { agora } from "../lib/relogio.js";

const PRACA = "spot";
const NOME_FONTE = "a gold-api.com";

export default async function handler(req, res) {
  abrirCors(res);
  if (!exigirPraca(res, PRACA)) return;

  const pedidos = simbolosSpot();
  const resultados = await Promise.allSettled(pedidos.map(async (p) => {
    const lido = lerSpot(await buscar(urlSpot(p.simbolo), { nome: NOME_FONTE, tipo: "json", tempo: 8000 }), p.moeda);
    return { metal: p.metal, preco: lido.preco, moeda: p.moeda, unidade: p.unidade, atualizado_em: lido.atualizado_em };
  }));

  const cotacoes = [], falhas = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") cotacoes.push(r.value);
    else falhas.push({ metal: pedidos[i].metal, motivo: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
  });
  if (!cotacoes.length) return erro(res, 502, `Não foi possível obter o preço à vista: ${falhas[0] ? falhas[0].motivo : "sem resposta"}.`);

  const p = pracaDe(PRACA);
  responder(res, { praca: PRACA, fonte: p.fonte, url: p.url, atualizado_em: agora().toISOString(), cotacoes, falhas }, 60);
}
