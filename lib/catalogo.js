/*
 * Catálogo da Cotação de Metais — FONTE ÚNICA de metais, praças e instrumentos. É importado pelas
 * funções de /api, pela página e pelos testes: não repetir estas listas em outro lugar.
 *
 * PRAÇA = mercado de referência onde o metal tem preço (Londres/LME, Nova York/COMEX, Xangai/SHFE,
 * São Paulo/B3…). Cada praça tem uma função em /api e uma fonte pública. Para tirar uma praça do ar
 * (por exemplo, por decisão de licenciamento de dados), basta `ativa: false` aqui: a função passa a
 * responder 404 e a página deixa de mostrá-la.
 *
 * INSTRUMENTO = como o metal é cotado numa praça: moeda, unidade, código na fonte, MIC (ISO 10383)
 * e, na CME, o ciclo de meses de maior liquidez (para escolher o contrato de referência).
 */

export const PRACAS = [
  {
    id: "lme", ativa: true, cidade: "Londres", bolsa: "LME", nome: "Londres · LME",
    titulo: "London Metal Exchange — preços oficiais (cash settlement e 3 meses)",
    mic: "XLME", atraso: "preço oficial do pregão anterior",
    fonte: "Westmetall", url: "https://www.westmetall.com/en/markdaten.php",
    curva: true, historico: true, vencimento: null
  },
  {
    id: "comex", ativa: true, cidade: "Nova York", bolsa: "COMEX", nome: "Nova York · COMEX",
    titulo: "CME Group — COMEX e NYMEX, ajuste diário por vencimento",
    mic: "XCEC", atraso: "ajuste do pregão anterior",
    fonte: "Yahoo Finance", url: "https://finance.yahoo.com/commodities/",
    curva: true, historico: true, vencimento: "fim"
  },
  {
    id: "shfe", ativa: true, cidade: "Xangai", bolsa: "SHFE", nome: "Xangai · SHFE",
    titulo: "Shanghai Futures Exchange — boletim diário oficial",
    mic: "XSGE", atraso: "ajuste do último pregão encerrado",
    fonte: "SHFE", url: "https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/",
    curva: true, historico: false, vencimento: 15
  },
  {
    id: "ine", ativa: true, cidade: "Xangai", bolsa: "INE", nome: "Xangai · INE",
    titulo: "Shanghai International Energy Exchange — cobre internacional (sem IVA)",
    mic: "XINE", atraso: "ajuste do último pregão encerrado",
    fonte: "SHFE", url: "https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/",
    curva: true, historico: false, vencimento: 15
  },
  {
    id: "b3", ativa: true, cidade: "São Paulo", bolsa: "B3", nome: "São Paulo · B3",
    titulo: "B3 — Futuro de Ouro (GLD), ajuste do pregão",
    mic: "BVMF", atraso: "ajuste do último pregão",
    fonte: "B3", url: "https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/boletins-diarios/pesquisa-por-pregao/pesquisa-por-pregao/",
    curva: true, historico: false, vencimento: "fim"
  },
  {
    id: "bcb", ativa: true, cidade: "Brasil", bolsa: "Banco Central", nome: "Brasil · Banco Central",
    titulo: "Banco Central do Brasil — ouro no boletim de fechamento da PTAX",
    mic: null, atraso: "fechamento do último dia útil",
    fonte: "Banco Central do Brasil", url: "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes",
    curva: false, historico: false, vencimento: null
  },
  {
    id: "spot", ativa: true, cidade: "Internacional", bolsa: "Spot", nome: "Spot internacional",
    titulo: "Preço à vista indicativo (não é referência de bolsa)",
    mic: null, atraso: "minutos",
    fonte: "gold-api.com", url: "https://gold-api.com/",
    curva: false, historico: false, vencimento: null
  },
  {
    id: "bm", ativa: true, cidade: "Mundo", bolsa: "Banco Mundial", nome: "Média mensal · Banco Mundial",
    titulo: "Banco Mundial — Commodity Price Data (Pink Sheet), médias mensais",
    mic: null, atraso: "mensal",
    fonte: "Banco Mundial", url: "https://www.worldbank.org/en/research/commodity-markets",
    curva: false, historico: true, vencimento: null
  }
];

// Ciclos de vencimento de maior liquidez na CME (meses de entrega). null = todos os meses.
const CICLO_OURO = [2, 4, 6, 8, 12];
const CICLO_PRATA_COBRE = [3, 5, 7, 9, 12];
const CICLO_PLATINA = [1, 4, 7, 10];
const CICLO_PALADIO = [3, 6, 9, 12];

