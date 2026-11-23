#!/usr/bin/env node
// KIT COMUM das ferramentas MTM da Dexterity: arquivo IDÊNTICO em new-mtm-ndf, new-mtm-swap,
// new-mtm-opcoes e new-mtm-curvas. Não altere aqui sem replicar nos quatro (README › Kit comum).
/**
 * Gera os blocos de Código Incorporado do site (Odoo):
 *
 *   node site/build.mjs                          (ou npm run site)
 *   node site/build.mjs --casca <página.html>    atualiza site/casca-site.html a partir de uma página
 *                                                publicada do site (ex.: site/capturas/ferramentas.html)
 *
 * Saída — cada arquivo é a página INTEIRA, já dentro da casca do site (faixa de cotações, menu, cabeçalho
 * da página, chamada "Vamos olhar sua tesouraria?" e rodapé), como as demais páginas de
 * www.dexterityit.com.br:
 *   site/odoo-pagina-<slug>.html       a página da ferramenta, um por site/paginas/*.json
 *   site/odoo-pagina-ferramentas.html  a vitrine /ferramentas, com as quatro ferramentas MTM
 *   site/odoo-rodape-ferramentas.html  a coluna "Ferramentas" do rodapé, para as demais páginas do site
 * O repositório é a fonte da verdade (MK-02-004): alterar o JSON, a casca ou este modelo, gerar e colar de
 * novo no Odoo — nunca editar o HTML direto no site.
 *
 * A casca (site/casca-site.html) é cópia do bloco publicado da vitrine /ferramentas, sem o miolo: fontes,
 * CSS .dxt, faixa de cotações, menu, chamada e rodapé. Quando o site mudar a casca, capturar a página de
 * novo (new-mtm-ndf › Actions › Capturar páginas do site), rodar `--casca` e replicar o arquivo nos quatro.
 * A coluna "Ferramentas" do rodapé é sempre a de RODAPE, nunca a da captura.
 *
 * Cada página embute a ferramenta inteira em iframe (`${app}/?embed=1`, com `app` vindo do JSON). A
 * ferramenta conversa com a página por postMessage — { origem:'calculadora-mtm', tipo:'altura'|'rolar'|'aviso' }:
 * altura do conteúdo (sem barra de rolagem interna), rolagem até um ponto (o resultado de um cálculo) e
 * avisos (toast). O script do bloco só aceita mensagens da própria moldura e da origem tirada de
 * new URL(iframe.src).origin — trocar o domínio da Vercel é só trocar o "app" no JSON — e responde
 * { origem:'site-dexterity', tipo:'pronto' } para a ferramenta saber que a página mostra os avisos.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const SITE = 'https://www.dexterityit.com.br'
const CASCA = join(DIR, 'casca-site.html')
const MARCA = '<!-- @conteudo -->'

/**
 * Ferramentas do site: cartões da vitrine, "Outras ferramentas" e coluna do rodapé. Os textos das que não
 * são deste kit vêm da vitrine publicada (site/capturas/ferramentas.html). As quatro MTM têm de bater com o
 * site/paginas/<slug>.json do respectivo repositório — o build confere o deste —, para a vitrine sair
 * idêntica nos quatro. `curto`: nome no rodapé, quando o nome inteiro é longo.
 */
