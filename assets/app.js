/* Grid SOL — painel. Lê os arquivos que o bot salva em /data e desenha tudo. */
"use strict";

const REPO = "luan146/Grid-bot-sol";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const RECOMENDADO = {
  ao_vivo: { linhas: 6, faixa_abaixo_pct: 20, faixa_acima_pct: 20, recentrar_apos_horas: 48 },
  historico: { linhas: 8, faixa_abaixo_pct: 20, faixa_acima_pct: 20, recentrar_apos_horas: 12 },
};
const D = { estado: null, hist: null, otim: null, config: null };
const graficos = [];

/* ------------------------------------------------------------ formatação */
const nf = (min, max) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const f2 = nf(2, 2), f1 = nf(1, 1), f0 = nf(0, 0), f3 = nf(3, 3), f4 = nf(4, 4);
const usd = (v, casas = 2) => (v < 0 ? "−" : "") + "US$ " + (casas === 3 ? f3 : casas === 4 ? f4 : f2).format(Math.abs(v));
const usdSinal = (v, casas = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + "US$ " + (casas === 3 ? f3 : f2).format(Math.abs(v));
const pct = (v, casas = 1) => (Math.abs(v) < 0.5 * Math.pow(10, -casas) ? "" : v > 0 ? "+" : v < 0 ? "−" : "") + (casas === 2 ? f2 : casas === 0 ? f0 : f1).format(Math.abs(v)) + "%";
const pctSem = (v, casas = 1) => (casas === 0 ? f0 : f1).format(v) + "%";
const dataHora = (t) => new Date(t * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
const dataCurta = (t) => new Date(t * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).replace(".", "");
const tz = () => -new Date().getTimezoneOffset() * 60; // mostra horário local nos gráficos
const cor = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const el = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "style") n.style.cssText = v; else n.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) n.append(f.nodeType ? f : document.createTextNode(String(f)));
  return n;
}
function duracao(seg) {
  const d = Math.floor(seg / 86400), hr = Math.floor((seg % 86400) / 3600), m = Math.floor((seg % 3600) / 60);
  if (d > 0) return `${d} dia${d > 1 ? "s" : ""} e ${hr}h`;
  if (hr > 0) return `${hr}h ${m}min`;
  return `${m} min`;
}

