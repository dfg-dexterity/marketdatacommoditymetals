// LME (Londres) — preços oficiais pelas tabelas da Westmetall. Função da Vercel, Node, sem dependências.
//   GET /api/lme                        painel: último pregão dos metais (cash, 3 meses, estoque, variação
//                                       do dia e médias do mês corrente e do anterior)
//   GET /api/lme?metal=cobre&ano=2025   histórico diário de um metal num ano (2008 em diante)
// Erros em JSON { "erro": "…" }: 400 parâmetro inválido, 404 praça desativada, 502 fonte fora do ar ou
// fora do formato (ver lib/http.js). O parse fica em lib/westmetall.js.
import { metalDe, metaisDaPraca, instrumentoDe, pracaDe } from "../lib/catalogo.js";
import { abrirCors, erro, responder, exigirPraca, parametro, buscar } from "../lib/http.js";
import { urlTabelaLme, lerTabelaLme, resumoLme, PRIMEIRO_ANO_LME } from "../lib/westmetall.js";
import { hojeEm } from "../lib/datas.js";
import { agora } from "../lib/relogio.js";

const PRACA = "lme";
const NOME_FONTE = "a Westmetall (LME)";

async function tabela(campo, ano) {
  // 12 s por tentativa: em janeiro o painel pede dois anos em sequência e tem de caber nos 60 s da função
  return lerTabelaLme(await buscar(urlTabelaLme(campo, ano), { nome: NOME_FONTE, tempo: 12000 }));
}

async function painel(res, anoAtual) {
  const metais = metaisDaPraca(PRACA);
  const resultados = await Promise.allSettled(metais.map(async (m) => {
    const campo = instrumentoDe(m, PRACA).campo;
    let pontos = await tabela(campo);
    // Primeiros pregões de janeiro: o anterior e a média do mês passado estão na página do ano anterior
    if (pontos.length < 25) pontos = [...(await tabela(campo, anoAtual - 1).catch(() => [])), ...pontos];
    const resumo = resumoLme(m.id, pontos);
    if (!resumo) throw new Error("sem cotações");
    return resumo;
  }));

  const cotacoes = [], falhas = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") cotacoes.push(r.value);
    else falhas.push({ metal: metais[i].id, motivo: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
  });
  if (!cotacoes.length) {
    return erro(res, 502, `Não foi possível obter os preços da LME: ${falhas[0] ? falhas[0].motivo : "sem resposta"}.`);
  }

  const praca = pracaDe(PRACA);
  responder(res, {
    praca: PRACA,
    fonte: praca.fonte,
    url: praca.url,
    data: cotacoes.map((c) => c.data).sort().pop(),
    atualizado_em: agora().toISOString(),
    cotacoes,
    falhas
  }, 1800);
}

export default async function handler(req, res) {
  abrirCors(res);
  if (!exigirPraca(res, PRACA)) return;

  const anoAtual = Number(hojeEm("Europe/London", agora()).slice(0, 4));
  const idMetal = parametro(req, "metal");
  const textoAno = parametro(req, "ano");
  if (!idMetal && !textoAno) return painel(res, anoAtual);

  const metal = metalDe(idMetal);
  const inst = metal ? instrumentoDe(metal, PRACA) : null;
  if (!inst) {
    return erro(res, 400, `Metal inválido${idMetal ? ` ("${idMetal}")` : ""}. Use ?metal= com um destes: ${metaisDaPraca(PRACA).map((m) => m.id).join(", ")}.`);
  }
  const ano = textoAno ? Number(textoAno) : anoAtual;
  if (!/^\d{4}$/.test(textoAno || String(anoAtual)) || ano < PRIMEIRO_ANO_LME || ano > anoAtual) {
    return erro(res, 400, `Ano inválido: use ?ano= entre ${PRIMEIRO_ANO_LME} e ${anoAtual}.`);
  }

  let pontos;
  try {
    pontos = await tabela(inst.campo, ano);
  } catch (e) {
    return erro(res, 502, `Não foi possível obter ${metal.nome} na LME em ${ano}: ${e.message}.`);
  }
  const praca = pracaDe(PRACA);
  responder(res, {
    praca: PRACA,
    fonte: praca.fonte,
    url: praca.url,
    metal: metal.id,
    ano,
    moeda: inst.moeda,
    unidade: inst.unidade,
    atualizado_em: agora().toISOString(),
    pontos
  }, ano < anoAtual ? 604800 : 1800);
}