const CATALOGO = {
  'calculadora-mtm-ndf': {
    categoria: 'MTM · Derivativos',
    nome: 'Calculadora MTM NDF',
    descricao: 'Marcação a mercado de NDF de dólar, euro e iene com a curva da B3 e a PTAX, para conferir o número do banco.',
    etiquetas: ['Manual de Curvas B3', 'CPC 48 · JBNPV'],
  },
  'calculadora-mtm-swap': {
    categoria: 'MTM · Derivativos',
    nome: 'Calculadora MTM Swap',
    descricao: 'MtM de swap pré, CDI, IPCA e dólar fluxo a fluxo com as curvas da B3, com cronograma no padrão SND.',
    etiquetas: ['Padrão SND', 'CPC 48 · JBNPV'],
  },
  'calculadora-mtm-opcoes': {
    categoria: 'MTM · Derivativos',
    nome: 'Calculadora MTM Opções de Moeda',
    curto: 'Calculadora MTM Opções',
    descricao: 'Prêmio e MtM de call e put de moeda por Black-76 sobre o forward da B3, com as gregas e a contabilização.',
    etiquetas: ['Black-76 · gregas', 'CPC 48 · JBNPV'],
  },
  'taxas-referenciais': {
    categoria: 'Curvas · B3',
    nome: 'Taxas Referenciais da B3',
    descricao: 'Curvas DI x pré, IPCA, cupom cambial e moedas da B3 na data, com a taxa de qualquer prazo pelo Manual de Curvas.',
    etiquetas: ['Manual de Curvas B3', 'Base 252'],
  },
  'vale-a-pena': {
    categoria: 'Decisão',
    nome: 'Vale a pena?',
    descricao: 'Parcelar ou pagar à vista, alugar ou comprar, PJ ou CLT — onze contas de decisão com taxas do Banco Central ao vivo.',
    etiquetas: ['Selic e CDI ao vivo', 'Onze calculadoras'],
  },
  'calculadora-cdb': {
    categoria: 'Renda fixa',
    nome: 'Calculadora CDB',
    descricao: 'Rendimento de CDB em percentual do CDI, com IR e IOF na tabela vigente.',
    etiquetas: ['Convenção BCB e B3', 'IR regressivo'],
  },
  'conversor-de-taxas': {
    categoria: 'Renda fixa',
    nome: 'Conversor de Taxas',
    descricao: 'Taxas equivalentes entre as bases 252, 360 e 365, efetiva e nominal, e % do CDI em CDI + spread, com o CDI do dia do Banco Central.',
    etiquetas: ['Bases 252, 360 e 365', '% do CDI ↔ CDI + spread'],
  },
  'titulos-publicos': {
    categoria: 'Renda fixa',
    nome: 'Cotação de Títulos Públicos',
    curto: 'Títulos Públicos',
    descricao: 'Taxas e preços de todos os títulos do Tesouro Direto no pregão, com a variação do dia e o histórico de cada título.',
    etiquetas: ['Tesouro Transparente', 'Excel · CSV'],
  },
  'derivativos-listados-b3': {
    categoria: 'Derivativos',
    nome: 'Derivativos Listados B3',
    descricao: 'Contratos listados na B3 com os dados de referência de cada série.',
    etiquetas: ['Futuros e opções'],
  },
  'cotacao-de-moedas': {
    categoria: 'Câmbio',
    nome: 'Cotação de Moedas',
    descricao: 'Cotações e paridades de moedas para fechamento e conferência.',
    etiquetas: ['PTAX', 'Histórico'],
  },
  'moedas-bndes': {
    categoria: 'Câmbio',
    nome: 'Moedas BNDES',
    descricao: 'As 285 moedas contratuais do BNDES — UMBNDES, URTJLP, TJLP, TLP e mais — com histórico e carga para o SAP.',
    etiquetas: ['Fonte BNDES', 'Excel · CSV · SAP'],
  },
  ibge: {
    categoria: 'Índices',
    nome: 'Séries IBGE',
    descricao: 'IPCA, IPCA-15, INPC, SINAPI e PIB direto do IBGE, com correção de valores pelo número-índice e carga para o SAP.',
    etiquetas: ['Número-índice', 'Excel · CSV · SAP'],
  },
  'indicadores-economicos': {
    categoria: 'Índices',
    nome: 'Indicadores Econômicos',
    descricao: 'CDI, Selic, TJLP, TLP, IPCA, SOFR e mais 50 séries do Banco Central, do NY Fed e do BNDES, com histórico.',
    etiquetas: ['Série diária', 'Excel · CSV · SAP'],
  },
  'commodities-agricolas': {
    categoria: 'Commodities',
    nome: 'Cotação de Commodities Agrícolas',
    curto: 'Commodities Agrícolas',
    descricao: 'Boi gordo, milho, soja, café e etanol na B3: pregão, curva de vencimentos, base contra o físico e praças do CEPEA.',
    etiquetas: ['Fonte B3', 'Excel · CSV'],
  },
  'cotacao-de-metais': {
    categoria: 'Commodities',
    nome: 'Cotação de Metais',
    descricao: 'Cobre, alumínio, ouro e mais dez metais em Londres, Nova York, Xangai e São Paulo: preço por praça, curva de vencimentos e histórico.',
    etiquetas: ['LME · COMEX · SHFE · B3', 'Excel · CSV'],
  },
}

