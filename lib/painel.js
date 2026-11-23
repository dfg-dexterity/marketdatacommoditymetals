/*
 * Junta as respostas das funções de /api em linhas prontas para a tela: a cotação de referência de cada
 * metal em cada praça e a curva por vencimento. Funções puras, usadas pela página e pelos testes.
 *
 * `fontes` é o que a página já carregou (cada chave pode faltar — a praça fica de fora, sem erro):
 *   { lme, comex, shfe, b3, cambio, spot }       respostas de /api/lme, /api/comex, /api/shfe…
 *   { curvasComex: { ouro: resposta de /api/comex?metal=ouro } }   pedidas sob demanda
 *
 * Linha de cotação:
 *   { praca, chave, referencia, detalhe, data, preco, anterior, moeda, unidade, iva, intradia }
 * `chave` identifica a linha ("lme:cash", "comex", "shfe"…); `iva` diz se o preço embute o IVA chinês.
 */
import { METAIS, instrumentoDe, pracaDe } from "./catalogo.js";
import { contratoPrincipal } from "./shfe.js";
import { rotuloMes, somarDiasDeSemana, somarMesesAoDia, mesDe, ajustarParaDiaDeSemana, hojeEm } from "./datas.js";
import { diaDoVencimento } from "./curva.js";

const numero = (v) => (Number.isFinite(v) ? v : null);

/** Dia de um instante ISO no calendário de São Paulo (o spot é de agora; em UTC, à noite já seria amanhã). */
function diaEmSaoPaulo(instante) {
  const d = new Date(instante);
  return instante && !Number.isNaN(d.getTime()) ? hojeEm("America/Sao_Paulo", d) : null;
}

function linha(inst, extras) {
  return {
    praca: inst.praca, moeda: inst.moeda, unidade: inst.unidade, iva: inst.iva,
    detalhe: "", anterior: null, intradia: null, ...extras
  };
}

/** Texto do contrato de referência: "Z26 · dez/2026" ou "2701 · jan/2027". */
export function rotuloContrato(contrato, vencimento) {
  return vencimento ? `${contrato} · ${rotuloMes(vencimento)}` : String(contrato ?? "—");
}

/** Cotações de referência do metal em cada praça carregada, na ordem do catálogo de praças. */
export function cotacoesDoMetal(metal, fontes = {}) {
  const linhas = [];
  const { lme, comex, shfe, b3, cambio, spot } = fontes;

  const iLme = instrumentoDe(metal, "lme");
  const cLme = iLme && lme && Array.isArray(lme.cotacoes) ? lme.cotacoes.find((c) => c.metal === metal.id) : null;
  if (cLme) {
    if (Number.isFinite(cLme.cash)) {
      linhas.push(linha(iLme, { chave: "lme:cash", referencia: "Cash settlement", detalhe: "preço oficial à vista", data: cLme.data, preco: cLme.cash, anterior: numero(cLme.anteriorCash) }));
    }
    if (Number.isFinite(cLme.tresMeses)) {
      linhas.push(linha(iLme, { chave: "lme:3m", referencia: "3 meses", detalhe: "preço oficial a termo", data: cLme.data, preco: cLme.tresMeses, anterior: numero(cLme.anteriorTresMeses) }));
    }
  }

  const iComex = instrumentoDe(metal, "comex");
  const cComex = iComex && comex && Array.isArray(comex.cotacoes) ? comex.cotacoes.find((c) => c.metal === metal.id) : null;
  if (cComex && Number.isFinite(cComex.preco)) {
    linhas.push(linha(iComex, {
      chave: "comex",
      referencia: cComex.contrato ? rotuloContrato(cComex.contrato, cComex.vencimento) : "1º vencimento",
      detalhe: cComex.contrato ? "vencimento de referência" : "contrato contínuo",
      data: cComex.data, preco: cComex.preco, anterior: numero(cComex.anterior), intradia: cComex.intradia || null
    }));
  }

  for (const praca of ["shfe", "ine"]) {
    const inst = instrumentoDe(metal, praca);
    const contratos = inst && shfe && shfe.pracas && shfe.pracas[praca] ? shfe.pracas[praca][metal.id] : null;
    const p = contratoPrincipal(contratos);
    if (p) {
      linhas.push(linha(inst, {
        chave: praca, referencia: rotuloContrato(p.contrato, p.vencimento), detalhe: "maior posição em aberto",
        data: p.data, preco: p.preco, anterior: numero(p.anterior)
      }));
    }
  }

  const iB3 = instrumentoDe(metal, "b3");
  if (iB3 && b3 && b3.metal === metal.id) {
    const p = contratoPrincipal(b3.contratos);
    if (p) {
      linhas.push(linha(iB3, {
        chave: "b3", referencia: rotuloContrato(`${iB3.prefixo}${p.contrato}`, p.vencimento), detalhe: "maior posição em aberto",
        data: p.data, preco: p.preco, anterior: numero(p.anterior)
      }));
    }
  }

  const iBcb = instrumentoDe(metal, "bcb");
  if (iBcb && cambio && cambio.ouro && Number.isFinite(cambio.ouro.venda)) {
    linhas.push(linha(iBcb, { chave: "bcb", referencia: "PTAX de fechamento", detalhe: "taxa de venda", data: cambio.data, preco: cambio.ouro.venda }));
  }

  const iSpot = instrumentoDe(metal, "spot");
  const cSpot = iSpot && spot && Array.isArray(spot.cotacoes) ? spot.cotacoes.find((c) => c.metal === metal.id) : null;
  if (cSpot && Number.isFinite(cSpot.preco)) {
    linhas.push(linha(iSpot, {
      chave: "spot", referencia: "À vista", detalhe: "indicativo, não é preço de bolsa",
      data: diaEmSaoPaulo(cSpot.atualizado_em), preco: cSpot.preco
    }));
  }

  return linhas;
}

