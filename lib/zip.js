/*
 * Leitura de arquivo ZIP sem dependências (node:zlib), para o boletim de pregão da B3 (ZIP dentro de ZIP)
 * e para a planilha XLSX do Banco Mundial. Só roda no servidor (funções de /api e testes).
 *
 * Lê pelo diretório central, que traz o tamanho real de cada entrada mesmo quando o cabeçalho local
 * vem zerado (ZIP gravado em fluxo). Aceita os métodos 0 (sem compressão) e 8 (deflate).
 */
import { inflateRawSync } from "node:zlib";

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/**
 * Teto do que uma entrada pode virar depois de descomprimida. O maior arquivo legítimo é o XML do
 * boletim da B3 (uns 5 MB); sem teto, um ZIP de 400 KB malformado poderia pedir 400 MB de memória.
 */
export const LIMITE_DESCOMPRIMIDO = 64 * 1024 * 1024;

/** true se os bytes começam como um ZIP ("PK"). */
export function pareceZip(bytes) {
  return !!bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Entradas do ZIP: [{ nome, tamanho, dados() }]. `dados()` devolve um Buffer já descomprimido.
 * ZIP vazio (só o registro de fim, 22 bytes) devolve []. Lança erro se os bytes não forem um ZIP.
 */
export function entradasZip(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let fim = -1;
  // O registro de fim fica nos últimos 22 bytes + comentário (até 65.535)
  for (let i = b.length - 22; i >= 0 && i >= b.length - 65557; i--) {
    if (b.readUInt32LE(i) === ASSINATURA_FIM) { fim = i; break; }
  }
  if (fim < 0) throw new Error("o arquivo não é um ZIP");

  const total = b.readUInt16LE(fim + 10);
  let p = b.readUInt32LE(fim + 16);
  const entradas = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== ASSINATURA_CENTRAL) throw new Error("ZIP com diretório central corrompido");
    const metodo = b.readUInt16LE(p + 10);
    const comprimido = b.readUInt32LE(p + 20);
    const tamanho = b.readUInt32LE(p + 24);
    const tamNome = b.readUInt16LE(p + 28);
    const tamExtra = b.readUInt16LE(p + 30);
    const tamComentario = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nome = b.toString("utf8", p + 46, p + 46 + tamNome);
    entradas.push({
      nome,
      tamanho,
      dados() {
        if (local + 30 > b.length || b.readUInt32LE(local) !== ASSINATURA_LOCAL) throw new Error(`ZIP com entrada corrompida (${nome})`);
        const inicio = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
        const cru = b.subarray(inicio, inicio + comprimido);
        if (metodo === 0) return cru;
        if (metodo === 8) {
          try {
            return inflateRawSync(cru, { maxOutputLength: LIMITE_DESCOMPRIMIDO });
          } catch (e) {
            throw new Error(e && e.code === "ERR_BUFFER_TOO_LARGE" ? `ZIP com entrada grande demais (${nome})` : `ZIP com entrada corrompida (${nome})`);
          }
        }
        throw new Error(`ZIP com compressão não suportada (método ${metodo}) em ${nome}`);
      }
    });
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}