/** Vitrine /ferramentas: primeiro o grupo das quatro MTM, depois as demais. */
const VITRINE = [
  {
    titulo: 'Marcação a mercado',
    texto: 'NDF, swap e opções de moeda com as curvas da B3 na data: memória de cálculo, contabilização CPC 48 e a linha da JBNPV do SAP.',
    slugs: ['calculadora-mtm-ndf', 'calculadora-mtm-swap', 'calculadora-mtm-opcoes', 'taxas-referenciais'],
  },
  {
    titulo: 'Mercado e decisões',
    texto: 'Renda fixa, câmbio, índices e derivativos listados para o dia a dia da tesouraria — e as contas de decisão do Vale a pena?',
    slugs: ['vale-a-pena', 'calculadora-cdb', 'conversor-de-taxas', 'titulos-publicos', 'derivativos-listados-b3', 'cotacao-de-moedas', 'moedas-bndes', 'ibge', 'indicadores-economicos', 'commodities-agricolas', 'cotacao-de-metais'],
  },
]

/** Coluna "Ferramentas" do rodapé do site. */
const RODAPE = ['vale-a-pena', 'calculadora-mtm-ndf', 'calculadora-mtm-swap', 'calculadora-mtm-opcoes', 'taxas-referenciais', 'calculadora-cdb', 'conversor-de-taxas', 'titulos-publicos', 'derivativos-listados-b3', 'moedas-bndes', 'ibge', 'indicadores-economicos', 'commodities-agricolas', 'cotacao-de-metais']

const RE_RODAPE = /<div><h4>Ferramentas<\/h4><ul>[\s\S]*?<\/ul><\/div>/
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ld = (obj) => JSON.stringify(obj, null, 2).replace(/<\/script/gi, '<\\/script')

for (const s of [...VITRINE.flatMap((g) => g.slugs), ...RODAPE]) if (!CATALOGO[s]) throw new Error(`build.mjs: "${s}" está na vitrine ou no rodapé mas não no CATALOGO`)

// ------------------------------------------------------------------ casca do site

/** Separa a casca de um bloco publicado: tudo até o fim do menu e da chamada final até o fim. */
function extrairCasca(arquivo) {
  const html = readFileSync(arquivo, 'utf-8')
  // O Odoo guarda o código original de cada bloco Código Incorporado em <template class="s_embed_code_saved">.
  const blocos = [...html.matchAll(/<template[^>]*class="[^"]*s_embed_code_saved[^"]*"[^>]*>([\s\S]*?)<\/template>/g)].map((m) => m[1])
  const b = blocos.find((t) => t.includes('<nav class="dx-nav">') && t.includes('<footer>'))
  if (!b) throw new Error(`${arquivo}: nenhum bloco Código Incorporado com a casca do site (nav.dx-nav e footer)`)
  if (/<script|\son[a-z]+\s*=|@import/i.test(b)) throw new Error(`${arquivo}: a casca capturada tem script, atributo on* ou @import — conferir à mão antes de usar`)
  const fimNav = b.indexOf('</nav>') + '</nav>'.length
  const iniCta = b.indexOf('<section class="dx-section dx-cta">')
  if (fimNav < 6 || iniCta < fimNav) throw new Error(`${arquivo}: casca sem </nav> antes da chamada final (section.dx-cta)`)
  const antes = b
    .slice(0, fimNav)
    .replace(/<!--[\s\S]*?-->/g, '')
    // a vitrine publicada é gerada aqui: o estilo das páginas geradas (ESTILO) não é da casca
    .replace(/<style\b[^>]*\bdata-dx-gerado\b[^>]*>[\s\S]*?<\/style>\s*/gi, '')
    // estilo próprio da página capturada (entre <div class="dxt"> e a faixa de cotações) também não
    .replace(/(<div class="dxt">)([\s\S]*?)(<div class="dx-ticker-live")/, (m, a, meio, c) => a + meio.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '') + c)
    .trim()
  const casca = { antes, depois: b.slice(iniCta).replace(/<!--[\s\S]*?-->/g, '').trim() }
  validarCasca(casca, arquivo)
  return casca
}

