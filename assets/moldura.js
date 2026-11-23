/*
 * Moldura do site — arquivo IDÊNTICO em bndes-um (Moedas BNDES) e ibge (Séries IBGE).
 *
 * Dentro do iframe das páginas de www.dexterityit.com.br (?embed=1) a ferramenta conversa com a página
 * pelo protocolo das ferramentas MTM (site/build.mjs do kit):
 *   ferramenta → página  { origem:'calculadora-mtm', tipo:'altura', altura }   altura do conteúdo
 *                        { origem:'calculadora-mtm', tipo:'rolar', y, h }     rolar a página até y
 *                        { origem:'calculadora-mtm', tipo:'aviso', texto, erro }
 *   página → ferramenta  { origem:'site-dexterity', tipo:'pronto' }          a página ajusta a altura
 * Com a altura ajustada não há barra de rolagem dentro da moldura; diálogos abrem perto de onde a pessoa
 * clicou e a página rola até eles. Fora de uma moldura nada disso acontece.
 *
 * Uso (script clássico, no fim do <body>):
 *   Moldura.embutido                 true em ?embed=1 ou dentro de um iframe
 *   Moldura.abrirModal(el, gatilho)  mostra um .dxt-modal (hidden → visível) no ponto certo
 *   Moldura.fecharModal(el)          esconde e devolve o foco
 *   Moldura.aviso(texto, erro)       aviso na página do site (só quando ela respondeu "pronto")
 *   Moldura.rolarPara(el)            leva o elemento à vista (na moldura, quem rola é a página)
 */
(function () {
  "use strict";

  var PROTOCOLO = "calculadora-mtm";
  var raiz = document.documentElement;

  var embutido;
  try {
    embutido = new URLSearchParams(location.search).get("embed") === "1" || window.self !== window.top;
  } catch (e) {
    embutido = true;
  }
  if (embutido) raiz.classList.add("modo-embutido");

  // Com a moldura ajustada ao conteúdo, nada de barra de rolagem interna (nem durante a transição)
  var estilo = document.createElement("style");
  estilo.textContent =
    "html.moldura-ajustada,html.moldura-ajustada body{overflow:hidden}" +
    ".modo-embutido .dxt-modal{align-items:flex-start}";
  document.head.appendChild(estilo);

  var paiPronto = false;

  function avisarPai(msg) {
    if (!embutido || window.parent === window) return;
    msg.origem = PROTOCOLO;
    try { window.parent.postMessage(msg, "*"); } catch (e) { /* página sem acesso */ }
  }

  function modalAberto() {
    return document.querySelector(".dxt-modal:not([hidden]) .dxt-modal-box");
  }

  var ultimaAltura = 0;
  function alturaConteudo() {
    var b = document.body;
    if (!b) return 0;
    var cs = getComputedStyle(b);
    var alt = b.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    // diálogo aberto perto do fim da página: a moldura cresce até o pé dele
    var caixa = modalAberto();
    if (caixa) alt = Math.max(alt, caixa.getBoundingClientRect().bottom + window.scrollY + 20);
    return Math.ceil(alt);
  }
  function enviarAltura(forcar) {
    var alt = alturaConteudo();
    if (!alt || (!forcar && Math.abs(alt - ultimaAltura) < 1)) return;
    ultimaAltura = alt;
    avisarPai({ tipo: "altura", altura: alt });
  }
  var pendente = false;
  function agendar() {
    if (pendente) return;
    pendente = true;
    requestAnimationFrame(function () { pendente = false; enviarAltura(false); });
  }

  function rolarPara(el) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (embutido && window.parent !== window) {
      avisarPai({ tipo: "rolar", y: Math.max(0, Math.round(r.top + window.scrollY)), h: Math.round(r.height) });
      return;
    }
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    el.scrollIntoView({ block: "start" });
  }

  var focoAnterior = null;
  function abrirModal(el, gatilho) {
    focoAnterior = document.activeElement;
    el.hidden = false;
    var caixa = el.querySelector(".dxt-modal-box");
    if (embutido && caixa) {
      // A moldura tem a altura do conteúdo: centralizar o diálogo o jogaria longe de quem clicou.
      var ref = gatilho && gatilho.getBoundingClientRect ? gatilho.getBoundingClientRect() : null;
      var y = ref && (ref.width || ref.height) ? ref.top - 120 : 16;
      var max = window.innerHeight - caixa.offsetHeight - 16;
      el.style.paddingTop = Math.max(16, Math.min(y, max)) + "px";
      enviarAltura(true);
      rolarPara(caixa);
    }
    var b = el.querySelector("button, input, select");
    if (b) b.focus({ preventScroll: true });
  }
  function fecharModal(el) {
    if (!el || el.hidden) return;
    el.hidden = true;
    el.style.paddingTop = "";
    if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus({ preventScroll: true });
    enviarAltura(true);
  }

  function aviso(texto, erro) {
    if (paiPronto) avisarPai({ tipo: "aviso", texto: String(texto), erro: !!erro });
  }

  if (embutido) {
    // Links: outra ferramenta do site (data-ferramenta) abre no topo; o resto, em outra aba
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !/^https?:/i.test(a.getAttribute("href"))) return;
      if (a.hasAttribute("data-ferramenta")) a.target = "_top";
      else { a.target = "_blank"; a.rel = "noopener"; }
    }, true);

    window.addEventListener("message", function (e) {
      if (e.source !== window.parent || !e.data || e.data.origem !== "site-dexterity") return;
      if (e.data.tipo === "pronto") {
        paiPronto = true;
        raiz.classList.add("moldura-ajustada");
        enviarAltura(true);
      }
    });

    if ("ResizeObserver" in window) new ResizeObserver(agendar).observe(document.body);
    window.addEventListener("load", function () { enviarAltura(true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { enviarAltura(true); });
    enviarAltura(true);
  }

  window.Moldura = {
    embutido: embutido,
    abrirModal: abrirModal,
    fecharModal: fecharModal,
    aviso: aviso,
    rolarPara: rolarPara,
    enviarAltura: enviarAltura
  };
})();
