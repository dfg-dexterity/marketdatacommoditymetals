// Xangai — SHFE e INE, boletim diário oficial. Função da Vercel, Node, sem dependências.
//   GET /api/shfe                   último pregão ENCERRADO (com ajuste), todos os vencimentos dos metais
//   GET /api/shfe?data=2026-11-20   pregão de uma data
// Resposta: { praca, fonte, data, pracas: { shfe: { cobre: [contratos], … }, ine: { cobre: [contratos] } } }.
// Erros em JSON { "erro": "…" }: 400 data inválida, 404 praça desativada ou dia sem pregão, 502 fonte
// fora do ar ou fora do formato (ver lib/http.js). O parse fica em lib/shfe.js.
import { pracaDe, pracaAtiva } from "../lib/catalogo.js";
import { abrirCors, erro, responder, exigirPraca, parametro, buscar } from "../lib/http.js";
import { urlBoletimShfe, URL_PREGOES_SHFE, FUSO_XANGAI, lerBoletimShfe, lerPregoesShfe } from "../lib/shfe.js";
import { dataValida, hojeEm, diasDeSemanaAte, fmtData } from "../lib/datas.js";
import { agora } from "../lib/relogio.js";

const PRACA = "shfe";
const NOME_FONTE = "a SHFE";
/** Dias de semana para trás quando a bolsa não informa o pregão corrente (cobre o feriado mais longo). */
const DIAS_PARA_TRAS = 9;

/** Boletim de um dia, ou null se a bolsa não tem arquivo (sem pregão). */
async function boletim(dia) {
  const json = await buscar(urlBoletimShfe(dia), { nome: NOME_FONTE, tipo: "json", aceitar404: true, tempo: 12000 });
  return json ? lerBoletimShfe(json) : null;
}

/** Datas a tentar, da mais nova para a mais antiga: as informadas pela bolsa e, depois, os dias de semana. */
async function candidatas() {
  const hoje = hojeEm(FUSO_XANGAI, agora());
  const dias = [];
  try {
    const p = lerPregoesShfe(await buscar(URL_PREGOES_SHFE, { nome: NOME_FONTE, tipo: "json", tentativas: 1, tempo: 8000 }));
    for (const d of [p.atual, p.anterior]) if (d && d <= hoje) dias.push(d);
  } catch {
    // sem a lista de pregões, segue pelos dias de semana
  }
  for (const d of diasDeSemanaAte(hoje, DIAS_PARA_TRAS)) if (!dias.includes(d)) dias.push(d);
  return dias.sort().reverse();
}

function corpo(b) {
  const p = pracaDe(PRACA);
  const pracas = {};
  for (const id of ["shfe", "ine"]) if (pracaAtiva(id)) pracas[id] = b.pracas[id] || {};
  return { praca: PRACA, fonte: p.fonte, url: p.url, data: b.data, atualizado_em: agora().toISOString(), pracas };
}

export default async function handler(req, res) {
  abrirCors(res);
  if (!exigirPraca(res, PRACA)) return;

  const data = parametro(req, "data");
  if (data) {
    if (!dataValida(data)) return erro(res, 400, "Data inválida: use data=AAAA-MM-DD.");
    if (data > hojeEm(FUSO_XANGAI, agora())) return erro(res, 400, "Data no futuro: o boletim só existe para pregões já realizados.");
    let b;
    try {
      b = await boletim(data);
    } catch (e) {
      return erro(res, 502, `Não foi possível obter o boletim da SHFE de ${fmtData(data)}: ${e.message}.`);
    }
    if (!b) return erro(res, 404, `A SHFE não tem boletim de ${fmtData(data)} (dia sem pregão).`);
    if (!b.completo) return erro(res, 404, `O pregão de ${fmtData(data)} na SHFE ainda não tem preço de ajuste.`);
    return responder(res, corpo(b), 86400);
  }

  let ultimoErro = null;
  for (const dia of await candidatas()) {
    try {
      const b = await boletim(dia);
      if (b && b.completo) return responder(res, corpo(b), 900);
    } catch (e) {
      ultimoErro = e;
      // 5xx ou rede: não adianta insistir nas datas seguintes
      break;
    }
  }
  erro(res, 502, `Não foi possível obter o último boletim da SHFE${ultimoErro ? `: ${ultimoErro.message}` : ": nenhum pregão encerrado nos últimos dias"}.`);
}