/** Confere a casca (na extração e na leitura): estrutura, menu em Ferramentas, coluna do rodapé, um só <style>. */
function validarCasca({ antes, depois }, origem) {
  if (!antes.includes('<div class="dxt">') || !antes.includes('<nav class="dx-nav">')) throw new Error(`${origem}: sem <div class="dxt"> e menu antes do miolo`)
  if (!/href="\/ferramentas" class="dx-on"/.test(antes)) throw new Error(`${origem}: o menu deve marcar "Ferramentas" (class="dx-on") — capturar a vitrine /ferramentas`)
  if ((antes.match(/<style\b/gi) ?? []).length !== 1 || /data-dx-gerado|gerado por site\/build\.mjs/.test(antes + depois)) throw new Error(`${origem}: a casca deve ter só o <style> do site (sem o estilo das páginas geradas nem o de uma página)`)
  if (!RE_RODAPE.test(depois)) throw new Error(`${origem}: coluna "Ferramentas" do rodapé não encontrada`)
}

if (process.argv[2] === '--casca') {
  const arq = resolve(process.argv[3] ?? '')
  if (!process.argv[3] || !existsSync(arq)) throw new Error('uso: node site/build.mjs --casca <página publicada do site, ex.: site/capturas/ferramentas.html>')
  const { antes, depois } = extrairCasca(arq)
  const marcaTempo = join(dirname(arq), 'CAPTURADO_EM.txt')
  const quando = existsSync(marcaTempo) ? readFileSync(marcaTempo, 'utf-8').trim().slice(0, 10) : new Date().toISOString().slice(0, 10)
  writeFileSync(
    CASCA,
    `<!--
  KIT COMUM: casca das páginas de www.dexterityit.com.br (fontes, CSS .dxt, faixa de cotações, menu,
  chamada final e rodapé), tirada do bloco publicado em ${relative(dirname(DIR), arq)} (${quando}) por
  node site/build.mjs --casca. Não editar à mão: capturar de novo e regenerar. O miolo de cada página
  entra no lugar da marca abaixo; a coluna "Ferramentas" do rodapé é trocada pela de RODAPE (build.mjs).
-->
${antes}
${MARCA}
${depois}
`,
  )
  console.log(`gerado site/casca-site.html (de ${relative(process.cwd(), arq)})`)
  process.exit(0)
}

function rodapeFerramentas() {
  return `<div><h4>Ferramentas</h4><ul>${RODAPE.map((s) => `<li><a href="/${s}">${esc(CATALOGO[s].curto ?? CATALOGO[s].nome)}</a></li>`).join('')}</ul></div>`
}

function lerCasca() {
  const txt = readFileSync(CASCA, 'utf-8').replace(/^\s*<!--[\s\S]*?-->\s*/, '')
  const partes = txt.split(MARCA)
  if (partes.length !== 2) throw new Error(`site/casca-site.html: a marca ${MARCA} deve aparecer uma vez`)
  const [antes, depois] = partes.map((p) => p.trim())
  validarCasca({ antes, depois }, 'site/casca-site.html')
  return { antes, depois: depois.replace(RE_RODAPE, () => rodapeFerramentas()) }
}

const casca = lerCasca()

// ------------------------------------------------------------------ páginas

const paginas = readdirSync(join(DIR, 'paginas'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, 'paginas', f), 'utf-8')))
  .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99))

for (const p of paginas) {
  for (const k of ['slug', 'app', 'titulo', 'tituloSEO', 'metaDescricao', 'lead', 'categoria', 'descricaoCartao', 'etiquetas']) {
    if (!p[k]) throw new Error(`site/paginas/${p.slug ?? '?'}.json: falta o campo "${k}"`)
  }
  if (!/^https:\/\/[^/]+$/.test(p.app)) throw new Error(`site/paginas/${p.slug}.json: "app" deve ser a origem https da ferramenta, sem barra no fim (ex.: https://new-mtm-ndf.vercel.app)`)
  const c = CATALOGO[p.slug]
  const difere = !c || c.categoria !== p.categoria || c.nome !== p.titulo || c.descricao !== p.descricaoCartao || JSON.stringify(c.etiquetas) !== JSON.stringify(p.etiquetas)
  if (difere) throw new Error(`site/paginas/${p.slug}.json: categoria, título, descricaoCartao e etiquetas devem ser iguais à entrada "${p.slug}" do CATALOGO em site/build.mjs (kit comum) — a vitrine sai igual nos quatro repositórios`)
}

