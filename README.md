# Cotação de Metais — LME, COMEX, Xangai e B3 por praça, com curva de preços

App estático + serverless (Vercel) que mostra a cotação de treze metais **em cada praça** — Londres
(LME), Nova York (COMEX/NYMEX), Xangai (SHFE e INE) e São Paulo (B3) —, a **curva de preços** por
vencimento, o **histórico** com médias mensais e a conversão de unidade e de moeda pela PTAX, com
exportação CSV/Excel e uma planilha de apoio para o SAP.

Mesma família dos apps `marketdata` (Cotação de Moedas), `taxas-indices` (Indicadores Econômicos),
`bndes-um` (Moedas BNDES), `ibge` (Séries IBGE), `cotacao-titulos-publicos` e `marketdatacommodity`
(Cotação de Commodities Agrícolas) — Dados de Mercado da Dexterity IT Solutions.

| Endereço | Para quê |
| --- | --- |
| **https://www.dexterityit.com.br/cotacao-de-metais** | Página do site (Odoo) com a ferramenta incorporada — endereço público e canônico. Gerada a partir de `site/`. **Ainda não publicada.** |
| **https://cotacao-de-metais.vercel.app** | A aplicação em si (projeto `cotacao-de-metais` do time `dexterityit` na Vercel, ligado ao GitHub `dfg-dexterity/marketdatacommoditymetals`), usada no `iframe` da página do site. No ar desde 23/11/2026. |

## Licenciamento das fontes

**Decisão do Diego em 23/11/2026: publicar com todas as praças ativas**, inclusive LME e COMEX, ciente
dos termos abaixo. Se a decisão mudar, a chave `ativa` de cada praça (fim desta seção) tira a fonte do ar.

As bolsas são donas dos seus preços. O que se apurou em 23/11/2026:

| Praça | Fonte lida | Termos |
| --- | --- | --- |
| Londres · LME | Westmetall (HTML público) | A LME exige licença de distribuição para exibir seus preços em site público, **mesmo os do dia anterior**; ler de um espelho não muda isso. |
| Nova York · COMEX | Yahoo Finance (API não documentada) | Os termos do Yahoo restringem coleta automatizada e redistribuição; a CME licencia dado atrasado e de ajuste. |
| Xangai · SHFE e INE | Boletim diário oficial | A SHFE permite uso não comercial; uso com fim de lucro pede autorização escrita. |
| São Paulo · B3 | Boletim público de pregão | Não verificado. |
| Brasil · Banco Central | Boletim de fechamento da PTAX | Dados abertos. |
| Médias mensais | Banco Mundial, Pink Sheet | **CC BY 4.0** — uso livre com atribuição. |
| Spot | gold-api.com | Uso comercial permitido; preço indicativo, sem origem declarada. |

Cada praça tem a chave `ativa` em `lib/catalogo.js`. Com `ativa: false` a função de `/api` responde
404 e a página deixa de mostrar a praça, sem mexer em mais nada — é a forma de tirar uma fonte do ar
se a decisão mudar ou se a bolsa pedir. Sem LME e COMEX a ferramenta segue de pé com Xangai, B3, Banco
Central, Banco Mundial e spot.

## O que a pessoa vê

1. **Painel** — a cotação de referência de cada metal em cada praça: data do pregão, preço na
   cotação da praça, variação do dia e o preço comparável (mesma moeda e unidade). Filtro por texto,
   ordenação por coluna, CSV e Excel.
2. **Metal** (chips no topo) — três indicadores (referência, preço em reais, estrutura a termo) e:
   - **Praças**: as referências lado a lado, com a diferença para a primeira;
   - **Curva de preços**: vencimentos da praça escolhida, spread contra o primeiro, taxa anualizada,
     contango/backwardation, gráfico e **preço a termo interpolado** para um dia;
   - **Histórico e médias**: série diária (LME cash, LME 3 meses, COMEX 1º vencimento) ou mensal
     (Banco Mundial), com mínimo, máximo, média, variação e **média mensal** (período de cotação).