export const GRUPOS = [
  { id: "basicos", nome: "Metais básicos" },
  { id: "preciosos", nome: "Metais preciosos" },
  { id: "ferrosos", nome: "Ferrosos" }
];

/**
 * `comparacao` = moeda e unidade em que as praças do metal são postas lado a lado quando a pessoa deixa
 * moeda e unidade em "original". `sap` = sugestões para a planilha de apoio (editáveis na tela).
 */
export const METAIS = [
  {
    id: "cobre", nome: "Cobre", simbolo: "Cu", grupo: "basicos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      lme: { campo: "Cu", moeda: "USD", unidade: "t", descricao: "Cobre grau A" },
      comex: { raiz: "HG", sufixo: "CMX", moeda: "USD", unidade: "lb", ciclo: CICLO_PRATA_COBRE, descricao: "Cobre — 25.000 lb" },
      shfe: { produto: "cu_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Cátodo de cobre" },
      ine: { produto: "bc_f", moeda: "CNY", unidade: "t", iva: false, descricao: "Cobre internacional (BC)" },
      spot: { simbolo: "HG", moeda: "USD", unidade: "lb" },
      bm: { coluna: "Copper", moeda: "USD", unidade: "t" }
    }
  },
  {
    id: "aluminio", nome: "Alumínio", simbolo: "Al", grupo: "basicos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      lme: { campo: "Al", moeda: "USD", unidade: "t", descricao: "Alumínio primário" },
      comex: { raiz: "ALI", sufixo: "CMX", moeda: "USD", unidade: "t", ciclo: null, descricao: "Alumínio — 25 t" },
      shfe: { produto: "al_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Alumínio" },
      bm: { coluna: "Aluminum", moeda: "USD", unidade: "t" }
    }
  },
  {
    id: "zinco", nome: "Zinco", simbolo: "Zn", grupo: "basicos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      lme: { campo: "Zn", moeda: "USD", unidade: "t", descricao: "Zinco SHG" },
      shfe: { produto: "zn_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Zinco" },
      bm: { coluna: "Zinc", moeda: "USD", unidade: "t" }
    }
  },
  {
    id: "niquel", nome: "Níquel", simbolo: "Ni", grupo: "basicos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      lme: { campo: "Ni", moeda: "USD", unidade: "t", descricao: "Níquel primário" },
      shfe: { produto: "ni_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Níquel" },
      bm: { coluna: "Nickel", moeda: "USD", unidade: "t" }
    }
  },
  {
    id: "chumbo", nome: "Chumbo", simbolo: "Pb", grupo: "basicos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      lme: { campo: "Pb", moeda: "USD", unidade: "t", descricao: "Chumbo" },
      shfe: { produto: "pb_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Chumbo" },
      bm: { coluna: "Lead", moeda: "USD", unidade: "t" }
    }
  },
  {
    id: "estanho", nome: "Estanho", simbolo: "Sn", grupo: "basicos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      lme: { campo: "Sn", moeda: "USD", unidade: "t", descricao: "Estanho" },
      shfe: { produto: "sn_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Estanho" },
      bm: { coluna: "Tin", moeda: "USD", unidade: "t" }
    }
  },
  {
    id: "ouro", nome: "Ouro", simbolo: "Au", grupo: "preciosos", comparacao: { moeda: "USD", unidade: "oz" },
    instrumentos: {
      comex: { raiz: "GC", sufixo: "CMX", moeda: "USD", unidade: "oz", ciclo: CICLO_OURO, descricao: "Ouro — 100 onças troy" },
      shfe: { produto: "au_f", moeda: "CNY", unidade: "g", iva: false, descricao: "Ouro" },
      b3: { prefixo: "GLD", moeda: "USD", unidade: "oz", descricao: "Futuro de Ouro (GLD)" },
      bcb: { codigo: "XAU", moeda: "BRL", unidade: "g", descricao: "Ouro — fechamento PTAX" },
      spot: { simbolo: "XAU", moeda: "USD", unidade: "oz" },
      bm: { coluna: "Gold", moeda: "USD", unidade: "oz" }
    }
  },
  {
    id: "prata", nome: "Prata", simbolo: "Ag", grupo: "preciosos", comparacao: { moeda: "USD", unidade: "oz" },
    instrumentos: {
      comex: { raiz: "SI", sufixo: "CMX", moeda: "USD", unidade: "oz", ciclo: CICLO_PRATA_COBRE, descricao: "Prata — 5.000 onças troy" },
      shfe: { produto: "ag_f", moeda: "CNY", unidade: "kg", iva: true, descricao: "Prata" },
      spot: { simbolo: "XAG", moeda: "USD", unidade: "oz" },
      bm: { coluna: "Silver", moeda: "USD", unidade: "oz" }
    }
  },
  {
    id: "platina", nome: "Platina", simbolo: "Pt", grupo: "preciosos", comparacao: { moeda: "USD", unidade: "oz" },
    instrumentos: {
      comex: { raiz: "PL", sufixo: "NYM", mic: "XNYM", moeda: "USD", unidade: "oz", ciclo: CICLO_PLATINA, descricao: "Platina — 50 onças troy (NYMEX)" },
      spot: { simbolo: "XPT", moeda: "USD", unidade: "oz" },
      bm: { coluna: "Platinum", moeda: "USD", unidade: "oz" }
    }
  },
  {
    id: "paladio", nome: "Paládio", simbolo: "Pd", grupo: "preciosos", comparacao: { moeda: "USD", unidade: "oz" },
    instrumentos: {
      comex: { raiz: "PA", sufixo: "NYM", mic: "XNYM", moeda: "USD", unidade: "oz", ciclo: CICLO_PALADIO, descricao: "Paládio — 100 onças troy (NYMEX)" },
      spot: { simbolo: "XPD", moeda: "USD", unidade: "oz" }
    }
  },
  {
    id: "minerio", nome: "Minério de ferro", simbolo: "Fe", grupo: "ferrosos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      comex: { raiz: "TIO", sufixo: "CMX", moeda: "USD", unidade: "t", ciclo: null, continuo: true, descricao: "Minério 62% Fe CFR China (TSI) — 1º vencimento" },
      bm: { coluna: "Iron ore, cfr spot", moeda: "USD", unidade: "t", descricao: "Minério 62% Fe CFR China, por tonelada seca" }
    }
  },
  {
    id: "aco", nome: "Aço · bobina a quente", curto: "Aço BQ", simbolo: "HRC", grupo: "ferrosos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      comex: { raiz: "HRC", sufixo: "CMX", moeda: "USD", unidade: "st", ciclo: null, descricao: "Bobina a quente Meio-Oeste dos EUA — 20 t curtas" },
      shfe: { produto: "hc_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Bobina laminada a quente" }
    }
  },
  {
    id: "vergalhao", nome: "Aço · vergalhão", curto: "Vergalhão", simbolo: "RB", grupo: "ferrosos", comparacao: { moeda: "USD", unidade: "t" },
    instrumentos: {
      shfe: { produto: "rb_f", moeda: "CNY", unidade: "t", iva: true, descricao: "Vergalhão" }
    }
  }
];

