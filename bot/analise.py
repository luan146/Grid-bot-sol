"""Funções de análise compartilhadas pelo backtest e pela otimização."""
from __future__ import annotations

import statistics
from datetime import datetime, timezone

from grid import Grid, max_drawdown, simular

DIA = 86400


def janelas_30d(candles, grid_cfg, taxa, saldo, dias=30, passo_dias=7):
    """Simula 'ligar o bot' em vários dias diferentes e deixar rodando N dias.
    Devolve uma lista com o resultado de cada janela."""
    res = []
    if not candles:
        return res
    t_ini, t_fim = candles[0][0], candles[-1][0]
    idx = 0
    inicio = t_ini
    while inicio + dias * DIA <= t_fim + 1:
        while idx < len(candles) and candles[idx][0] < inicio:
            idx += 1
        fim = inicio + dias * DIA
        j = idx
        while j < len(candles) and candles[j][0] < fim:
            j += 1
        trecho = candles[idx:j]
        if len(trecho) > 10:
            g, _ = simular(trecho, grid_cfg, taxa, saldo, amostra_seg=10 ** 9)
            p0, p1 = trecho[0][1], trecho[-1][4]
            final = g.patrimonio(p1)
            res.append({
                "inicio": int(inicio),
                "bot_pct": (final / saldo - 1) * 100,
                "hodl_pct": (p1 / p0 - 1) * 100,
                "trades": g.n_compras + g.n_vendas,
                "lucro_grid": g.lucro_grid,
                "fora_fim": g.fora_da_faixa(p1),
            })
        inicio += passo_dias * DIA
    return res


def resumo_janelas(js):
    if not js:
        return {}
    b = [j["bot_pct"] for j in js]
    h = [j["hodl_pct"] for j in js]
    return {
        "n": len(js),
        "mediana_pct": statistics.median(b),
        "media_pct": statistics.fmean(b),
        "positivas_pct": 100 * sum(1 for x in b if x > 0) / len(b),
        "pior_pct": min(b),
        "melhor_pct": max(b),
        "hodl_mediana_pct": statistics.median(h),
        "venceu_hodl_pct": 100 * sum(1 for x, y in zip(b, h) if x > y) / len(b),
        "trades_media": statistics.fmean(j["trades"] for j in js),
    }


def mes_de(t):
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m")


def tabela_mensal(curva, saldo):
    """curva: [(t, preco, patrimonio)] → retorno por mês do bot e da SOL."""
    meses = {}
    for t, p, e in curva:
        m = mes_de(t)
        if m not in meses:
            meses[m] = {"mes": m, "p0": p, "e0": e}
        meses[m]["p1"], meses[m]["e1"] = p, e
    lista = list(meses.values())
    # usa o fechamento do mês anterior como base (mais justo que o primeiro ponto do mês)
    for k in range(1, len(lista)):
        lista[k]["p0"] = lista[k - 1]["p1"]
        lista[k]["e0"] = lista[k - 1]["e1"]
    return [{"mes": m["mes"],
             "bot_pct": round((m["e1"] / m["e0"] - 1) * 100, 2),
             "sol_pct": round((m["p1"] / m["p0"] - 1) * 100, 2)} for m in lista]


def continuo(candles, grid_cfg, taxa, saldo, registrar=False, amostra_seg=4 * 3600):
    g, curva = simular(candles, grid_cfg, taxa, saldo, registrar=registrar, amostra_seg=amostra_seg)
    p0, p1 = candles[0][1], candles[-1][4]
    final = g.patrimonio(p1)
    return g, curva, {
        "retorno_pct": (final / saldo - 1) * 100,
        "hodl_pct": (p1 / p0 - 1) * 100,
        "max_queda_pct": max_drawdown([e for _, _, e in curva]) * 100,
        "trades": g.n_compras + g.n_vendas,
        "lucro_grid": g.lucro_grid,
        "taxas": g.taxas_pagas,
        "recentradas": sum(1 for ev in g.eventos if ev["tipo"] == "recentrado"),
        "final": final,
    }