3. **Moeda e unidade** — "da praça", dólar, real ou iuane; tonelada, quilo, grama, libra-peso ou onça
   troy. **Xangai sem IVA** tira os 13% embutidos nos preços domésticos da SHFE.

### Metais e praças

Catálogo único em `lib/catalogo.js`.

| Metal | LME | COMEX/NYMEX | SHFE | Outras |
| --- | --- | --- | --- | --- |
| Cobre | Cu, US$/t | HG, US$/lb | cu, CN¥/t | INE bc (CN¥/t, sem IVA), spot, Banco Mundial |
| Alumínio | Al | ALI, US$/t | al | Banco Mundial |
| Zinco, níquel, chumbo, estanho | Zn, Ni, Pb, Sn | — | zn, ni, pb, sn | Banco Mundial |
| Ouro | — | GC, US$/oz t | au, CN¥/g (sem IVA) | B3 GLD (US$/oz t), Banco Central (R$/g), spot, Banco Mundial |
| Prata | — | SI, US$/oz t | ag, CN¥/kg | spot, Banco Mundial |
| Platina, paládio | — | PL, PA (NYMEX), US$/oz t | — | spot; platina no Banco Mundial |
| Minério de ferro | — | TIO, US$/t (só 1º vencimento) | — | Banco Mundial |
| Aço · bobina a quente | — | HRC, US$/t curta | hc, CN¥/t | — |
| Aço · vergalhão | — | — | rb, CN¥/t | — |

**Cotação de referência** de cada praça: na LME, o cash settlement (e o 3 meses); na COMEX, o primeiro
vencimento do ciclo de maior liquidez **depois** do mês corrente (ouro: fev, abr, jun, ago, dez; prata
e cobre: mar, mai, jul, set, dez; platina: jan, abr, jul, out; paládio: mar, jun, set, dez); em Xangai
e na B3, o contrato de **maior posição em aberto**.

## Fontes de dados

| Função | Fonte | O que lê |
| --- | --- | --- |
| `/api/lme` | `westmetall.com/en/markdaten.php?action=table&field=LME_Cu_cash[&year=]` | Tabela diária por metal e ano (desde 2008): cash, 3 meses e estoque. O painel lê as seis tabelas do ano e calcula variação do dia e médias do mês. |
| `/api/comex` | `query1.finance.yahoo.com/v8/finance/spark` e `/chart` | Fechamento diário por contrato (`GCZ26.CMX`) e do contínuo (`GC=F`). No dia encerrado é o ajuste da CME. |
| `/api/shfe` | `shfe.com.cn/data/tradedata/future/dailydata/kxAAAAMMDD.dat` | Boletim diário com todos os vencimentos de todos os produtos (SHFE e INE). |
| `/api/b3` | `b3.com.br/pesquisapregao/download?filelist=SPRDAAMMDD.zip,` | ZIP dentro de ZIP com o XML BVBG.187; contratos `GLD`. A B3 leva dezenas de segundos para responder. |
| `/api/cambio` | `www4.bcb.gov.br/Download/fechamento/AAAAMMDD.csv` e API Olinda (`CotacaoDolarPeriodo`) | PTAX de fechamento (dólar, iuane, euro, libra, iene), ouro em R$/g e a série do dólar por período. |
| `/api/spot` | `api.gold-api.com/price/XAU` | Preço à vista indicativo de ouro, prata, platina, paládio e cobre. |
| `/api/mensal` | `worldbank.org/en/research/commodity-markets` → `CMO-Historical-Data-Monthly.xlsx` | Médias mensais em dólar desde 1960. O link da planilha muda a cada edição e é achado na página. |

Cuidados de leitura (todos com teste):

- **COMEX**: durante o pregão a última barra do Yahoo é o último negócio, não o ajuste. A referência é
  sempre a última barra **encerrada** (dia anterior ao de Nova York, ou o dia corrente depois das 18h
  de lá); o negócio do dia sai à parte, em `intradia`. Contrato sem negócio no dia traz barra nula: vale
  o último fechamento, com a data dele — e a variação do dia só é calculada quando o fechamento anterior
  é mesmo o do pregão anterior (senão fica em branco). Os preços vêm em ponto flutuante de 32 bits e são
  arredondados a 7 algarismos significativos, o que devolve o valor da bolsa.
