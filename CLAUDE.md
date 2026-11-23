# Cotação de Metais — regras do repositório

- Tudo em português do Brasil: textos da tela, comentários, nomes de funções e variáveis, mensagens de erro.
- Escopo: **só metais** (básicos, preciosos e ferrosos). Agrícolas ficam no app Cotação de Commodities
  Agrícolas (`marketdatacommodity`); energia e financeiros ficam de fora.
- O catálogo — metais, praças, instrumentos (moeda, unidade, código na fonte, MIC, ciclo de vencimentos) —
  fica **só** em `lib/catalogo.js`, importado pelas funções, pela página e pelos testes. Não duplicar lista
  de metais nem de praças no `index.html` ou em `assets/app.js`.
- **Praça = uma função em `/api` + um leitor em `lib/`**: `lme` (Westmetall), `comex` (Yahoo Finance),
  `shfe` e `ine` (boletim da SHFE), `b3` (boletim de pregão), `bcb` (PTAX, em `/api/cambio`), `spot`
  (gold-api.com) e `bm` (Banco Mundial, em `/api/mensal`). Não acrescentar fonte sem combinar.
- **Licenciamento de dados**: LME e CME licenciam a exibição pública dos seus preços, mesmo os do dia
  anterior, e os termos do Yahoo restringem a coleta automatizada. O Diego decidiu em 23/11/2026
  publicar com **todas as praças ativas**: não desativar nenhuma sem combinar. Para tirar uma praça do ar, basta
  `ativa: false` em `lib/catalogo.js`: a função responde 404 e a página deixa de mostrá-la — não remover
  código. Banco Mundial (CC BY 4.0), Banco Central e SHFE (uso não comercial) são as fontes de termos
  mais abertos.
- Parse e cálculos são funções puras em `lib/`, com teste em `tests/` e respostas reais das fontes em
  `tests/fixtures/` (sem rede). Rodar `npm test` antes de entregar. Os testes das funções fixam o relógio
  com `fixarRelogio` (`lib/relogio.js`): toda função usa `agora()`, nunca `new Date()` direto.
- Rodam no navegador (nada de `node:` neles): `catalogo`, `datas`, `unidades`, `curva`, `painel`,
  `formatos`, `exportacao`, `shfe`, `bcb`. São só das funções: `http`, `zip`, `relogio`, `westmetall`,
  `yahoo`, `b3`, `spot`, `bancomundial`.
- Nas fontes, achar coluna e campo pelo **nome**, nunca pela posição. Página de bloqueio, HTML no lugar de
  JSON ou layout diferente lançam erro — nunca devolvem lista vazia como se fosse dado.
- As funções devolvem erro em JSON `{ "erro": "…" }` com `Cache-Control: no-store`: 400 parâmetro inválido
  (sem ir à rede), 404 praça desativada ou dia sem pregão, 502 fonte fora do ar ou fora do formato. Nunca
  200 enganoso. Valor que a fonte não publica fica `null` — nunca zero.
- Conversão: sem taxa de câmbio, `converterPreco` devolve `null` e a tela mostra "—"; não inventar taxa.
  O preço "na praça" é sempre o publicado (com IVA em Xangai); só a coluna comparável tira o imposto.
- A referência da COMEX é sempre a última barra **encerrada**; o negócio do dia em curso sai à parte
  (`intradia`). A da SHFE e da B3 é o contrato de maior posição em aberto.
- **Planilha SAP**: é planilha de apoio com os campos do preço por DCS (FDCS17/TBEXN), na cotação original
  da praça. O F2610 não tem categoria de commodity — não chamar de carga nem inventar layout oficial.
- Arquivos comuns que **não se editam aqui** (são cópias idênticas em outros repositórios):
  `assets/dexterity.css`, `assets/moldura.js`, `assets/favicon.svg`, `assets/dexterity-logo.svg`,
  `scripts/dev.mjs`, `site/casca-site.html`, `vercel.json`. O `site/build.mjs` também é do kit: as
  entradas `cotacao-de-metais` e `commodities-agricolas` do CATALOGO, da VITRINE e do RODAPE têm de ser
  replicadas nos demais repositórios antes de republicar a vitrine.
- Diálogos sempre com `Moldura.abrirModal(el, botao)` / `Moldura.fecharModal(el)`; depois de gerar
  arquivo, `Moldura.aviso(texto)`. `localStorage` sempre protegido por try/catch.
- A tela se redesenha por `agendarDesenho()` (setTimeout, não requestAnimationFrame: a aba em segundo
  plano também atualiza). Nada de `innerHTML`: só `textContent` e `replaceChildren`.
- Página do site: editar `site/paginas/cotacao-de-metais.json` e rodar `npm run site`; nunca editar o
  HTML gerado nem a página no Odoo. Os campos `categoria`, `titulo`, `descricaoCartao` e `etiquetas` têm
  de bater com o CATALOGO de `site/build.mjs`.
- Visual: paleta e regras de `assets/dexterity.css` (cerceta = alta, âmbar = baixa, vermelho só erro,
  roxo nota, cantos retos); conferir a 390 px sem rolagem horizontal e em `?embed=1`.
- Referências públicas sempre `www.dexterityit.com.br/cotacao-de-metais`, nunca `*.vercel.app`.
- Servidor local: `npm run dev` (ou `PORT=8161 npm run dev`). Reiniciar ao mudar arquivo de `lib/`.
