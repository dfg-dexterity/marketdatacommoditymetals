/*
 * B3 — Futuro de Ouro (GLD) pelo boletim público de pregão (arquivo SPRD, BVBG.187 "Preços de
 * referência"). Funções puras sobre os bytes já baixados, usadas por api/b3.js.
 *
 *   https://www.b3.com.br/pesquisapregao/download?filelist=SPRDAAMMDD.zip,
 *
 * O download é um ZIP que contém outro ZIP com um ou mais XML (a B3 regrava o arquivo ao longo da
 * noite: vale o último por nome). Dia sem pregão devolve HTTP 200 com um ZIP vazio de 22 bytes.
 * Cada <PricRpt> traz um instrumento: TckrSymb (GLDZ26), TradDt/Dt, AdjstdQt (ajuste, com a moeda no
 * atributo Ccy), PrvsAdjstdQt (ajuste anterior), LastPric, OpnIntrst (contratos em aberto) e
 * RglrTxsQty (negócios).
 */
import { entradasZip, pareceZip } from "./zip.js";
import { compacta, vencimentoDoCodigo, dataValida } from "./datas.js";

export const HOST_B3 = "https://www.b3.com.br";

/** "2026-11-19" → "SPRD261119.zip". */
export function arquivoSprd(dia) {
  return `SPRD${compacta(dia).slice(2)}.zip`;
}

export function urlSprd(dia) {
  return `${HOST_B3}/pesquisapregao/download?filelist=${arquivoSprd(dia)},`;
}

/**
 * Extrai o XML mais recente do download. Devolve null quando o ZIP vem vazio (dia sem pregão ou
 * arquivo ainda não publicado). Lança erro se os bytes não forem um ZIP.
 */
export function xmlDoSprd(bytes) {
  if (!pareceZip(bytes)) throw new Error("a B3 respondeu algo que não é o arquivo de pregão (ZIP)");
  let entradas = entradasZip(bytes);
  if (!entradas.length) return null;
  const interno = entradas.filter((e) => /\.zip$/i.test(e.nome)).sort((a, b) => (a.nome < b.nome ? -1 : 1)).pop();
  if (interno) entradas = entradasZip(interno.dados());
  const xmls = entradas.filter((e) => /\.xml$/i.test(e.nome)).sort((a, b) => (a.nome < b.nome ? -1 : 1));
  if (!xmls.length) return null;
  return xmls[xmls.length - 1].dados().toString("utf8");
}

function tag(trecho, nome) {
  const m = new RegExp(`<${nome}(?:\\s[^>]*)?>([^<]*)</${nome}>`).exec(trecho);
  return m ? m[1].trim() : null;
}

function numero(texto) {
  if (texto === null || texto === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/**
 * Contratos futuros de um prefixo ("GLD") no XML: ticker de 6 caracteres = prefixo + código do mês +
 * ano (GLDZ26). Devolve, em ordem de vencimento,
 *   [{ contrato: "Z26", ticker, vencimento: "2026-12", data, preco (ajuste), anterior, ultimo,
 *      emAberto, negocios, moeda }]
 * Opções e outros instrumentos com o mesmo prefixo ficam de fora pelo formato do ticker.
 */
export function lerContratosB3(xml, prefixo) {
  const texto = String(xml ?? "");
  const marca = `<TckrSymb>${prefixo}`;
  const contratos = [];
  let pos = 0;
  for (;;) {
    const i = texto.indexOf(marca, pos);
    if (i < 0) break;
    pos = i + marca.length;
    const ini = texto.lastIndexOf("<PricRpt>", i);
    const fim = texto.indexOf("</PricRpt>", i);
    if (ini < 0 || fim < 0) continue;
    const trecho = texto.slice(ini, fim);
    const ticker = tag(trecho, "TckrSymb");
    const m = new RegExp(`^${prefixo}([FGHJKMNQUVXZ]\\d{2})$`).exec(ticker || "");
    if (!m) continue;
    const data = tag(trecho, "Dt");
    const preco = numero(tag(trecho, "AdjstdQt"));
    if (!dataValida(data) || preco === null) continue;
    const moeda = /<AdjstdQt\s+Ccy="([A-Z]{3})"/.exec(trecho);
    contratos.push({
      contrato: m[1],
      ticker,
      vencimento: vencimentoDoCodigo(m[1]),
      data,
      preco,
      anterior: numero(tag(trecho, "PrvsAdjstdQt")),
      ultimo: numero(tag(trecho, "LastPric")),
      emAberto: numero(tag(trecho, "OpnIntrst")),
      negocios: numero(tag(trecho, "RglrTxsQty")),
      moeda: moeda ? moeda[1] : null
    });
  }
  return contratos.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
}