- **SHFE**: o arquivo do dia já existe durante o pregão, sem ajuste — é tratado como incompleto e a
  função recua para o pregão anterior. Linhas de subtotal (`小计`) e total (`总计`) ficam de fora.
- **B3**: o download traz mais de uma geração do XML; vale a última por nome. Dia sem pregão devolve um
  ZIP vazio com HTTP 200. O nome do arquivo leva o ano com dois dígitos, então a função só aceita datas
  de 2000 em diante e confere se o pregão devolvido é o da data pedida.
- **Banco Central**: feriado e fim de semana não têm boletim (404): a função recua até 7 dias úteis.
- **Banco Mundial**: aba e colunas achadas pelo nome (`Monthly Prices`, `Copper`…), nunca pela posição.
  O XLSX é lido sem dependências (`lib/zip.js` + expressões regulares).

## API

Todas respondem JSON com `Access-Control-Allow-Origin: *` e cache de CDN (`s-maxage` +
`stale-while-revalidate=86400`). Erros em `{ "erro": "…" }` com `Cache-Control: no-store`: **400**
parâmetro inválido (sem ir à rede), **404** praça desativada ou dia sem pregão, **502** fonte fora do
ar ou fora do formato — nunca um 200 enganoso.

```
GET /api/lme                                painel dos seis metais                    cache 30 min
GET /api/lme?metal=cobre&ano=2025           histórico diário do ano                   30 min (ano fechado: 7 dias)
GET /api/comex                              contrato de referência de cada metal      10 min
GET /api/comex?metal=ouro                   curva: todos os vencimentos listados      10 min
GET /api/comex?metal=ouro&de=2021-11-23     histórico do 1º vencimento (&ate= opcional)  1 h
GET /api/shfe                               último pregão encerrado, todos os vencimentos  15 min
GET /api/shfe?data=2026-11-20               pregão de uma data                        1 dia
GET /api/b3                                 último pregão publicado do GLD            1 h
GET /api/b3?data=2026-11-19                 pregão de uma data                        7 dias
GET /api/cambio                             último boletim de fechamento da PTAX      15 min
GET /api/cambio?de=2025-11-23&ate=2026-11-23  série diária do dólar (até 30 anos)    1 h
GET /api/spot                               preço à vista indicativo                  1 min
GET /api/mensal                             médias mensais do Banco Mundial           12 h
```

Exemplo (`/api/comex?metal=ouro`):

```json
{
  "praca": "comex", "fonte": "Yahoo Finance", "metal": "ouro", "moeda": "USD", "unidade": "oz",
  "data": "2026-11-20",
  "contratos": [
    { "contrato": "Z26", "simbolo": "GCZ26.CMX", "vencimento": "2026-12",
      "data": "2026-11-20", "preco": 3515.4, "dataAnterior": "2026-11-19", "anterior": 3685.5,
      "intradia": { "data": "2026-11-23", "preco": 3611.7 } }
  ]
}
```

## Contas

- **Conversão** (`lib/unidades.js`): imposto → unidade → moeda. "Sem IVA" divide por 1,13 só os
  instrumentos marcados com `iva`; unidade pela massa em quilos (libra 0,45359237 kg; onça troy
  31,1034768 g; tonelada curta 907,18474 kg); moeda com o real como ponte, pela PTAX de **venda** do
  último boletim. Sem taxa, o resultado é `null` e a tela mostra "—".
- **Curva** (`lib/curva.js`): spread de cada vencimento contra o primeiro, em preço e em %; taxa
  anualizada **linear** (`spread % × 365 ÷ dias`); estrutura pelo último contra o primeiro (plana abaixo
  de 0,05%), com aviso de curva mista quando o sinal troca no caminho.
- **Data do vencimento**: cash da LME = pregão + 2 dias úteis; 3 meses = mesmo dia três meses à frente,
  levado para um dia de semana sem mudar de mês; CME e B3 = último dia de semana do mês de entrega; SHFE
  e INE = dia 15 do mês de entrega, ou a segunda-feira seguinte. Feriados não entram na conta: é
  aproximação para prazo e interpolação, não o calendário oficial das bolsas.
