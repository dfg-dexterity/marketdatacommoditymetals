// Nova York — COMEX e NYMEX (CME Group), pelo Yahoo Finance. Função da Vercel, Node, sem dependências.
//   GET /api/comex                          painel: contrato de referência de cada metal (último ajuste,
//                                           o anterior e o negócio do dia em curso, quando há)
//   GET /api/comex?metal=ouro               curva: todos os vencimentos listados do metal
//   GET /api/comex?metal=ouro&de=2021-11-23 histórico diário do 1º vencimento (contínuo), até hoje ou &ate=
// Erros em JSON { "erro": "…" }: 400 parâmetro inválido, 404 praça desativada, 502 fonte fora do ar ou
// fora do formato (ver lib/http.js). Símbolos e parse em lib/yahoo.js.
import { metalDe, metaisDaPraca, instrumentoDe, pracaDe } from "../lib/catalogo.js";
import { abrirCors, erro, responder, exigirPraca, parametro, buscar } from "../lib/http.js";
import {
  simboloContinuo, simboloContrato, contratoDoSimbolo, mesesAFrente, vencimentoDeReferencia,
  urlSpark, urlChart, emLotes, lerSpark, lerChart, mesAtualNY
} from "../lib/yahoo.js";
import { dataValida, hojeEm, somarDias } from "../lib/datas.js";
import { agora } from "../lib/relogio.js";

const PRACA = "comex";
const NOME_FONTE = "o Yahoo Finance (CME)";
/** Quantos meses à frente procurar vencimentos listados. */
const MESES_DA_CURVA = 40;
/** O histórico dos futuros de metais na fonte começa em 2000; antes de 1990 o pedido nem faz sentido. */
const PRIMEIRA_DATA = "1990-01-01";

const base = () => {
  const p = pracaDe(PRACA);
  return { praca: PRACA, fonte: p.fonte, url: p.url, atualizado_em: agora().toISOString() };
};

async function spark(simbolos) {
  const partes = await Promise.all(emLotes(simbolos).map(async (lote) => {
    try {
      return lerSpark(await buscar(urlSpark(lote), { nome: NOME_FONTE, tipo: "json" }), agora());
    } catch (e) {
      // O Yahoo responde 404 quando nenhum símbolo do lote existe: não é falha da fonte
      if (e.status === 404) return {};
      throw e;
    }
  }));
  return Object.assign({}, ...partes);
}

async function painel(res) {
  const mes = mesAtualNY(agora());
  const metais = metaisDaPraca(PRACA);
  const pedidos = metais.map((m) => {
    const i = instrumentoDe(m, PRACA);
    const vencimento = i.continuo ? null : vencimentoDeReferencia(i.ciclo, mes);
    return { metal: m, inst: i, vencimento, simbolo: vencimento ? simboloContrato(i.raiz, vencimento, i.sufixo) : null, continuo: simboloContinuo(i.raiz) };
  });

  let lidos;
  try {
    lidos = await spark([...new Set(pedidos.flatMap((p) => [p.simbolo, p.continuo]).filter(Boolean))]);
  } catch (e) {
    return erro(res, 502, `Não foi possível obter as cotações da COMEX: ${e.message}.`);
  }

  const cotacoes = [];
  for (const p of pedidos) {
    // Sem o contrato de referência (ainda não listado ou sem negócio), vale o 1º vencimento
    const usarContrato = p.simbolo && lidos[p.simbolo];
    const q = usarContrato ? lidos[p.simbolo] : lidos[p.continuo];
    if (!q) continue;
    cotacoes.push({
      metal: p.metal.id,
      simbolo: usarContrato ? p.simbolo : p.continuo,
      contrato: usarContrato ? contratoDoSimbolo(p.simbolo).codigo : null,
      vencimento: usarContrato ? p.vencimento : null,
      ...q
    });
  }
  if (!cotacoes.length) return erro(res, 502, "Não foi possível obter as cotações da COMEX: a fonte não devolveu nenhum contrato.");
  responder(res, { ...base(), data: cotacoes.map((c) => c.data).sort().pop(), cotacoes }, 600);
}

async function curva(res, metal, inst) {
  if (inst.continuo) {
    return erro(res, 400, `${metal.nome} não tem curva por vencimento nesta praça: a fonte só publica o 1º vencimento.`);
  }
  const simbolos = mesesAFrente(mesAtualNY(agora()), MESES_DA_CURVA).map((m) => simboloContrato(inst.raiz, m, inst.sufixo));
  let lidos;
  try {
    lidos = await spark(simbolos);
  } catch (e) {
    return erro(res, 502, `Não foi possível obter a curva de ${metal.nome} na COMEX: ${e.message}.`);
  }
  // Só os símbolos pedidos (a ordem deles já é a dos vencimentos): nada de aceitar o que vier a mais
  const contratos = simbolos
    .filter((simbolo) => lidos[simbolo])
    .map((simbolo) => {
      const c = contratoDoSimbolo(simbolo);
      return { contrato: c.codigo, simbolo, vencimento: c.vencimento, ...lidos[simbolo] };
    });
  if (!contratos.length) return erro(res, 502, `A fonte não devolveu vencimentos de ${metal.nome} na COMEX.`);
  responder(res, {
    ...base(), metal: metal.id, moeda: inst.moeda, unidade: inst.unidade,
    data: contratos.map((c) => c.data).sort().pop(), contratos
  }, 600);
}

async function historico(res, metal, inst, de, ate) {
  const simbolo = simboloContinuo(inst.raiz);
  const inicio = Math.floor(Date.parse(`${de}T00:00:00Z`) / 1000);
  const fim = Math.floor(Date.parse(`${somarDias(ate, 1)}T23:59:59Z`) / 1000);
  let pontos;
  try {
    pontos = lerChart(await buscar(urlChart(simbolo, inicio, fim), { nome: NOME_FONTE, tipo: "json" }), agora())
      .filter((p) => p.data >= de && p.data <= ate);
  } catch (e) {
    return erro(res, 502, `Não foi possível obter o histórico de ${metal.nome} na COMEX: ${e.message}.`);
  }
  responder(res, { ...base(), metal: metal.id, simbolo, moeda: inst.moeda, unidade: inst.unidade, de, ate, pontos }, 3600);
}

export default async function handler(req, res) {
  abrirCors(res);
  if (!exigirPraca(res, PRACA)) return;

  const idMetal = parametro(req, "metal");
  const de = parametro(req, "de");
  const ate = parametro(req, "ate") || hojeEm("America/New_York", agora());
  if (!idMetal && !de) return painel(res);

  const metal = metalDe(idMetal);
  const inst = metal ? instrumentoDe(metal, PRACA) : null;
  if (!inst) {
    return erro(res, 400, `Metal inválido${idMetal ? ` ("${idMetal}")` : ""}. Use ?metal= com um destes: ${metaisDaPraca(PRACA).map((m) => m.id).join(", ")}.`);
  }
  if (!de) return curva(res, metal, inst);

  if (!dataValida(de) || !dataValida(ate)) return erro(res, 400, "Período inválido: use de=AAAA-MM-DD (e, se quiser, ate=AAAA-MM-DD).");
  if (de > ate) return erro(res, 400, "Período invertido: a data inicial é posterior à final.");
  if (de < PRIMEIRA_DATA) return erro(res, 400, `Período inválido: a data inicial mais antiga aceita é ${PRIMEIRA_DATA}.`);
  return historico(res, metal, inst, de, ate);
}
