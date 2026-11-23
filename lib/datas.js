/*
 * Datas da Cotação de Metais. Funções puras, usadas pelas funções de /api, pela página e pelos testes.
 * Dia sempre em texto "AAAA-MM-DD" e mês em "AAAA-MM" — comparam e ordenam como texto.
 */

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Código de mês dos contratos futuros (F = janeiro … Z = dezembro), usado na CME e na B3. */
export const CODIGOS_MES = "FGHJKMNQUVXZ";

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_MES = /^(\d{4})-(\d{2})$/;
const DIA_MS = 86400000;

function utc(iso) {
  const m = RE_DIA.exec(String(iso ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // 2026-02-30 vira 02/03: só vale se o dia sobreviver à ida e volta
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}

const doisDigitos = (n) => String(n).padStart(2, "0");

/** "AAAA-MM-DD" de um Date, lido em UTC. */
export function paraISO(data) {
  return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`;
}

export function dataValida(iso) {
  return utc(iso) !== null;
}

export function mesValido(mes) {
  const m = RE_MES.exec(String(mes ?? ""));
  return !!m && +m[2] >= 1 && +m[2] <= 12;
}

/** Soma dias corridos (n pode ser negativo). Devolve null se a data for inválida. */
export function somarDias(iso, n) {
  const d = utc(iso);
  return d ? paraISO(new Date(d.getTime() + n * DIA_MS)) : null;
}

/** Dias corridos de `a` até `b` (positivo quando b é depois). */
export function diasEntre(a, b) {
  const da = utc(a), db = utc(b);
  return da && db ? Math.round((db - da) / DIA_MS) : null;
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso) {
  const d = utc(iso);
  return d ? d.getUTCDay() : null;
}

/** "2026-11-20" → "20261120". */
export function compacta(iso) {
  return String(iso ?? "").replace(/-/g, "");
}

/** "20261120" → "2026-11-20" (null se não for uma data real). */
export function deCompacta(texto) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(texto ?? "").trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return dataValida(iso) ? iso : null;
}

/** "2026-11-20" → "20/11/2026". */
export function fmtData(iso) {
  const m = RE_DIA.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** "2026-12" → "dez/2026" (ou "dez/26" com curto = true). */
export function rotuloMes(mes, curto = false) {
  const m = RE_MES.exec(String(mes ?? ""));
  if (!m || !MESES_CURTOS[+m[2] - 1]) return "—";
  return `${MESES_CURTOS[+m[2] - 1]}/${curto ? m[1].slice(2) : m[1]}`;
}

export function mesDe(iso) {
  return String(iso ?? "").slice(0, 7);
}

/** Soma meses a "AAAA-MM". */
export function somarMeses(mes, n) {
  const m = RE_MES.exec(String(mes ?? ""));
  if (!m) return null;
  const total = +m[1] * 12 + (+m[2] - 1) + n;
  return `${Math.floor(total / 12)}-${doisDigitos((total % 12 + 12) % 12 + 1)}`;
}

/** Meses de `a` até `b` (positivo quando b é depois). */
export function mesesEntre(a, b) {
  const ma = RE_MES.exec(String(a ?? "")), mb = RE_MES.exec(String(b ?? ""));
  if (!ma || !mb) return null;
  return (+mb[1] * 12 + +mb[2]) - (+ma[1] * 12 + +ma[2]);
}

export function ultimoDiaDoMes(mes) {
  const m = RE_MES.exec(String(mes ?? ""));
  if (!m) return null;
  return paraISO(new Date(Date.UTC(+m[1], +m[2], 0)));
}

/** Soma meses a um dia, parando no último dia do mês quando ele não existe (31/01 + 1 mês = 28/02). */
export function somarMesesAoDia(iso, n) {
  const m = RE_DIA.exec(String(iso ?? ""));
  if (!m) return null;
  const mes = somarMeses(`${m[1]}-${m[2]}`, n);
  const ultimo = ultimoDiaDoMes(mes);
  const dia = Math.min(+m[3], +ultimo.slice(8));
  return `${mes}-${doisDigitos(dia)}`;
}

/** Dia de calendário num fuso ("America/New_York", "Asia/Shanghai", "America/Sao_Paulo"). */
export function hojeEm(fuso, agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora do relógio (0–23) num fuso. */
export function horaEm(fuso, agora = new Date()) {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", hourCycle: "h23" }).format(agora);
  return Number(h) % 24;
}

/**
 * Os `n` dias de semana (segunda a sexta) terminando em `iso`, do mais novo para o mais antigo.
 * Feriado é com a fonte: cada leitor trata o dia sem arquivo.
 */
export function diasDeSemanaAte(iso, n) {
  const dias = [];
  let d = iso;
  while (d && dias.length < n) {
    const s = diaDaSemana(d);
    if (s === null) break;
    if (s !== 0 && s !== 6) dias.push(d);
    d = somarDias(d, -1);
  }
  return dias;
}

/** Soma `n` dias de semana (segunda a sexta) a um dia; n ≥ 0. Feriados não entram na conta. */
export function somarDiasDeSemana(iso, n) {
  let d = iso;
  let faltam = n;
  while (d && faltam > 0) {
    d = somarDias(d, 1);
    const s = diaDaSemana(d);
    if (s !== 0 && s !== 6) faltam--;
  }
  return d;
}

/**
 * Leva um dia que cai em sábado ou domingo para um dia de semana (feriados não entram na conta):
 *   "seguinte"   — a segunda-feira seguinte;
 *   "anterior"   — a sexta-feira anterior;
 *   "modificado" — o seguinte, a não ser que ele mude de mês: aí, o anterior (convenção das datas
 *                  prompt da LME e dos contratos a termo).
 */
export function ajustarParaDiaDeSemana(iso, modo = "seguinte") {
  const s = diaDaSemana(iso);
  if (s === null || (s !== 0 && s !== 6)) return iso;
  const depois = somarDias(iso, s === 6 ? 2 : 1);
  const antes = somarDias(iso, s === 6 ? -1 : -2);
  if (modo === "anterior") return antes;
  if (modo === "modificado") return depois.slice(0, 7) === iso.slice(0, 7) ? depois : antes;
  return depois;
}

/** "Z26" → "2026-12" (código de mês + ano de 2 dígitos); null se não for um código de contrato. */
export function vencimentoDoCodigo(codigo) {
  const m = /^([FGHJKMNQUVXZ])(\d{2})$/.exec(String(codigo ?? "").toUpperCase());
  if (!m) return null;
  return `20${m[2]}-${doisDigitos(CODIGOS_MES.indexOf(m[1]) + 1)}`;
}

/** "2026-12" → "Z26". */
export function codigoDoVencimento(mes) {
  const m = RE_MES.exec(String(mes ?? ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return `${CODIGOS_MES[+m[2] - 1]}${m[1].slice(2)}`;
}