/** Estilo das páginas geradas: só o que a casca não tem, com classes dx- e escopado em .dxt. */
const ESTILO = `<style data-dx-gerado="site/build.mjs">
/* gerado por site/build.mjs — não é da casca: node site/build.mjs --casca tira este bloco da página capturada */
/* Faixa de cotações e menu ficam fixos no topo: o foco do teclado e os links internos param logo abaixo deles. */
html:has(.dxt){scroll-padding-top:128px}
/* Acima de 1120 px o botão Menu some; o checkbox que o abre sai junto da ordem de tabulação. */
@media (min-width:1121px){.dxt .dx-navchk{display:none}}
/* O Odoo centraliza o texto da seção que recebe o bloco: aqui tudo fica alinhado à esquerda, como no resto do site. */
.dxt,.dxt :is(h1,h2,h3,h4,p,li,summary,div,a,span,strong,address){text-align:left}
.dxt .dx-sec-head p a{color:var(--acc-txt);border-bottom:1px solid rgba(0,179,172,.45)}
.dxt .dx-vit-grupo{margin-top:clamp(64px,8vw,104px)}
.dxt .dx-section.dx-fer-app{padding:clamp(24px,3vw,40px) 0 clamp(56px,7vw,96px)}
.dxt .dx-frame{border:1px solid var(--line);background:var(--base)}
.dxt .dx-frame iframe{display:block;width:100%;min-height:560px;border:0;background:var(--base);transition:height .2s ease}
.dxt .dx-frame-note{margin-top:14px;font-size:13px;color:var(--muted)}
.dxt .dx-passos{list-style:none;margin:0;padding:0}
.dxt .dx-passos .dx-fase p{margin-top:10px}
.dxt .dx-fer-texto .dx-cols+.dx-cols{margin-top:clamp(48px,6vw,80px);padding-top:clamp(48px,6vw,80px);border-top:1px solid var(--line)}
.dxt .dx-faq{border-top:1px solid var(--line)}
.dxt .dx-faq details{border-bottom:1px solid var(--line)}
.dxt .dx-faq summary{display:flex;justify-content:space-between;gap:16px;padding:16px 0;cursor:pointer;list-style:none;font-size:17px;line-height:1.45;color:var(--off)}
.dxt .dx-faq summary::-webkit-details-marker{display:none}
.dxt .dx-faq summary::after{content:"+";flex:none;font-family:var(--mono);color:var(--acc-txt)}
.dxt .dx-faq details[open] summary::after{content:"\\2212"}
.dxt .dx-faq details p{margin:0 0 18px;font-size:16px;color:#B4AFA7}
.dxt .dx-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1050;max-width:min(560px,calc(100vw - 32px));padding:10px 14px;background:var(--surface);border:1px solid var(--cerceta);color:var(--off);font-size:14px;line-height:1.5}
.dxt .dx-toast.dx-erro{border-color:#D9563E}
.dxt .dx-toast[hidden]{display:none}
@media (prefers-reduced-motion:reduce){html:has(.dxt){scroll-behavior:auto}.dxt .dx-frame iframe{transition:none}}
</style>`

/** Script do bloco: altura automática, rolagem e avisos vindos da ferramenta (só da moldura e da origem dela). */
function script(slug) {
  return `<script>
(function () {
  var frame = document.getElementById('dx-frame-${slug}');
  var toast = document.getElementById('dx-toast-${slug}');
  if (!frame) return;
  var ORIGEM;
  try { ORIGEM = new URL(frame.src, location.href).origin; } catch (e) { return; }
  var timer, pronto = false;
  var reduzir = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Faixa de cotações e menu fixos no topo (e o cabeçalho do Odoo, se aparecer): a rolagem para logo abaixo deles.
  function topoLivre() {
    var alt = 0, els = document.querySelectorAll('.dx-ticker-live, .dxt .dx-nav, header, #top, .o_header_affixed, .o_header_fixed');
    for (var i = 0; i < els.length; i++) {
      var cs = window.getComputedStyle(els[i]);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      var r = els[i].getBoundingClientRect();
      if (!r.height || r.height >= window.innerHeight / 2) continue;
      var t = parseFloat(cs.top);
      if (isNaN(t)) t = r.top;
      if (t < window.innerHeight / 2) alt = Math.max(alt, t + r.height);
    }
    return alt + 16;
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGEM || e.source !== frame.contentWindow || !e.data || e.data.origem !== 'calculadora-mtm') return;
    var m = e.data;
    if (!pronto) {
      pronto = true;
      try { frame.contentWindow.postMessage({ origem: 'site-dexterity', tipo: 'pronto' }, ORIGEM); } catch (err) {}
    }
    if (m.tipo === 'altura' && m.altura > 0) {
      frame.style.height = Math.ceil(m.altura) + 'px';
    } else if (m.tipo === 'rolar') {
      var topo = topoLivre();
      var alvo = frame.getBoundingClientRect().top + (m.y || 0);
      if (alvo >= topo && alvo < window.innerHeight * 0.75) return; // já está à vista
      var y = Math.max(0, (window.pageYOffset || document.documentElement.scrollTop) + alvo - topo);
      try { window.scrollTo({ top: y, behavior: reduzir ? 'instant' : 'smooth' }); } catch (err) { window.scrollTo(0, y); }
    } else if (m.tipo === 'aviso' && m.texto && toast) {
      toast.textContent = String(m.texto);
      toast.className = 'dx-toast' + (m.erro ? ' dx-erro' : '');
      toast.setAttribute('aria-live', m.erro ? 'assertive' : 'polite');
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(function () { toast.hidden = true; }, m.erro ? 6500 : 3500);
    }
  });
})();
</script>`
}

