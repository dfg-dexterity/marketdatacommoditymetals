// São Paulo — B3, Futuro de Ouro (GLD), pelo boletim público de pregão (SPRD). Função da Vercel, Node,
// sem dependências.
//   GET /api/b3                   último pregão publicado, todos os vencimentos do GLD
//   GET /api/b3?data=2026-11-19   pregão de uma data
// A B3 demora dezenas de segundos para entregar o arquivo de um pregão (o de um dia sem pregão vem vazio
// e rápido): a página chama esta função à parte, sem segurar as outras praças, e a CDN guarda a resposta.
// Erros em JSON { "erro": "…" }: 400 data inválida, 404 praça desativada ou dia sem pregão, 502 fonte
// fora do ar ou fora do formato (ver lib/http.js). O parse fica em lib/b3.js.
import { metaisDaPraca, instrumentoDe, pracaDe } from "../lib/catalogo.js";
import { abrirCors, erro, responder, exigirPraca, parametro, buscar } from "../lib/http.js";
import { urlSprd, xmlDoSprd, lerContratosB3 } from "../lib/b3.js";
import { dataValida, hojeEm, horaEm, diasDeSemanaAte, somarDias, fmtData } from "../lib/datas.js";
import { agora } from "../lib/relogio.js";

const PRACA = "b3";
const NOME_FONTE = "a B3";
const FUSO = "America/Sao_Paulo";
/** A função tem 60 s na Vercel: para de tentar datas quando o que resta não basta para um arquivo. */
const ORCAMENTO_MS = 52000;
/** O boletim sai por volta das 20h; antes disso nem vale tentar o dia corrente. */
const HORA_DO_BOLETIM = 20;
const DIAS_PARA_TRAS = 5;
/** O arquivo da B3 leva o ano com 2 dígitos (SPRD261119): antes de 2000 a data seria confundida com este século. */
const PRIMEIRA_DATA = "2000-01-01";

/** Contratos do pregão: lista (vazia quando o arquivo existe sem o prefixo) ou null se não houve pregão. */
async function pregao(dia, prefixo, tempo) {
  const bytes = await buscar(urlSprd(dia), { nome: NOME_FONTE, tipo: "bytes", tentativas: 1, tempo });
  const xml = xmlDoSprd(bytes);
  return xml === null ? null : lerContratosB3(xml, prefixo);
}

function corpo(metal, inst, contratos) {
  const p = pracaDe(PRACA);
  return {
    praca: PRACA, fonte: p.fonte, url: p.url, metal: metal.id, moeda: inst.moeda, unidade: inst.unidade,
    data: contratos[0].data, atualizado_em: agora().toISOString(), contratos
  };
}

export default async function handler(req, res) {
  abrirCors(res);
  if (!exigirPraca(res, PRACA)) return;

  // Hoje a praça só tem o ouro (GLD); o catálogo decide
  const metal = metaisDaPraca(PRACA)[0];
  const inst = metal ? instrumentoDe(metal, PRACA) : null;
  if (!inst) return erro(res, 404, "Nenhum metal do catálogo é negociado na B3.");

  const hoje = hojeEm(FUSO, agora());
  const data = parametro(req, "data");
  if (data) {
    if (!dataValida(data)) return erro(res, 400, "Data inválida: use data=AAAA-MM-DD.");
    if (data > hoje) return erro(res, 400, "Data no futuro: o boletim só existe para pregões já realizados.");
    if (data < PRIMEIRA_DATA) return erro(res, 400, `Data antiga demais: use data= a partir de ${fmtData(PRIMEIRA_DATA)}.`);
    let contratos;
    try {
      contratos = await pregao(data, inst.prefixo, ORCAMENTO_MS);
    } catch (e) {
      return erro(res, 502, `Não foi possível obter o boletim da B3 de ${fmtData(data)}: ${e.message}.`);
    }
    // O arquivo traz a data do pregão dentro dele: se não for a pedida, não é resposta para esta data
    if (!contratos || !contratos.length || contratos[0].data !== data) {
      return erro(res, 404, `A B3 não tem ajuste do ${inst.prefixo} em ${fmtData(data)} (dia sem pregão ou boletim ainda não publicado).`);
    }
    return responder(res, corpo(metal, inst, contratos), 604800);
  }

  const inicio = Date.now();
  const primeiro = horaEm(FUSO, agora()) >= HORA_DO_BOLETIM ? hoje : somarDias(hoje, -1);
  let ultimoErro = null;
  for (const dia of diasDeSemanaAte(primeiro, DIAS_PARA_TRAS)) {
    const resta = ORCAMENTO_MS - (Date.now() - inicio);
    if (resta < 5000) break;
    try {
      const contratos = await pregao(dia, inst.prefixo, resta);
      if (contratos && contratos.length) return responder(res, corpo(metal, inst, contratos), 3600);
    } catch (e) {
      ultimoErro = e;
      break;
    }
  }
  erro(res, 502, `Não foi possível obter o último boletim da B3${ultimoErro ? `: ${ultimoErro.message}` : ": nenhum pregão publicado nos últimos dias"}.`);
}
