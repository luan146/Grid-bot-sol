"""
Busca candles da SOL em APIs públicas (sem chave nenhuma).
Ordem de tentativa: Coinbase → Kraken → Binance (data-api).
Formato devolvido: lista de (t_inicio_unix, open, high, low, close), em ordem crescente, só candles fechados.
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime, timezone

UA = {"User-Agent": "grid-bot-sol/1.0 (simulacao educativa)"}


def _get(url: str, tentativas: int = 4):
    erro = None
    for k in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            erro = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"falhou {url}: {erro}")


def _iso(t: int) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def coinbase(inicio: int, fim: int, seg: int, produto="SOL-USD"):
    out = {}
    passo = seg * 300
    t = inicio
    while t < fim:
        t2 = min(t + passo, fim)
        url = (f"https://api.exchange.coinbase.com/products/{produto}/candles"
               f"?granularity={seg}&start={_iso(t)}&end={_iso(t2)}")
        for row in _get(url):
            ts, lo, hi, op, cl = int(row[0]), *map(float, row[1:5])
            out[ts] = (ts, op, hi, lo, cl)
        t = t2
        time.sleep(0.12)
    return [out[k] for k in sorted(out)]


def kraken(inicio: int, fim: int, seg: int, par="SOLUSD"):
    url = f"https://api.kraken.com/0/public/OHLC?pair={par}&interval={seg // 60}&since={inicio - 1}"
    d = _get(url)
    if d.get("error"):
        raise RuntimeError(d["error"])
    chave = [k for k in d["result"] if k != "last"][0]
    out = []
    for row in d["result"][chave]:
        ts = int(row[0])
        if inicio <= ts < fim:
            out.append((ts, float(row[1]), float(row[2]), float(row[3]), float(row[4])))
    return out


def binance(inicio: int, fim: int, seg: int, par="SOLUSDT"):
    intervalo = {60: "1m", 300: "5m", 900: "15m", 3600: "1h"}[seg]
    out = {}
    t = inicio
    while t < fim:
        url = (f"https://data-api.binance.vision/api/v3/klines?symbol={par}&interval={intervalo}"
               f"&startTime={t * 1000}&endTime={fim * 1000 - 1}&limit=1000")
        rows = _get(url)
        if not rows:
            break
        for r in rows:
            ts = int(r[0]) // 1000
            out[ts] = (ts, float(r[1]), float(r[2]), float(r[3]), float(r[4]))
        t = int(rows[-1][0]) // 1000 + seg
        time.sleep(0.1)
    return [out[k] for k in sorted(out)]


def candles(inicio: int, fim: int | None = None, seg: int = 60):
    """Candles fechados no intervalo [inicio, fim). Tenta as fontes em ordem."""
    agora = int(time.time())
    fim = min(fim or agora, agora - agora % seg)  # nunca usa o candle ainda aberto
    inicio = inicio - inicio % seg
    if inicio >= fim:
        return [], None
    fontes = [("coinbase", coinbase), ("kraken", kraken), ("binance", binance)]
    erros = []
    for nome, f in fontes:
        if nome == "kraken" and (fim - inicio) / seg > 700:
            continue  # kraken só devolve os 720 candles mais recentes
        try:
            dados = [c for c in f(inicio, fim, seg) if inicio <= c[0] < fim]
            if dados:
                return dados, nome
        except Exception as e:  # noqa: BLE001
            erros.append(f"{nome}: {e}")
    if erros:
        raise RuntimeError("; ".join(erros))
    return [], None