/* ------------------------------------------------------------ dados */
async function pegar(arq) {
  const q = "?v=" + Math.floor(Date.now() / 60000);
  for (const base of ["", RAW]) {
    try {
      const r = await fetch(base + arq + q, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch (e) { /* tenta a próxima fonte */ }
  }
  return null;
}
async function carregar() {
  document.body.classList.add("carregando");
  const [estado, hist, otim, config] = await Promise.all([
    pegar("data/estado.json"), pegar("data/historico.json"), pegar("data/otimizacao.json"), pegar("config.json"),
  ]);
  Object.assign(D, { estado, hist, otim });
  if (!D.config) D.config = config;
  document.body.classList.remove("carregando");
  desenharTudo();
}

/* ------------------------------------------------------------ dica (tooltip) */
const dica = el("dica");
function mostrarDica(ev, nos) {
  dica.replaceChildren(...nos);
  const r = ev.target.getBoundingClientRect();
  const x = ev.clientX ?? r.left + r.width / 2, y = ev.clientY ?? r.top;
  dica.style.opacity = 1;
  const w = dica.offsetWidth;
  dica.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + "px";
  dica.style.top = Math.max(8, y - dica.offsetHeight - 14) + "px";
}
const esconderDica = () => (dica.style.opacity = 0);

/* ------------------------------------------------------------ escada (SVG) */
function escada(niveis, estados, preco, { altura = 330 } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 440, H = altura, pT = 12, pB = 12, xFim = W - 92;
  const lo = Math.min(niveis[0], preco) * 0.985, hi = Math.max(niveis[niveis.length - 1], preco) * 1.015;
  const y = (v) => pT + ((Math.log(hi) - Math.log(v)) / (Math.log(hi) - Math.log(lo))) * (H - pT - pB);
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${W} ${H}`);
  s.setAttribute("class", "escada");
  s.setAttribute("role", "img");
  const mk = (tag, a, txt) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    if (txt != null) n.textContent = txt;
    s.append(n);
    return n;
  };
  let resumo = [];
  for (let i = 0; i < niveis.length - 1; i++) {
    const y1 = y(niveis[i + 1]), y0 = y(niveis[i]);
    const venda = estados[i] === "venda";
    const c = venda ? "var(--venda)" : "var(--compra)";
    mk("rect", { x: 0, y: y1 + 1, width: xFim, height: Math.max(0, y0 - y1 - 2), rx: 6,
      style: `fill:${c};fill-opacity:.13;stroke:${c};stroke-opacity:.35` });
    if (y0 - y1 >= 18) {
      const txt = venda ? `▼ tem SOL, vende em ${f2.format(niveis[i + 1])}` : `▲ tem dólar, compra em ${f2.format(niveis[i])}`;
      let ty = (y0 + y1) / 2 + 4.5;
      const yp0 = y(preco);
      if (Math.abs(ty - 4.5 - yp0) < 13 && y0 - y1 >= 34) ty = yp0 > (y0 + y1) / 2 ? y1 + 15 : y0 - 6;
      else if (Math.abs(ty - 4.5 - yp0) < 13) ty = null;
      if (ty != null) mk("text", { x: 12, y: ty, style: `fill:${c};font-size:13px;font-weight:700` }, txt);
    }
    resumo.push(venda ? "venda" : "compra");
  }
  niveis.forEach((v) => {
    mk("line", { x1: 0, x2: xFim + 6, y1: y(v), y2: y(v), style: "stroke:var(--linha-forte);stroke-width:1" });
    mk("text", { x: xFim + 10, y: y(v) + 4, style: "fill:var(--tinta-2);font-size:12px" }, f2.format(v));
  });
  const yp = y(preco);
  mk("line", { x1: 0, x2: xFim + 6, y1: yp, y2: yp, style: "stroke:var(--tinta);stroke-width:2.5" });
  const rot = `SOL agora ${f2.format(preco)}`;
  const largura = rot.length * 7.2 + 16;
  const yr = Math.min(H - 22, Math.max(2, yp - 10));
  mk("rect", { x: xFim - largura, y: yr, width: largura, height: 20, rx: 10, style: "fill:var(--tinta)" });
  mk("text", { x: xFim - largura / 2, y: yr + 14, "text-anchor": "middle", style: "fill:var(--bg);font-size:12px;font-weight:800" }, rot);
  const nC = resumo.filter((x) => x === "compra").length;
  s.setAttribute("aria-label", `Grid com ${niveis.length - 1} degraus entre US$ ${f2.format(niveis[0])} e ${f2.format(niveis[niveis.length - 1])}. ${nC} esperando comprar, ${resumo.length - nC} esperando vender. Preço atual ${f2.format(preco)}.`);
  return s;
}

/* ------------------------------------------------------------ gráficos */
function baseGrafico(div, extra = {}) {
  const LW = window.LightweightCharts;
  const g = LW.createChart(div, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: cor("--tinta-2"), fontFamily: "Archivo, system-ui, sans-serif", fontSize: 12 },
    grid: { vertLines: { color: cor("--linha") }, horzLines: { color: cor("--linha") } },
    rightPriceScale: { borderColor: cor("--linha") },
    timeScale: { borderColor: cor("--linha"), timeVisible: true, secondsVisible: false, minBarSpacing: 0.01 },
    crosshair: { mode: 0, vertLine: { color: cor("--tinta-3"), labelBackgroundColor: cor("--painel-2") }, horzLine: { color: cor("--tinta-3"), labelBackgroundColor: cor("--painel-2") } },
    localization: { locale: "pt-BR", priceFormatter: (p) => f2.format(p) },
    handleScroll: { vertTouchDrag: false },
    ...extra,
  });
  graficos.push(g);
  return g;
}
function limparGraficos() { while (graficos.length) graficos.pop().remove(); }
function leitura(alvo, g, fn) {
  const padrao = () => alvo.replaceChildren(h("span", {}, "Passe o dedo ou o mouse no gráfico pra ver os valores."));
  padrao();
  g.subscribeCrosshairMove((p) => {
    if (!p || !p.time) return padrao();
    const nos = fn(p);
    if (nos) alvo.replaceChildren(...nos); else padrao();
  });
}

/* ------------------------------------------------------------ AO VIVO */
function desenharVivo() {
  const E = D.estado;
  const selo = el("selo"), seloTxt = el("selo-txt");
  if (!E) {
    selo.dataset.s = "atraso"; seloTxt.textContent = "esperando a primeira rodada";
    el("h-valor").replaceChildren(h("small", {}, "US$"), "—");
    el("escada").replaceChildren(h("div", { class: "vazio" }, "O bot ainda não rodou. A primeira rodada acontece em até 10 minutos."));
    return;
  }
  const atras = Date.now() / 1000 - E.atualizado_em;
  selo.dataset.s = atras < 40 * 60 ? "ok" : "atraso";
  seloTxt.textContent = (atras < 40 * 60 ? "Rodando, atualizado há " : "Atrasado, última rodada há ") + duracao(Math.max(60, atras));

  const [, preco, patr] = E.curva[E.curva.length - 1];
  const saldo = E.saldo_inicial, hodl = saldo * preco / E.preco_inicial;
  const res = patr - saldo, resPct = (patr / saldo - 1) * 100;
  el("h-rotulo").textContent = `Seu saldo simulado (começou com ${usd(saldo)})`;
  el("h-valor").replaceChildren(h("small", {}, "US$"), f2.format(patr));
  const d = el("h-delta");
  d.className = "delta " + (res >= 0 ? "pos" : "neg");
  d.textContent = `${usdSinal(res)} (${pct(resPct, 2)}) desde ${new Date(E.iniciado_em * 1000).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
  el("h-hodl").textContent = `${usd(hodl)} (${pct((hodl / saldo - 1) * 100)})`;
  el("h-grid").textContent = usdSinal(E.grid.lucro_grid, 3);
  const vSol = E.grid.sol * preco, pUsd = (E.grid.usd / patr) * 100;
  el("h-aloc").replaceChildren(
    h("p", { class: "aloc-txt" }, "O bot tem ", h("b", {}, usd(E.grid.usd)), " guardados pra comprar se a SOL cair e ",
      h("b", {}, `${f4.format(E.grid.sol)} SOL (${usd(vSol)})`), " pra vender se ela subir."),
    h("div", { class: "aloc-barra", role: "img", "aria-label": `${f0.format(pUsd)}% em dólar, ${f0.format(100 - pUsd)}% em SOL` },
      h("span", { style: `width:${pUsd}%;background:var(--compra)` }), h("span", { style: `width:${100 - pUsd}%;background:var(--venda)` })),
    h("div", { class: "aloc-leg" }, h("span", {}, `${f0.format(pUsd)}% em dólar`), h("span", {}, `${f0.format(100 - pUsd)}% em SOL`)));

  const G = E.grid, niv = G.niveis;
  el("esc-faixa").textContent = `US$ ${f2.format(niv[0])} a ${f2.format(niv[niv.length - 1])}`;
  const fora = preco < niv[0] || preco > niv[niv.length - 1];
  const prox = proximoDegrau(G, preco);
  el("esc-sub").textContent = fora
    ? `O preço saiu da faixa. ${E.config.recentrar_apos_horas ? `Se ficar fora por ${E.config.recentrar_apos_horas}h, o bot remonta a escada em volta do preço novo.` : "Recentrar está desligado: o bot espera o preço voltar."}`
    : `Cada degrau é uma ordem esperando o preço chegar. ${prox}`;
  el("escada").replaceChildren(escada(niv, G.estado, preco));

  const vendas = E.trades.filter((t) => t.lado === "venda").length, compras = E.trades.filter((t) => t.lado === "compra").length;
  const nums = [
    ["Preço da SOL", usd(preco), pct((preco / E.preco_inicial - 1) * 100) + " desde o início"],
    ["Operações", `${compras + vendas}`, `${compras} compras, ${vendas} vendas`],
    ["Na carteira", usd(G.usd), `+ ${f4.format(G.sol)} SOL`],
    ["Ligado há", duracao(Date.now() / 1000 - E.iniciado_em), `taxas pagas ${usd(G.taxas_pagas, 3)}`],
  ];
  el("nums").replaceChildren(...nums.map(([a, b, c]) => h("div", {}, h("dt", {}, a), h("dd", {}, b, h("br"), h("small", {}, c)))));

  // gráfico de preço
  const off = tz();
  if (E.candles.length < 2) {
    el("g-preco").replaceChildren(h("div", { class: "vazio" }, "As velas aparecem depois das primeiras rodadas do bot. Volte em uns 20 minutos."));
    el("g-preco").style.height = "auto";
    el("leit-preco").textContent = "";
  } else { el("g-preco").style.height = ""; desenharPreco(E, niv, off); }
  desenharEq(E, saldo, off);
  desenharTrades(E, niv, prox);
}
function desenharPreco(E, niv, off) {
  const gp = baseGrafico(el("g-preco"));
  const velas = gp.addCandlestickSeries({
    upColor: cor("--compra"), downColor: cor("--venda"), borderVisible: false,
    wickUpColor: cor("--compra"), wickDownColor: cor("--venda"), priceLineVisible: false,
  });
  velas.setData(E.candles.map(([t, o, hi, lo, c]) => ({ time: t + off, open: o, high: hi, low: lo, close: c })));
  niv.forEach((v) => velas.createPriceLine({ price: v, color: cor("--tinta-3"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "" }));
  const marcas = E.trades.filter((t) => t.lado === "compra" || t.lado === "venda").map((t) => ({
    time: t.t - (t.t % 900) + off,
    position: t.lado === "compra" ? "belowBar" : "aboveBar",
    color: t.lado === "compra" ? cor("--compra") : cor("--venda"),
    shape: t.lado === "compra" ? "arrowUp" : "arrowDown",
    size: 1.2,
  })).sort((a, b) => a.time - b.time);
  velas.setMarkers(marcas);
  gp.timeScale().fitContent();
  leitura(el("leit-preco"), gp, (p) => {
    const v = p.seriesData.get(velas); if (!v) return null;
    return [h("b", {}, usd(v.close)), ` fechamento às ${dataHora(p.time - off)}  (máx ${f2.format(v.high)}, mín ${f2.format(v.low)})`];
  });

}
function desenharEq(E, saldo, off) {
  const ge = baseGrafico(el("g-eq"));
  const sBot = ge.addLineSeries({ color: cor("--bot"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  const sHodl = ge.addLineSeries({ color: cor("--hodl"), lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: true });
  const ptos = dedup(E.curva.map(([t, p, e]) => [t + off, p, e]));
  sBot.setData(ptos.map(([t, , e]) => ({ time: t, value: e })));
  sHodl.setData(ptos.map(([t, p]) => ({ time: t, value: saldo * p / E.preco_inicial })));
  sBot.createPriceLine({ price: saldo, color: cor("--tinta-3"), lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: "início" });
  ge.timeScale().fitContent();
  leitura(el("leit-eq"), ge, (p) => {
    const a = p.seriesData.get(sBot), b = p.seriesData.get(sHodl); if (!a) return null;
    return [h("b", {}, usd(a.value)), " bot   ", h("b", {}, usd(b.value)), ` só SOL   em ${dataHora(p.time - off)}`];
  });

}
function desenharTrades(E, niv, prox) {
  const tr = E.trades.slice().reverse();
  const reais = tr.filter((t) => t.lado === "compra" || t.lado === "venda");
  if (!reais.length) {
    el("trades").replaceChildren(h("div", { class: "vazio" }, "Nenhuma compra ou venda ainda. ", h("b", {}, prox),
      " Com degraus de ~", f1.format(espacoReal(niv)), "%, pode levar de algumas horas a alguns dias."));
  } else {
    const nomes = { compra: ["▲ Compra", "c"], venda: ["▼ Venda", "v"], compra_inicial: ["Compra inicial", "i"], venda_ajuste: ["Ajuste", "i"] };
    const linhas = tr.slice(0, 200).map((t) => {
      const [nome, cls] = nomes[t.lado] || [t.lado, "i"];
      return h("tr", {},
        h("td", {}, dataHora(t.t)), h("td", {}, h("span", { class: "tag " + cls }, nome)),
        h("td", { class: "n" }, usd(t.preco)), h("td", { class: "n" }, f4.format(t.qtd)), h("td", { class: "n" }, usd(t.usd)),
        h("td", { class: "n " + (t.lucro > 0 ? "pos" : t.lucro < 0 ? "neg" : "") }, t.lucro == null ? "" : usdSinal(t.lucro, 3)));
    });
    el("trades").replaceChildren(h("div", { class: "rolagem" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Quando"), h("th", {}, "O quê"), h("th", { class: "n" }, "Preço"), h("th", { class: "n" }, "SOL"), h("th", { class: "n" }, "Valor"), h("th", { class: "n" }, "Lucro"))),
      h("tbody", {}, ...linhas))));
  }
  el("rodape-fonte").textContent = `Rodadas até agora: ${E.rodadas}.`;
}
function dedup(ptos) {
  const out = [];
  for (const p of ptos) { if (out.length && out[out.length - 1][0] >= p[0]) out[out.length - 1] = p; else out.push(p); }
  return out;
}
function espacoReal(niv) { return (Math.pow(niv[niv.length - 1] / niv[0], 1 / (niv.length - 1)) - 1) * 100; }
function proximoDegrau(G, preco) {
  let compra = null, venda = null;
  G.estado.forEach((e, i) => {
    if (e === "compra" && G.niveis[i] < preco) compra = Math.max(compra ?? 0, G.niveis[i]);
    if (e === "venda" && G.niveis[i + 1] > preco) venda = Math.min(venda ?? Infinity, G.niveis[i + 1]);
  });
  const partes = [];
  if (venda) partes.push(`a próxima venda é em US$ ${f2.format(venda)} (${pct((venda / preco - 1) * 100)})`);
  if (compra) partes.push(`a próxima compra é em US$ ${f2.format(compra)} (${pct((compra / preco - 1) * 100)})`);
  return partes.length ? partes.join(" e ").replace(/^a/, "A") + "." : "";
}

/* ------------------------------------------------------------ HISTÓRICO */
function desenharHist() {
  const H = D.hist;
  if (!H) { el("hist-veredito").textContent = "O histórico ainda está sendo calculado. Volte em alguns minutos."; return; }
  const R = H.resumo, J = H.janelas_resumo, cv = H.config_ao_vivo, ch = H.config_historico;
  const dSol = R.hodl_pct, dBot = R.retorno_pct;
  let v;
  if (dBot >= 0 && dSol < 0) v = `No último ano a SOL caiu ${pctSem(-dSol, 0)}, e mesmo assim o bot terminou no lucro (${pct(dBot)}).`;
  else if (dBot < 0 && dSol < 0 && dBot > dSol) v = `No último ano a SOL caiu ${pctSem(-dSol, 0)}. O bot terminou com ${pct(dBot)}: perdeu bem menos que quem só segurou, mas não deu lucro.`;
  else if (dBot >= 0 && dBot < dSol) v = `No último ano a SOL subiu ${pctSem(dSol, 0)}. O bot ganhou ${pct(dBot)}: lucrou, mas menos do que só segurar.`;
  else v = `No último ano a SOL foi de ${pct(dSol)} e o bot de ${pct(dBot)}.`;
  el("hist-veredito").textContent = v;

  el("hist-jan-sub").textContent = `Simulei ligar o bot com a configuração ao vivo (${cv.linhas} degraus, faixa de ±${cv.faixa_abaixo_pct}%) em ${J.n} dias diferentes do último ano, e olhei o saldo 30 dias depois. Cada barra conta quantas vezes o resultado caiu naquela faixa.`;
  histograma(H.janelas.map((j) => j.bot_pct));
  const fatos = (alvo, itens) => el(alvo).replaceChildren(...itens.map(([a, b, cls]) => h("div", {}, h("dt", {}, a), h("dd", { class: cls || "" }, b))));
  fatos("fatos-jan", [
    ["Terminou no lucro", `${pctSem(J.positivas_pct, 0)} das vezes`],
    ["Resultado típico (mediana)", pct(J.mediana_pct), J.mediana_pct >= 0 ? "pos" : "neg"],
    ["Pior resultado", pct(J.pior_pct), "neg"],
    ["Melhor resultado", pct(J.melhor_pct), "pos"],
    ["Ganhou de só segurar SOL", `${pctSem(J.venceu_hodl_pct, 0)} das vezes`],
    ["Operações em 30 dias", `~${f0.format(J.trades_media)}`],
  ]);
  el("hist-ano-sub").textContent = `Config do histórico: ${ch.linhas} degraus, faixa de ±${ch.faixa_abaixo_pct}%, recentra depois de ${ch.recentrar_apos_horas}h fora. De ${dataCurta(H.inicio)} a ${dataCurta(H.fim)}, começando com ${usd(H.saldo_inicial)}.`;
  fatos("fatos-ano", [
    ["Bot", `${usd(R.final)} (${pct(dBot)})`, dBot >= 0 ? "pos" : "neg"],
    ["Só segurar SOL", `${usd(H.saldo_inicial * (1 + dSol / 100))} (${pct(dSol)})`, dSol >= 0 ? "pos" : "neg"],
    ["Lucro das idas e voltas", usdSinal(R.lucro_grid)],
    ["Maior queda no caminho", pct(R.max_queda_pct), "neg"],
    ["Operações", f0.format(R.trades)],
    ["Vezes que recentrou", f0.format(R.recentradas)],
  ]);

  // gráfico do ano
  const off = tz();
  const g = baseGrafico(el("g-hist"));
  const sBot = g.addLineSeries({ color: cor("--bot"), lineWidth: 2, priceLineVisible: false });
  const sHodl = g.addLineSeries({ color: cor("--hodl"), lineWidth: 2, lineStyle: 2, priceLineVisible: false });
  const pts = dedup(H.curva.map(([t, p, e, ho]) => [t + off, p, e, ho]));
  sBot.setData(pts.map(([t, , e]) => ({ time: t, value: e })));
  sHodl.setData(pts.map(([t, , , ho]) => ({ time: t, value: ho })));
  sBot.createPriceLine({ price: H.saldo_inicial, color: cor("--tinta-3"), lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: "início" });
  const rec = H.eventos.filter((e) => e.tipo === "recentrado");
  sBot.setMarkers(rec.map((e) => {
    const t = e.t + off; let melhor = pts[0][0];
    for (const p of pts) { if (p[0] <= t) melhor = p[0]; else break; }
    return { time: melhor, position: "inBar", color: cor("--tinta"), shape: "circle", size: 0.8 };
  }).filter((m, i, a) => i === 0 || m.time !== a[i - 1].time));
  g.timeScale().fitContent();
  leitura(el("leit-hist"), g, (p) => {
    const a = p.seriesData.get(sBot), b = p.seriesData.get(sHodl); if (!a) return null;
    const preco = pts.find((x) => x[0] === p.time);
    return [h("b", {}, usd(a.value)), " bot   ", h("b", {}, usd(b.value)), " só SOL   ", `SOL a ${usd(preco ? preco[1] : 0)} em ${dataCurta(p.time - off)}`];
  });

  // mês a mês
  const ms = H.meses;
  const max = Math.max(1, ...ms.flatMap((m) => [Math.abs(m.bot_pct), Math.abs(m.sol_pct)]));
  const mesNome = (s, ult) => {
    const [a, m] = s.split("-");
    return new Date(+a, +m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "").replace(" de ", "/") + (ult ? "*" : "");
  };
  const trilho = (v) => {
    const w = (Math.abs(v) / max) * 48;
    const bar = h("div", { class: "bar", style: `background:var(${v >= 0 ? "--bom" : "--ruim"});width:${w}%;${v >= 0 ? "left:50%" : `right:50%`}` });
    // o número fica do outro lado da linha do zero, assim nunca estoura a largura
    const txt = h("span", { class: "val", style: v >= 0 ? "right:calc(50% + 6px)" : "left:calc(50% + 6px)" }, pct(v));
    return h("div", { class: "trilho" }, bar, txt);
  };
  el("meses").replaceChildren(...ms.map((m, i) => h("div", { class: "mes" }, h("span", { class: "nome" }, mesNome(m.mes, i === ms.length - 1)), trilho(m.bot_pct), trilho(m.sol_pct))),
    h("p", { class: "sub", style: "margin:8px 0 0" }, "* mês em andamento"));
}

function histograma(vals) {
  const passo = 2.5;
  const lo = Math.floor(Math.min(...vals) / passo) * passo, hi = Math.ceil(Math.max(...vals) / passo) * passo;
  const n = Math.max(1, Math.round((hi - lo) / passo));
  const cont = new Array(n).fill(0);
  vals.forEach((v) => cont[Math.min(n - 1, Math.floor((v - lo) / passo))]++);
  const mx = Math.max(...cont);
  const caixa = el("histo");
  const barras = cont.map((c, i) => {
    const a = lo + i * passo, b = a + passo;
    const b0 = h("div", { class: "barra", tabindex: "0", role: "img",
      "aria-label": `De ${pct(a)} a ${pct(b)}: ${c} vezes`,
      style: `height:${(c / mx) * 100}%;background:var(${a >= 0 ? "--bom" : "--ruim"});opacity:${c ? 1 : 0.25}` });
    const mostrar = (ev) => mostrarDica(ev, [h("b", {}, `${c} vez${c === 1 ? "" : "es"}`), h("br"),
      `terminou entre ${pct(a)} e ${pct(b)}`, h("br"), `${pctSem((c / vals.length) * 100, 0)} das simulações`]);
    b0.addEventListener("pointermove", mostrar); b0.addEventListener("focus", mostrar);
    b0.addEventListener("pointerleave", esconderDica); b0.addEventListener("blur", esconderDica);
    return b0;
  });
  const zero = h("div", { class: "histo-zero", style: `left:${((0 - lo) / (hi - lo)) * 100}%` }, h("span", {}, "0%"));
  caixa.replaceChildren(...barras, lo < 0 && hi > 0 ? zero : null);
  el("histo-eixo").replaceChildren(h("span", {}, pct(lo, 0)), h("span", {}, pct(hi, 0)));
}

/* ------------------------------------------------------------ CONFIGURAR */
const C = { modo: "ao_vivo", saldo: 20, sec: { ao_vivo: {}, historico: {} } };
function iniciarConfig() {
  const cfg = D.config || { saldo_inicial_usd: 20, ao_vivo: RECOMENDADO.ao_vivo, historico: { dias: 365, ...RECOMENDADO.historico } };
  C.saldo = cfg.saldo_inicial_usd;
  C.sec.ao_vivo = { ...cfg.ao_vivo }; C.sec.historico = { ...cfg.historico };
  C.original = JSON.parse(JSON.stringify(cfg));
  ["linhas", "abaixo", "acima", "rec", "saldo"].forEach((k) => el("c-" + k).addEventListener("input", lerControles));
  el("c-modo").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    C.modo = b.dataset.v; preencherControles();
  });
  el("btn-reset").addEventListener("click", () => { Object.assign(C.sec[C.modo], RECOMENDADO[C.modo]); preencherControles(); });
  el("btn-copiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el("cfg-json").textContent); el("copiado").textContent = "Configuração copiada. Agora abra o config.json no GitHub e cole."; }
    catch (e) { el("copiado").textContent = "Não consegui copiar sozinho. Selecione o texto acima e copie manualmente."; }
  });
  el("btn-github").href = `https://github.com/${REPO}/edit/main/config.json`;
  const rv = RECOMENDADO.ao_vivo, rh = RECOMENDADO.historico;
  el("tut-recomendado").textContent = `O que deixei configurado: ao vivo com ${rv.linhas} degraus, ±${rv.faixa_abaixo_pct}% e recentrar depois de ${rv.recentrar_apos_horas}h; histórico com ${rh.linhas} degraus, ±${rh.faixa_abaixo_pct}% e recentrar depois de ${rh.recentrar_apos_horas}h. Testei 126 combinações no último ano e escolhi as da região mais estável, não a campeã isolada, porque a campeã de um ano costuma ser sorte.`;
  preencherControles();
}
function preencherControles() {
  const s = C.sec[C.modo];
  [...el("c-modo").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === C.modo)));
  el("c-linhas").value = s.linhas; el("c-abaixo").value = s.faixa_abaixo_pct; el("c-acima").value = s.faixa_acima_pct;
  el("c-rec").value = s.recentrar_apos_horas || 0; el("c-saldo").value = C.saldo;
  lerControles();
}
function lerControles() {
  const s = C.sec[C.modo];
  s.linhas = +el("c-linhas").value; s.faixa_abaixo_pct = +el("c-abaixo").value; s.faixa_acima_pct = +el("c-acima").value;
  s.recentrar_apos_horas = +el("c-rec").value; s.preco_min = null; s.preco_max = null; s.tipo = "geometrico";
  C.saldo = +el("c-saldo").value;
  el("o-linhas").textContent = s.linhas; el("o-abaixo").textContent = `−${s.faixa_abaixo_pct}%`; el("o-acima").textContent = `+${s.faixa_acima_pct}%`;
  el("o-rec").textContent = s.recentrar_apos_horas ? `${s.recentrar_apos_horas}h fora da faixa` : "nunca"; el("o-saldo").textContent = usd(C.saldo, 2).replace(",00", "");
  desenharConfig();
}
function desenharConfig() {
  const s = C.sec[C.modo];
  const preco = D.estado ? D.estado.curva[D.estado.curva.length - 1][1] : D.hist ? D.hist.preco_fim : 120;
  const lo = preco * (1 - s.faixa_abaixo_pct / 100), hi = preco * (1 + s.faixa_acima_pct / 100);
  const r = Math.pow(hi / lo, 1 / s.linhas);
  const niv = Array.from({ length: s.linhas + 1 }, (_, k) => lo * Math.pow(r, k));
  const est = niv.slice(0, -1).map((v) => (v > preco ? "venda" : "compra"));
  const espaco = (r - 1) * 100, liquido = ((1 + espaco / 100) * (1 - 0.001) / (1 + 0.001) - 1) * 100;
  const ordem = C.saldo / s.linhas;
  el("calc").replaceChildren(...[
    ["Espaço entre degraus", pctSem(espaco, 2)],
    ["Lucro por ida e volta", `${pct(liquido, 2)} (~${usd(ordem * liquido / 100, 3)})`],
    ["Valor de cada ordem", usd(ordem)],
    ["Faixa hoje", `${f2.format(lo)} a ${f2.format(hi)}`],
  ].map(([a, b]) => h("div", {}, h("dt", {}, a), h("dd", {}, b))));

  const alertas = [];
  if (espaco < 0.6) alertas.push(["", "Degraus muito colados: a taxa de 0,2% por ida e volta come quase todo o lucro."]);
  else if (espaco < 1.5) alertas.push(["", "Degraus apertados: vai operar muito, mas cada operação rende pouco depois da taxa."]);
  if (espaco > 10) alertas.push(["", "Degraus muito espaçados: o bot vai operar raramente."]);
  if (ordem < 5) alertas.push(["", `Cada ordem teria ${usd(ordem)}. Na simulação funciona, mas na Binance de verdade o mínimo é ~US$ 5. Com dinheiro real, precisaria de uns ${usd(Math.ceil(s.linhas * 5.5 / 5) * 5).replace(",00", "")}.`]);
  const est30 = estimativa(s);
  if (est30) alertas.push(["ok", est30]);
  el("cfg-alertas").replaceChildren(...alertas.map(([c, t]) => h("p", { class: "alerta " + c }, t)));
  el("cfg-escada").replaceChildren(escada(niv, est, preco, { altura: 280 }));
  el("campo-saldo").hidden = false;

  const base = C.original || {};
  const final = {
    saldo_inicial_usd: C.saldo, taxa_pct: base.taxa_pct ?? 0.1, sessao: base.sessao ?? 1,
    ao_vivo: { ...C.sec.ao_vivo }, historico: { dias: 365, ...C.sec.historico },
  };
  final.ao_vivo.preco_min = final.ao_vivo.preco_max = null;
  el("cfg-json").textContent = JSON.stringify(final, null, 2);
}
function estimativa(s) {
  if (!D.otim) return null;
  const alvoF = (s.faixa_abaixo_pct + s.faixa_acima_pct) / 2;
  let melhor = null, dist = Infinity;
  for (const r of D.otim.resultados) {
    const d = Math.abs(Math.log(r.linhas / s.linhas)) * 2 + Math.abs(Math.log(r.faixa_pct / alvoF)) * 2 +
      Math.abs((r.recentrar_h || 200) - (s.recentrar_apos_horas || 200)) / 48;
    if (d < dist) { dist = d; melhor = r; }
  }
  const j = melhor.janelas_30d, a = melhor.ano;
  const igual = melhor.linhas === s.linhas && melhor.faixa_pct === alvoF && s.faixa_abaixo_pct === s.faixa_acima_pct && melhor.recentrar_h === (s.recentrar_apos_horas || 0);
  const nome = igual ? "Essa combinação" : `A combinação testada mais parecida (${melhor.linhas} degraus, ±${melhor.faixa_pct}%, recentrar ${melhor.recentrar_h ? melhor.recentrar_h + "h" : "nunca"})`;
  return `${nome}, no último ano: em 30 dias, terminou no lucro ${pctSem(j.positivas_pct, 0)} das vezes, resultado típico ${pct(j.mediana_pct)}, pior ${pct(j.pior_pct)}. No ano inteiro: ${pct(a.retorno_pct)} (SOL: ${pct(a.hodl_pct)}).`;
}

/* ------------------------------------------------------------ abas, tema, ciclo */
const ABAS = { vivo: "tab-vivo", historico: "tab-hist", configurar: "tab-cfg" };
const PAINEL = { "tab-vivo": "vivo", "tab-hist": "hist", "tab-cfg": "cfg" };
function abrirAba(id, empurrar = true) {
  for (const t of Object.values(ABAS)) {
    const on = t === id;
    el(t).setAttribute("aria-selected", String(on));
    el(t).tabIndex = on ? 0 : -1;
    el(PAINEL[t]).hidden = !on;
  }
  if (empurrar) history.replaceState(null, "", "#" + Object.keys(ABAS).find((k) => ABAS[k] === id));
  desenharTudo();
}
document.querySelector(".abas").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) abrirAba(b.id); });
document.querySelector(".abas").addEventListener("keydown", (ev) => {
  const ids = Object.values(ABAS), i = ids.indexOf(document.activeElement.id);
  if (i < 0 || !["ArrowRight", "ArrowLeft"].includes(ev.key)) return;
  const j = (i + (ev.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length;
  el(ids[j]).focus(); abrirAba(ids[j]);
});
el("tema").addEventListener("click", () => {
  const escuroAgora = cor("--bg").toLowerCase() === "#0f2740";
  const novo = escuroAgora ? "light" : "dark";
  document.documentElement.dataset.theme = novo;
  try { localStorage.setItem("tema", novo); } catch (e) { /* sem armazenamento, tudo bem */ }
  desenharTudo();
});
matchMedia("(prefers-color-scheme: light)").addEventListener("change", desenharTudo);

let configPronta = false;
function desenharTudo() {
  limparGraficos();
  esconderDica();
  const aba = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute("aria-selected") === "true").id;
  if (aba === "tab-vivo") desenharVivo();
  if (aba === "tab-hist") desenharHist();
  if (aba === "tab-cfg") { if (!configPronta) { configPronta = true; iniciarConfig(); } else desenharConfig(); }
  if (aba !== "tab-vivo" && D.estado) desenharSelo();
}
function desenharSelo() {
  const E = D.estado, atras = Date.now() / 1000 - E.atualizado_em;
  el("selo").dataset.s = atras < 40 * 60 ? "ok" : "atraso";
  el("selo-txt").textContent = (atras < 40 * 60 ? "Rodando, atualizado há " : "Atrasado, última rodada há ") + duracao(Math.max(60, atras));
}

window.addEventListener("hashchange", () => { const a = ABAS[location.hash.slice(1)]; if (a) abrirAba(a, false); });
const inicial = ABAS[location.hash.slice(1)] || "tab-vivo";
for (const t of Object.values(ABAS)) { el(t).setAttribute("aria-selected", String(t === inicial)); el(PAINEL[t]).hidden = t !== inicial; el(t).tabIndex = t === inicial ? 0 : -1; }
carregar();
setInterval(() => { if (!document.hidden && !el("vivo").hidden) carregar(); }, 3 * 60 * 1000);