const cartao = (s) => {
  const c = CATALOGO[s]
  return `<a class="dx-tool" href="/${s}"><div class="dx-k">${esc(c.categoria)}</div><h3>${esc(c.nome)}</h3><p>${esc(c.descricao)}</p><div class="dx-tags">${c.etiquetas.map((e) => `<span>${esc(e)}</span>`).join('')}</div><span class="dx-go">Abrir &rarr;</span></a>`
}

/** Página inteira: casca do site com o miolo no lugar da marca. */
const pagina = (comentario, miolo, depois = '') => `<!--
${comentario}
-->
${casca.antes.replace('<div class="dxt">', () => `${ESTILO}\n<div class="dxt">`)}
${miolo}
${casca.depois}
${depois}`

function paginaFerramenta(p) {
  const url = `${SITE}/${p.slug}`
  const outras = [...new Set((p.outras ?? []).map((s) => String(s).replace(/^\/+/, '').trim()))].filter((s) => CATALOGO[s] && s !== p.slug)
  const faq = p.faq ?? []
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${url}#ferramenta`,
        name: p.titulo,
        url,
        description: p.metaDescricao,
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Web',
        inLanguage: 'pt-BR',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
        publisher: { '@type': 'ProfessionalService', '@id': `${SITE}/#organizacao`, name: 'Dexterity IT Solutions', url: SITE },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Ferramentas', item: `${SITE}/ferramentas` },
          { '@type': 'ListItem', position: 3, name: p.titulo, item: url },
        ],
      },
      ...(faq.length ? [{ '@type': 'FAQPage', mainEntity: faq.map((q) => ({ '@type': 'Question', name: q.pergunta, acceptedAnswer: { '@type': 'Answer', text: q.resposta } })) }] : []),
    ],
  }
  const comentario = `  ${p.titulo} — página ${url}
  Gerado por site/build.mjs a partir de site/paginas/${p.slug}.json e da casca do site (site/casca-site.html) —
  não editar aqui nem no Odoo; alterar o JSON, gerar e colar de novo.

  É a página INTEIRA, como as demais do site: faixa de cotações, menu, cabeçalho, a ferramenta, como usar,
  texto, perguntas, outras ferramentas, chamada e rodapé. No Odoo: apagar todo o conteúdo da página e colar
  num único bloco Código Incorporado (a casca esconde o cabeçalho e o rodapé padrão do Odoo).
  A ferramenta (${p.app}) entra em modo incorporado (?embed=1), com a altura ajustada ao conteúdo pelo
  script no fim do bloco.

  Otimizar SEO (painel do Odoo):
    Título:    ${p.tituloSEO}
    Descrição: ${p.metaDescricao}`
  const miolo = `<header class="dx-phead"><div class="dx-wrap"><span class="dx-eyebrow">Ferramenta aberta · sem cadastro</span><h1>${esc(p.titulo)}</h1><p>${esc(p.lead)}</p></div></header>
<section class="dx-section dx-fer-app"><div class="dx-wrap"><div class="dx-frame"><iframe id="dx-frame-${p.slug}" src="${p.app}/?embed=1" title="${esc(p.titulo)}" allow="clipboard-write" style="display:block;width:100%;height:900px;border:0"></iframe></div><p class="dx-frame-note">${esc(p.nota ?? 'A ferramenta roda no seu navegador, sem cadastro. Os dados de mercado vêm das Taxas Referenciais da B3 e do Banco Central, na data escolhida.')}</p><div id="dx-toast-${p.slug}" class="dx-toast" role="status" aria-live="polite" hidden></div></div></section>
<section class="dx-section dx-fer-texto"><div class="dx-wrap"><div class="dx-sec-head"><h2>Como usar</h2></div><ol class="dx-fases dx-passos">
${(p.comoUsar ?? []).map((t, i) => `<li class="dx-fase"><span class="dx-n">${String(i + 1).padStart(2, '0')}</span><p>${esc(t)}</p></li>`).join('\n')}
</ol></div></section>
<section class="dx-section dx-fer-texto"><div class="dx-wrap">
${(p.secoes ?? []).map((s) => `<div class="dx-cols"><h2>${esc(s.titulo)}</h2><div>${s.paragrafos.map((t) => `<p>${esc(t)}</p>`).join('')}</div></div>`).join('\n')}
</div></section>${
    faq.length
      ? `