- **Preço a termo**: interpolação linear no tempo entre os dois vencimentos vizinhos; fora do intervalo
  da curva não há resultado (não extrapola).
- **Média mensal**: média simples dos pregões do mês. Em reais, cada dia é convertido pela PTAX de venda
  do próprio dia (ou do último dia útil no Brasil) antes de entrar na média. Todo período do histórico
  começa no dia 1º de um mês, para a média do primeiro mês ser a do mês inteiro; o mês em curso sai
  marcado como parcial.

## Planilha de apoio SAP

O aplicativo Importar Dados de Mercado (SAP Fiori F2610) **não tem categoria de commodity**: no S/4HANA
o preço de commodity é mantido por especificação de contrato derivativo (DCS), na transação `FDCS17`
(manual), pela planilha da `TBEXN` ou por datafeed (`TBD5`). Nenhum desses caminhos tem modelo de colunas
público, então a ferramenta **não gera arquivo de carga**: o botão **Planilha SAP** (na curva e no
histórico diário) gera um Excel de apoio, aba `Data`, com os campos-chave documentados do preço por DCS.

| Coluna | Valor gerado |
| --- | --- |
| DCS ID | digitado (lembrado no navegador por metal e praça) |
| MIC | sugerido pela ISO 10383: `XLME`, `XCEC` (COMEX), `XNYM`, `XSGE` (SHFE), `XINE`, `BVMF`; editável |
| Tipo de preço | digitado (código do cadastro de cada SAP) |
| Data do preço | data do pregão, `AAAAMMDD` como texto |
| Data-chave de vencimento | data do vencimento, `AAAAMMDD`; vazia na série histórica |
| Preço | numérico, **na cotação original da praça** (sem conversão e sem tirar o IVA) |
| Moeda | a da praça |
| Unidade de medida | sugerida (`TO`, `LB`, `OZ`, `G`, `KG`), editável |

Arquivo `Precos DCS <DCS>_<MIC>_<metal>_….xlsx`. A cotação USD/BRL continua indo pelo FxRateSet, na
Cotação de Moedas.

## Parâmetros de URL (incorporação e links diretos)

| Parâmetro | Efeito |
| --- | --- |
| `?embed=1` | Modo incorporado, para `iframe` no site (Odoo), no Notion ou na intranet: sem faixa de título e sem os links do rodapé. Com `assets/moldura.js`, a altura do iframe acompanha o conteúdo. |
| `?metal=cobre` | Abre direto no metal: `cobre`, `aluminio`, `zinco`, `niquel`, `chumbo`, `estanho`, `ouro`, `prata`, `platina`, `paladio`, `minerio`, `aco`, `vergalhao`. Sem ele, o painel. |
| `?moeda=BRL` | `USD`, `BRL`, `CNY` ou `original`. |
| `?unidade=t` | `t`, `kg`, `g`, `lb`, `oz` ou `original`. |
| `?praca=comex` | Praça da curva: `lme`, `comex`, `shfe`, `ine` ou `b3`. |

Metal, moeda, unidade e a opção do IVA ficam lembrados no navegador (`localStorage`, protegido por
try/catch).

## Estrutura

- `index.html` — página única sem build (Chart.js 4.4.1 por CDN; SheetJS xlsx 0.18.5 baixado sob demanda
  na primeira exportação) e os estilos próprios da ferramenta.
- `assets/app.js` — script da página (módulo): estado, carregamento, tabelas, gráficos e exportações.
- `lib/catalogo.js` — metais, praças e instrumentos (fonte única).
- `lib/datas.js`, `lib/unidades.js`, `lib/curva.js`, `lib/painel.js`, `lib/formatos.js`,
  `lib/exportacao.js` — funções puras que a página e as funções compartilham.
- `lib/westmetall.js`, `lib/yahoo.js`, `lib/shfe.js`, `lib/b3.js`, `lib/bcb.js`, `lib/spot.js`,
  `lib/bancomundial.js` — um leitor por fonte (funções puras).
