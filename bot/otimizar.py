"""
Testa várias configurações de grid com o histórico real da SOL e salva o ranking em data/otimizacao.json.
Roda no GitHub Actions (workflow "Otimizar configuração").
"""
from __future__ import annotations

import itertools
import json
import os
import sys
import time
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(__file__))
import dados  # noqa: E402
from analise import continuo, janelas_30d, resumo_janelas, tabela_mensal  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAXA = 0.1
SALDO = 20.0
LINHAS = [4, 6, 8, 10, 14, 20, 30]
FAIXAS = [8, 12, 16, 20, 30, 40]
RECENTRAR = [0, 12, 48]

CANDLES = None


def _init(c):
    global CANDLES
    CANDLES = c


def avaliar(params):
    linhas, faixa, rec = params
    cfg = {"linhas": linhas, "faixa_abaixo_pct": faixa, "faixa_acima_pct": faixa,
           "tipo": "geometrico", "recentrar_apos_horas": rec}
    js = janelas_30d(CANDLES, cfg, TAXA, SALDO)
    _, curva, cont = continuo(CANDLES, cfg, TAXA, SALDO)
    meses = tabela_mensal(curva, SALDO)
    return {"linhas": linhas, "faixa_pct": faixa, "recentrar_h": rec,
            "janelas_30d": resumo_janelas(js), "ano": cont,
            "meses_positivos": sum(1 for m in meses if m["bot_pct"] > 0), "meses": len(meses)}


def main():
    dias = int(os.environ.get("DIAS", "365"))
    fim = int(time.time())
    t0 = time.time()
    candles, fonte = dados.candles(fim - dias * 86400, fim, seg=900)
    print(f"{len(candles)} candles de 15m via {fonte} em {time.time() - t0:.0f}s")
    combos = list(itertools.product(LINHAS, FAIXAS, RECENTRAR))
    with Pool(os.cpu_count(), initializer=_init, initargs=(candles,)) as pool:
        res = pool.map(avaliar, combos)
    out = {"gerado_em": int(time.time()), "fonte": fonte, "dias": dias, "taxa_pct": TAXA,
           "saldo": SALDO, "inicio": candles[0][0], "fim": candles[-1][0],
           "preco_inicio": candles[0][1], "preco_fim": candles[-1][4], "resultados": res}
    os.makedirs(os.path.join(RAIZ, "data"), exist_ok=True)
    with open(os.path.join(RAIZ, "data", "otimizacao.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"ok: {len(res)} configs em {time.time() - t0:.0f}s")
    top = sorted(res, key=lambda r: -r["janelas_30d"]["mediana_pct"])[:10]
    for r in top:
        j = r["janelas_30d"]
        print(r["linhas"], r["faixa_pct"], r["recentrar_h"], round(j["mediana_pct"], 2),
              round(j["positivas_pct"]), round(j["pior_pct"], 1), "| ano", round(r["ano"]["retorno_pct"], 1))


if __name__ == "__main__":
    main()