<section class="dx-section dx-fer-texto"><div class="dx-wrap"><div class="dx-cols"><h2>Perguntas frequentes</h2><div class="dx-faq">
${faq.map((q) => `<details><summary>${esc(q.pergunta)}</summary><p>${esc(q.resposta)}</p></details>`).join('\n')}
</div></div></div></section>`
      : ''
  }${
    outras.length
      ? `
<section class="dx-section"><div class="dx-wrap"><div class="dx-sec-head"><h2>Outras ferramentas</h2><p><a href="/ferramentas">Ver todas as ferramentas &rarr;</a></p></div><div class="dx-tools">
${outras.map(cartao).join('\n')}
</div></div></section>`
      : ''
  }`
  return pagina(comentario, miolo, `${script(p.slug)}

<script type="application/ld+json">
${ld(jsonld)}
</script>
`)
}

function paginaVitrine() {
  const comentario = `  Vitrine ${SITE}/ferramentas — página inteira, com as quatro ferramentas MTM (NDF, swap, opções de
  moeda e Taxas Referenciais da B3). Gerado por site/build.mjs (CATALOGO e VITRINE, kit comum: sai igual
  nos quatro repositórios) e da casca do site (site/casca-site.html) — não editar aqui nem no Odoo.

  No Odoo: página /ferramentas › apagar todo o conteúdo e colar num único bloco Código Incorporado.
  Título e descrição de SEO da página continuam os que já estão no Odoo.`
  const miolo = `<header class="dx-phead"><div class="dx-wrap"><span class="dx-eyebrow">Ferramentas abertas · sem cadastro</span><h1>O que usamos, aberto para você usar.</h1><p>Calculadoras e séries de mercado que a gente construiu para o próprio trabalho e deixou público. Sem cadastro, sem custo, com as convenções do mercado brasileiro.</p></div></header>
<section class="dx-section"><div class="dx-wrap">
${VITRINE.map(
  (g, i) => `<div class="dx-sec-head${i ? ' dx-vit-grupo' : ''}"><h2>${esc(g.titulo)}</h2><p>${esc(g.texto)}</p></div><div class="dx-tools">
${g.slugs.map(cartao).join('\n')}
</div>`,
).join('\n')}
<div class="dx-demo" style="border-left-color:var(--cerceta)"><p><strong>Encontrou divergência com o número do banco?</strong> Normalmente é convenção de contagem de dias ou curva usada. É exatamente o tipo de conversa que a gente gosta de ter.</p><a class="dx-btn" href="/contato">Falar com um consultor</a></div>
</div></section>`
  return pagina(comentario, miolo)
}

for (const p of paginas) {
  writeFileSync(join(DIR, `odoo-pagina-${p.slug}.html`), paginaFerramenta(p))
  console.log(`gerado site/odoo-pagina-${p.slug}.html`)
}
writeFileSync(join(DIR, 'odoo-pagina-ferramentas.html'), paginaVitrine())
console.log('gerado site/odoo-pagina-ferramentas.html')
writeFileSync(
  join(DIR, 'odoo-rodape-ferramentas.html'),
  `<!--
  Coluna "Ferramentas" do rodapé de www.dexterityit.com.br, gerada por site/build.mjs (RODAPE, kit comum).
  As páginas geradas aqui já a trazem; nas demais páginas do site, trocar no bloco Código Incorporado o
  trecho <div><h4>Ferramentas</h4><ul>…</ul></div> do rodapé por este.
-->
${rodapeFerramentas()}
`,
)
console.log('gerado site/odoo-rodape-ferramentas.html')