/** Todas as linhas do painel geral: as cotações de cada metal, com o metal junto. */
export function linhasDoPainel(fontes = {}) {
  return METAIS.flatMap((metal) => cotacoesDoMetal(metal, fontes).map((l) => ({ ...l, metal: metal.id })));
}

/**
 * Curva do metal numa praça: pontos com `dataVencimento` preenchida, prontos para lib/curva.js.
 *   lme   — dois pontos: cash (liquida em 2 dias úteis) e 3 meses (data do pregão + 3 meses, em dia
 *           de semana);
 *   comex — de `fontes.curvasComex[metal.id]`, vencimento no último dia de semana do mês de entrega;
 *   shfe, ine — do boletim, vencimento no dia 15 do mês de entrega (ou na segunda-feira seguinte);
 *   b3    — do boletim de pregão, vencimento no último dia de semana do mês.
 * Devolve [] quando a praça não tem curva carregada para o metal.
 */
export function curvaDoMetal(metal, pracaId, fontes = {}) {
  const inst = instrumentoDe(metal, pracaId);
  const praca = pracaDe(pracaId);
  if (!inst || !praca || !praca.curva) return [];

  if (pracaId === "lme") {
    const c = fontes.lme && Array.isArray(fontes.lme.cotacoes) ? fontes.lme.cotacoes.find((x) => x.metal === metal.id) : null;
    if (!c) return [];
    const pontos = [];
    if (Number.isFinite(c.cash)) {
      const dia = somarDiasDeSemana(c.data, 2);
      pontos.push({ contrato: "Cash", vencimento: mesDe(dia), dataVencimento: dia, data: c.data, preco: c.cash, anterior: numero(c.anteriorCash), volume: null, emAberto: null });
    }
    if (Number.isFinite(c.tresMeses)) {
      // Data prompt de 3 meses: mesmo dia 3 meses à frente, ajustada para dia de semana sem mudar de mês
      const dia = ajustarParaDiaDeSemana(somarMesesAoDia(c.data, 3), "modificado");
      pontos.push({ contrato: "3 meses", vencimento: mesDe(dia), dataVencimento: dia, data: c.data, preco: c.tresMeses, anterior: numero(c.anteriorTresMeses), volume: null, emAberto: null });
    }
    return pontos;
  }

  let contratos = null;
  if (pracaId === "comex") {
    const r = fontes.curvasComex ? fontes.curvasComex[metal.id] : null;
    contratos = r ? r.contratos : null;
  } else if (pracaId === "shfe" || pracaId === "ine") {
    contratos = fontes.shfe && fontes.shfe.pracas && fontes.shfe.pracas[pracaId] ? fontes.shfe.pracas[pracaId][metal.id] : null;
  } else if (pracaId === "b3") {
    contratos = fontes.b3 && fontes.b3.metal === metal.id ? fontes.b3.contratos : null;
  }
  if (!Array.isArray(contratos)) return [];

  return contratos
    .filter((c) => Number.isFinite(c.preco))
    .map((c) => ({
      contrato: pracaId === "b3" ? `${inst.prefixo}${c.contrato}` : c.contrato,
      vencimento: c.vencimento,
      dataVencimento: diaDoVencimento(c.vencimento, praca.vencimento || "fim"),
      data: c.data,
      preco: c.preco,
      anterior: numero(c.anterior),
      volume: numero(c.volume ?? c.negocios),
      emAberto: numero(c.emAberto)
    }));
}

/** Praças em que o metal tem curva (as que a página oferece no seletor da curva). */
export function pracasComCurva(metal) {
  return ["lme", "comex", "shfe", "ine", "b3"].filter((id) => {
    const inst = instrumentoDe(metal, id);
    return inst && !inst.continuo && pracaDe(id).curva;
  });
}

/**
 * Médias mensais de uma série diária [{ data, valor }]: [{ mes, media, dias, minimo, maximo }] em ordem
 * cronológica. É a conta do período de cotação (QP) dos contratos: média simples dos dias do mês.
 */
export function mediasMensais(pontos) {
  const porMes = new Map();
  for (const p of pontos || []) {
    if (!Number.isFinite(p.valor)) continue;
    const mes = mesDe(p.data);
    const m = porMes.get(mes) || { mes, soma: 0, dias: 0, minimo: Infinity, maximo: -Infinity };
    m.soma += p.valor; m.dias++; m.minimo = Math.min(m.minimo, p.valor); m.maximo = Math.max(m.maximo, p.valor);
    porMes.set(mes, m);
  }
  return [...porMes.keys()].sort().map((k) => {
    const m = porMes.get(k);
    return { mes: m.mes, media: m.soma / m.dias, dias: m.dias, minimo: m.minimo, maximo: m.maximo };
  });
}
