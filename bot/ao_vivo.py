"""
Bot ao vivo (dinheiro de mentira). Roda a cada ~10 minutos no GitHub Actions:
1. lê config.json e o estado salvo em data/estado.json
2. busca os candles de 1 minuto da SOL desde a última rodada
3. passa cada candle pelo grid (compras e vendas simuladas, com taxa)
4. salva tudo de volta em data/estado.json (o painel lê esse arquivo)
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import dados  # noqa: E402
from grid import Grid  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQ_CONFIG = os.path.join(RAIZ, "config.json")
ARQ_ESTADO = os.path.join(RAIZ, "data", "estado.json")
MAX_DIAS_GRAFICO = 60
MAX_TRADES = 3000


def assinatura(cfg: dict) -> str:
    chaves = ("linhas", "faixa_abaixo_pct", "faixa_acima_pct", "tipo", "recentrar_apos_horas",
              "preco_min", "preco_max")
    return hashlib.sha1(json.dumps({k: cfg.get(k) for k in chaves}, sort_keys=True).encode()).hexdigest()[:10]


def carregar(caminho, padrao=None):
    try:
        with open(caminho) as f:
            return json.load(f)
    except FileNotFoundError:
        return padrao


def agrega_15m(barras: list, c):
    """Junta candles de 1m em candles de 15m pro gráfico."""
    t = c[0] - c[0] % 900
    if barras and barras[-1][0] == t:
        b = barras[-1]
        b[2] = max(b[2], c[2])
        b[3] = min(b[3], c[3])
        b[4] = c[4]
    else:
        barras.append([t, c[1], c[2], c[3], c[4]])


def main():
    config = carregar(ARQ_CONFIG)
    cfg = config["ao_vivo"]
    taxa = float(config.get("taxa_pct", 0.1))
    saldo = float(config.get("saldo_inicial_usd", 20))
    sessao = config.get("sessao", 1)
    estado = carregar(ARQ_ESTADO)
    agora = int(time.time())

    novo = (estado is None or estado.get("sessao") != sessao
            or float(estado.get("saldo_inicial", -1)) != saldo)

    if novo:
        recentes, fonte = dados.candles(agora - 15 * 60, agora, 60)
        ultimo = recentes[-1]
        preco, t = ultimo[4], ultimo[0] + 60
        grid = Grid(cfg, taxa, saldo)
        grid.montar(preco, t, motivo="inicio")
        estado = {
            "sessao": sessao, "saldo_inicial": saldo, "taxa_pct": taxa,
            "iniciado_em": t, "preco_inicial": preco, "ultimo_t": t,
            "assinatura": assinatura(cfg), "config": cfg, "fonte": fonte,
            "grid": None, "trades": [], "eventos": [], "curva": [], "candles": [],
            "rodadas": 0, "erros": [],
        }
        print(f"Nova sessão {sessao}: preço {preco:.2f}, faixa {grid.niveis[0]:.2f}–{grid.niveis[-1]:.2f}")
    else:
        grid = Grid.from_dict(estado["grid"], cfg, taxa)
        if estado.get("assinatura") != assinatura(cfg):
            preco = estado["curva"][-1][1] if estado["curva"] else estado["preco_inicial"]
            grid.montar(preco, estado["ultimo_t"], motivo="reconfigurado")
            estado["assinatura"] = assinatura(cfg)
            estado["config"] = cfg
            print("Configuração mudou: grid remontado com o patrimônio atual.")

    # ---- processa os candles novos
    try:
        novos, fonte = dados.candles(estado["ultimo_t"], agora, 60)
    except Exception as e:  # noqa: BLE001
        novos, fonte = [], None
        estado["erros"] = (estado.get("erros", []) + [{"t": agora, "erro": str(e)[:300]}])[-20:]
        print("Erro ao buscar preços:", e)

    for c in novos:
        grid.processar_candle(*c)
        agrega_15m(estado["candles"], c)
    if novos:
        estado["ultimo_t"] = novos[-1][0] + 60
        estado["fonte"] = fonte
        preco = novos[-1][4]
    else:
        preco = estado["curva"][-1][1] if estado["curva"] else estado["preco_inicial"]

    estado["rodadas"] = estado.get("rodadas", 0) + 1
    estado["trades"] = (estado["trades"] + grid.trades)[-MAX_TRADES:]
    estado["eventos"] = (estado["eventos"] + grid.eventos)[-200:]
    estado["curva"].append([estado["ultimo_t"], round(preco, 4), round(grid.patrimonio(preco), 6)])
    corte = estado["ultimo_t"] - MAX_DIAS_GRAFICO * 86400
    estado["curva"] = [p for p in estado["curva"] if p[0] >= corte]
    estado["candles"] = [b for b in estado["candles"] if b[0] >= corte]
    estado["grid"] = grid.to_dict()
    estado["atualizado_em"] = agora

    os.makedirs(os.path.dirname(ARQ_ESTADO), exist_ok=True)
    with open(ARQ_ESTADO, "w") as f:
        json.dump(estado, f, separators=(",", ":"))
    print(f"{len(novos)} candles novos | preço {preco:.2f} | patrimônio US$ {grid.patrimonio(preco):.4f} "
          f"| compras {grid.n_compras} vendas {grid.n_vendas} | lucro grid {grid.lucro_grid:.4f}")


if __name__ == "__main__":
    main()
