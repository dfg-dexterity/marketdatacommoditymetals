/*
 * Exportações: texto do CSV e linhas da planilha de apoio para o SAP. Funções puras (a página só cuida
 * do download), usadas pela página e pelos testes.
 *
 * PLANILHA DE APOIO SAP (DCS) — não é modelo oficial de carga. O aplicativo Importar Dados de Mercado
 * (Fiori F2610) não tem categoria de commodity; no S/4HANA o preço de commodity é mantido por
 * especificação de contrato derivativo (DCS) na transação FDCS17 ou pela planilha da TBEXN. As colunas
 * abaixo são os campos-chave documentados do preço por DCS (DCS ID, MIC, tipo de preço, data do preço,
 * data-chave de vencimento, preço, moeda e unidade), para digitar ou colar lá.
 */
import { compacta, dataValida } from "./datas.js";

export const COLUNAS_SAP = [
  "DCS ID",
  "MIC",
  "Tipo de preço",
  "Data do preço",
  "Data-chave de vencimento",
  "Preço",
  "Moeda",
  "Unidade de medida"
];
export const LARGURAS_SAP = [18, 8, 14, 14, 24, 16, 8, 18];

/** Unidade de medida usual no SAP para cada unidade de cotação (sugestão: o cadastro do cliente manda). */
export const UNIDADE_SAP = { t: "TO", kg: "KG", g: "G", lb: "LB", oz: "OZ", st: "TON" };

export function unidadeSapSugerida(unidade) {
  return UNIDADE_SAP[unidade] || String(unidade ?? "").toUpperCase();
}

/**
 * Valida os campos digitados no diálogo. Devolve { ok, erro, valores } — `valores` já em caixa alta e
 * sem espaços nas pontas. Só o MIC tem formato fixo (4 caracteres, ISO 10383); nos demais vale o que
 * está cadastrado no SAP de cada empresa, então a checagem é só de preenchimento e de caracteres.
 */
export function validarCamposSap({ dcs, mic, tipo, moeda, unidade }) {
  const v = {
    dcs: String(dcs ?? "").trim().toUpperCase(),
    mic: String(mic ?? "").trim().toUpperCase(),
    tipo: String(tipo ?? "").trim().toUpperCase(),
    moeda: String(moeda ?? "").trim().toUpperCase(),
    unidade: String(unidade ?? "").trim().toUpperCase()
  };
  if (!/^[A-Z0-9_\-]{1,20}$/.test(v.dcs)) return { ok: false, erro: "Informe o DCS ID cadastrado no SAP (letras, números, hífen ou sublinhado).", valores: v };
  if (!/^[A-Z0-9]{4}$/.test(v.mic)) return { ok: false, erro: "O MIC tem 4 letras ou números (ISO 10383), por exemplo XLME.", valores: v };
  if (!/^[A-Z0-9_\-]{1,10}$/.test(v.tipo)) return { ok: false, erro: "Informe o tipo de preço cadastrado no SAP (até 10 letras ou números).", valores: v };
  if (!/^[A-Z0-9]{3,5}$/.test(v.moeda)) return { ok: false, erro: "Informe a moeda como está no SAP (USD, CNY, BRL).", valores: v };
  if (!/^[A-Z0-9]{1,3}$/.test(v.unidade)) return { ok: false, erro: "A unidade de medida do SAP tem até 3 caracteres (TO, LB, OZ, G, KG).", valores: v };
  return { ok: true, erro: null, valores: v };
}

/**
 * Linhas da planilha a partir de cotações { dataPreco, dataVencimento, preco }: datas como texto
 * AAAAMMDD, preço numérico. Cotação sem data ou sem preço fica de fora. `dataVencimento` vazia = preço
 * à vista ou série histórica do 1º vencimento.
 */
export function linhasSap(cotacoes, campos) {
  const linhas = [];
  for (const c of cotacoes || []) {
    if (!c || !dataValida(c.dataPreco) || !Number.isFinite(c.preco)) continue;
    linhas.push([
      campos.dcs,
      campos.mic,
      campos.tipo,
      compacta(c.dataPreco),
      dataValida(c.dataVencimento) ? compacta(c.dataVencimento) : "",
      c.preco,
      campos.moeda,
      campos.unidade
    ]);
  }
  return linhas;
}

/** Chaves repetidas (DCS + MIC + tipo + data do preço + vencimento): o SAP recusaria a segunda. */
export function chavesRepetidasSap(linhas) {
  const vistas = new Set(), repetidas = new Set();
  for (const l of linhas) {
    const chave = l.slice(0, 5).join("|");
    if (vistas.has(chave)) repetidas.add(chave);
    vistas.add(chave);
  }
  return [...repetidas];
}

function celulaCsv(v) {
  if (v === null || v === undefined) return "";
  // Número com vírgula decimal e sem separador de milhar: o Excel em português abre certo
  const texto = typeof v === "number" ? (Number.isFinite(v) ? String(v).replace(".", ",") : "") : String(v);
  return /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * Texto de um CSV para o Excel brasileiro: separador ";", decimal com vírgula, quebra CRLF e marca de
 * ordem de bytes (BOM) no início, para os acentos abrirem certo.
 */
export function textoCsv(cabecalho, linhas) {
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(";")).join("\r\n") + "\r\n";
}

/** Nome de arquivo sem acentos nem espaços: "Aço · bobina" → "aco-bobina". */
export function nomeDeArquivo(texto) {
  return String(texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
