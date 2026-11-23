// Câmbio do Banco Central do Brasil para converter as cotações. Função da Vercel, Node, sem dependências.
//   GET /api/cambio                              último boletim de fechamento da PTAX: reais por dólar,
//                                                iuane, euro, libra e iene (venda e compra) e o ouro em
//                                                reais por grama
//   GET /api/cambio?de=2025-11-23&ate=2026-11-23 série diária do dólar (PTAX de fechamento) no período
// Erros em JSON { "erro": "…" }: 400 parâmetro inválido, 502 fonte fora do ar ou fora do formato (ver
// lib/http.js). O parse fica em lib/bcb.js.
import { abrirCors, erro, responder, parametro, buscar } from "../lib/http.js";
import { urlFechamento, lerFechamento, urlDolarPeriodo, lerDolarPeriodo } from "../lib/bcb.js";
import { dataValida, hojeEm, diasDeSemanaAte, diasEntre } from "../lib/datas.js";
import { agora } from "../lib/relogio.js";

const NOME_FONTE = "o Banco Central";
const FUSO = "America/Sao_Paulo";
const URL_PUBLICA = "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes";
/** Dias de semana para trás até achar um boletim (cobre Carnaval e emendas de feriado). */
const DIAS_PARA_TRAS = 7;
/** Limite do período da série: cobre o histórico inteiro da COMEX (desde 2000) num pedido só. */
const MAXIMO_DE_DIAS = 366 * 30;

async function ultimoFechamento(res) {
  let ultimoErro = null;
  for (const dia of diasDeSemanaAte(hojeEm(FUSO, agora()), DIAS_PARA_TRAS)) {
    try {
      const csv = await buscar(urlFechamento(dia), { nome: NOME_FONTE, aceitar404: true });
      if (csv === null) continue; // feriado, ou o boletim do dia ainda não saiu
      const f = lerFechamento(csv);
      return responder(res, {
        fonte: "Banco Central do Brasil — PTAX de fechamento", url: URL_PUBLICA,
        data: f.data, atualizado_em: agora().toISOString(),
        brl: f.brl, compra: f.compra,
        ouro: f.ouro ? { ...f.ouro, moeda: "BRL", unidade: "g" } : null
      }, 900);
    } catch (e) {
      ultimoErro = e;
      break;
    }
  }
  erro(res, 502, `Não foi possível obter o câmbio do Banco Central${ultimoErro ? `: ${ultimoErro.message}` : ": nenhum boletim de fechamento nos últimos dias"}.`);
}

export default async function handler(req, res) {
  abrirCors(res);

  const de = parametro(req, "de");
  const ate = parametro(req, "ate");
  if (!de && !ate) return ultimoFechamento(res);

  if (!dataValida(de) || !dataValida(ate)) return erro(res, 400, "Período inválido: use de=AAAA-MM-DD&ate=AAAA-MM-DD.");
  if (de > ate) return erro(res, 400, "Período invertido: a data inicial é posterior à final.");
  if (diasEntre(de, ate) > MAXIMO_DE_DIAS) return erro(res, 400, "Período longo demais: peça até 30 anos por vez.");

  let pontos;
  try {
    pontos = lerDolarPeriodo(await buscar(urlDolarPeriodo(de, ate), { nome: NOME_FONTE, tipo: "json" }));
  } catch (e) {
    return erro(res, 502, `Não foi possível obter a série do dólar no Banco Central: ${e.message}.`);
  }
  responder(res, {
    fonte: "Banco Central do Brasil — PTAX de fechamento", url: URL_PUBLICA,
    moeda: "USD", de, ate, atualizado_em: agora().toISOString(), pontos
  }, 3600);
}