- `lib/http.js`, `lib/zip.js`, `lib/relogio.js` — utilitários das funções (resposta, erro, busca com
  nova tentativa; ZIP sem dependências, com teto de 64 MB por entrada descomprimida; relógio que os
  testes fixam).
- `api/` — uma função da Vercel por praça (Node, sem dependências).
- `assets/` — `dexterity.css`, logo e favicon (comuns aos apps) e `moldura.js` (conversa com a página
  do site no iframe).
- `tests/` — `node --test`, com respostas reais das fontes em `tests/fixtures/` (sem rede).
- `scripts/dev.mjs` — servidor local com as funções de `/api` (arquivo comum, não editar aqui).
- `site/` — kit do site: `build.mjs`, `casca-site.html` (comuns) e `paginas/cotacao-de-metais.json`.

## Desenvolvimento

```
npm test        # node --test tests/*.test.mjs (sem rede)
npm run dev     # http://localhost:8080 com as funções de /api buscando as fontes de verdade
PORT=8161 npm run dev
npm run site    # gera site/odoo-pagina-cotacao-de-metais.html
```

Node 20 ou mais novo; sem dependências. Reiniciar o servidor local ao mudar arquivo de `lib/`.

## Publicação

1. **Fontes**: decidido em 23/11/2026 — todas as praças ativas (seção de licenciamento).
2. **Vercel**: feito em 23/11/2026 — projeto `cotacao-de-metais` no time `dexterityit`, ligado a este
   repositório (push na `main` = produção; PR ganha preview). Sem build: a Vercel serve os arquivos da
   raiz e as funções de `api/` (`vercel.json`: região `gru1`, `maxDuration` 60 s, `frame-ancestors *`,
   `noindex` em `/api/`). As sete funções foram testadas em produção no mesmo dia e responderam 200,
   inclusive o Yahoo a partir do IP da Vercel e a B3 (em menos de 1 s, de São Paulo).
3. **Kit comum**: `site/build.mjs` aqui parte do de `marketdatacommodity` e acrescenta a entrada
   `cotacao-de-metais` no CATALOGO, na VITRINE e no RODAPE. O arquivo tem de ficar **idêntico** nos
   demais repositórios do kit (`new-mtm-ndf`, `new-mtm-swap`, `new-mtm-opcoes`, `new-mtm-curvas`,
   `cotacao-titulos-publicos`, `bndes-um`, `ibge`, `marketdatacommodity`), com `npm run site` em cada um.
4. **Site (Odoo)**, MK-02-004 opção A: criar a página `/cotacao-de-metais`, publicar o bloco de
   `site/odoo-pagina-cotacao-de-metais.html` e republicar a vitrine `/ferramentas` e a coluna
   Ferramentas do rodapé. SEO no painel Otimizar SEO:
   - **Título:** `Cotação de Metais: LME, COMEX, Xangai e B3 por praça e curva`
   - **Descrição:** `Cobre, alumínio, zinco, níquel, ouro e prata em Londres (LME), Nova York (COMEX), Xangai (SHFE) e São Paulo (B3): preço por praça, curva, histórico e conversão para reais.`
5. Conferir o `iframe` em janela anônima e a 390 px, e pedir a indexação no Search Console.

## Identidade visual

Tema escuro único da Dexterity IT Solutions — base `#1B1B1B`, off-white `#F7F3E7`, cerceta `#009994`
(destaque `#00B3AC`), âmbar `#FFA436`, roxo `#98569A`. Tipografia Barlow Condensed (títulos, caixa
alta), Figtree (texto) e IBM Plex Mono (rótulos e números). Cantos retos, cartões com fio de 1px, sem
sombra. Cor tem sentido: cerceta = alta, âmbar = baixa, vermelho só para erro, roxo para nota. Os
tokens e o chrome vivem em `assets/dexterity.css`, mantido **idêntico** nos apps de Dados de Mercado;
estilos próprios desta ferramenta ficam no `<style>` do `index.html`.
