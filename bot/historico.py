"""
Histórico simulado (backtest). Roda 1x por dia no GitHub Actions e salva data/historico.json com:
- o grid rodando sem parar no último ano, com a config "historico" do config.json
- "e se eu tivesse ligado o bot ao vivo em qualquer dia do último ano?": várias janelas de 30 dias
  com a config "ao_vivo" (é a resposta mais honesta pra pergunta "vai dar lucro no mês?")
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import dados  # noqa: E402
from analise import continuo, janelas_30d, resumo_janelas, tabela_mensal  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    with open(os.path.join(RAIZ, "config.json")) as f:
        config = json.load(f)
    taxa = float(config.get("taxa_pct", 0.1))
    saldo = float(config.get("saldo_inicial_usd", 20))
    hcfg = config["historico"]
    vcfg = config["ao_vivo"]
    dias = int(hcfg.get("dias", 365))
    fim = int(time.time())
    candles, fonte = dados.candles(fim - dias * 86400, fim, seg=900)
    print(f"{len(candles)} candles via {fonte}")

    g, curva, res = continuo(candles, hcfg, taxa, saldo, registrar=True, amostra_seg=4 * 3600)
    p0 = candles[0][1]
    js = janelas_30d(candles, vcfg, taxa, saldo, dias=30, passo_dias=3)

    vendas = [t for t in g.trades if t["lado"] == "venda"]
    out = {
        "gerado_em": int(time.time()), "fonte": fonte, "dias": dias, "taxa_pct": taxa,
        "saldo_inicial": saldo, "config_historico": hcfg, "config_ao_vivo": vcfg,
        "inicio": candles[0][0], "fim": candles[-1][0], "preco_inicio": p0, "preco_fim": candles[-1][4],
        "resumo": res,
        "n_compras": g.n_compras, "n_vendas": g.n_vendas,
        "melhor_venda": max((t["lucro"] for t in vendas), default=0),
        "curva": [[t, round(p, 4), round(e, 5), round(saldo * p / p0, 5)] for t, p, e in curva],
        "meses": tabela_mensal(curva, saldo),
        "eventos": g.eventos,
        "trades": g.trades[-400:],
        "janelas": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in j.items()} for j in js],
        "janelas_resumo": resumo_janelas(js),
    }
    os.makedirs(os.path.join(RAIZ, "data"), exist_ok=True)
    with open(os.path.join(RAIZ, "data", "historico.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(json.dumps(res, indent=1))
    print(json.dumps(out["janelas_resumo"], indent=1))


if __name__ == "__main__":
    main()