const PRACA_POR_ID = new Map(PRACAS.map((p) => [p.id, p]));
const METAL_POR_ID = new Map(METAIS.map((m) => [m.id, m]));

export function pracaDe(id) {
  return PRACA_POR_ID.get(String(id ?? "")) || null;
}

export function metalDe(id) {
  return METAL_POR_ID.get(String(id ?? "").toLowerCase()) || null;
}

export function pracaAtiva(id) {
  const p = pracaDe(id);
  return !!p && p.ativa;
}

export function pracasAtivas() {
  return PRACAS.filter((p) => p.ativa);
}

/** Instrumento do metal na praça (com o id da praça e o MIC resolvidos), ou null. */
export function instrumentoDe(metal, pracaId) {
  const m = typeof metal === "string" ? metalDe(metal) : metal;
  const p = pracaDe(pracaId);
  if (!m || !p || !p.ativa || !m.instrumentos[pracaId]) return null;
  const i = m.instrumentos[pracaId];
  return { ...i, praca: pracaId, metal: m.id, iva: !!i.iva, mic: i.mic || p.mic };
}

/** Metais que têm instrumento na praça, na ordem do catálogo. */
export function metaisDaPraca(pracaId) {
  return METAIS.filter((m) => instrumentoDe(m, pracaId));
}

/** Praças ativas em que o metal tem instrumento, na ordem do catálogo de praças. */
export function pracasDoMetal(metal) {
  const m = typeof metal === "string" ? metalDe(metal) : metal;
  return m ? PRACAS.filter((p) => instrumentoDe(m, p.id)) : [];
}

/** Nome curto do metal para chips e colunas. */
export function nomeCurto(metal) {
  return metal.curto || metal.nome;
}
