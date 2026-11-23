/*
 * Relógio das funções de /api. Em produção é o relógio de verdade; os testes fixam um instante para
 * que "hoje", "mês corrente" e "pregão em curso" não mudem com o dia em que o teste roda.
 */
let fonte = () => new Date();

/** Instante atual (ou o fixado pelos testes). */
export function agora() {
  return fonte();
}

/** Fixa o relógio num instante ("2026-11-23T09:00:00Z"); sem argumento, volta ao relógio de verdade. */
export function fixarRelogio(instante) {
  fonte = instante ? () => new Date(instante) : () => new Date();
}
