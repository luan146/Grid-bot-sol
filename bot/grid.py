"""
Motor do grid bot (simulação / paper trading).

Como funciona:
- A faixa [preco_min, preco_max] é dividida em N "células" (linhas do grid).
- Cada célula i fica entre os níveis L[i] e L[i+1] e está sempre em um de dois estados:
    "compra": tem dólar reservado e uma ordem de COMPRA esperando em L[i]
    "venda":  tem SOL e uma ordem de VENDA esperando em L[i+1]
- Quando o preço desce e toca L[i], a célula compra; quando sobe e toca L[i+1], vende.
  Cada ida-e-volta embolsa a distância entre as linhas, menos as taxas.
- Se o preço sai da faixa, o grid para de lucrar. Opcionalmente ele se "recentra"
  depois de X horas fora da faixa (fecha tudo a mercado e remonta em volta do preço atual).

Tudo aqui é determinístico e roda igual no bot ao vivo e no backtest.
"""
from __future__ import annotations

import math
from bisect import bisect_left, bisect_right


def montar_niveis(preco_min: float, preco_max: float, n: int, tipo: str = "geometrico") -> list[float]:
    if tipo == "aritmetico":
        passo = (preco_max - preco_min) / n
        return [preco_min + passo * k for k in range(n + 1)]
    r = (preco_max / preco_min) ** (1.0 / n)
    return [preco_min * r ** k for k in range(n + 1)]


def faixa_do_config(grid_cfg: dict, preco: float) -> tuple[float, float]:
    """Faixa absoluta a partir do config (percentual em volta do preço, ou valores fixos)."""
    lo = grid_cfg.get("preco_min")
    hi = grid_cfg.get("preco_max")
    if lo and hi:
        return float(lo), float(hi)
    abaixo = float(grid_cfg.get("faixa_abaixo_pct", 15)) / 100
    acima = float(grid_cfg.get("faixa_acima_pct", 15)) / 100
    return preco * (1 - abaixo), preco * (1 + acima)


class Grid:
    def __init__(self, grid_cfg: dict, taxa_pct: float, usd: float, sol: float = 0.0,
                 registrar=True):
        self.cfg = grid_cfg
        self.taxa = taxa_pct / 100.0
        self.usd = usd
        self.sol = sol
        self.niveis: list[float] = []
        self.q: list[float] = []          # quantidade de SOL de cada célula
        self.estado: list[str] = []       # "compra" | "venda"
        self.custo: list[float] = []      # preço pago na compra (pra calcular lucro da célula)
        self.lucro_grid = 0.0             # lucro realizado em idas-e-voltas (já sem taxas)
        self.taxas_pagas = 0.0
        self.trades: list[dict] = []
        self.eventos: list[dict] = []
        self.registrar = registrar
        self.fora_desde: float | None = None
        self.n_compras = 0
        self.n_vendas = 0

    # ------------------------------------------------------------------ montagem
    def montar(self, preco: float, t: float, motivo: str = "inicio"):
        n = int(self.cfg.get("linhas", 10))
        lo, hi = faixa_do_config(self.cfg, preco)
        self.niveis = montar_niveis(lo, hi, n, self.cfg.get("tipo", "geometrico"))
        patrimonio = self.usd + self.sol * preco
        cap = patrimonio / n
        self.q, self.estado, self.custo = [], [], []
        sol_necessario = 0.0
        for i in range(n):
            li, lj = self.niveis[i], self.niveis[i + 1]
            if li > preco:
                # célula inteira acima do preço: precisa ter SOL, vende em L[i+1]
                q = cap / (preco * (1 + self.taxa)) * 0.999
                self.estado.append("venda")
                self.custo.append(preco)
                sol_necessario += q
            else:
                # célula abaixo (ou contendo) o preço: espera comprar em L[i]
                q = cap / (li * (1 + self.taxa)) * 0.999
                self.estado.append("compra")
                self.custo.append(0.0)
            self.q.append(q)
        # ajusta a carteira a mercado pra ter exatamente o SOL que as células de venda precisam
        dif = sol_necessario - self.sol
        if dif > 1e-12:
            custo = dif * preco * (1 + self.taxa)
            if custo > self.usd:  # segurança: nunca fica negativo
                fator = self.usd / custo
                dif *= fator
                custo = self.usd
                self.q = [q * fator if e == "venda" else q for q, e in zip(self.q, self.estado)]
            self.usd -= custo
            self.sol += dif
            self.taxas_pagas += dif * preco * self.taxa
            self._log(t, "compra_inicial", preco, dif, None)
        elif dif < -1e-12:
            vend = -dif
            self.usd += vend * preco * (1 - self.taxa)
            self.sol -= vend
            self.taxas_pagas += vend * preco * self.taxa
            self._log(t, "venda_ajuste", preco, vend, None)
        self.fora_desde = None
        self.eventos.append({"t": t, "tipo": motivo, "preco": round(preco, 4),
                             "min": round(self.niveis[0], 4), "max": round(self.niveis[-1], 4),
                             "patrimonio": round(self.usd + self.sol * preco, 6)})

    def _log(self, t, lado, preco, qtd, lucro, celula=None):
        if not self.registrar:
            return
        self.trades.append({"t": int(t), "lado": lado, "preco": round(preco, 4),
                            "qtd": round(qtd, 6), "usd": round(qtd * preco, 4),
                            "lucro": None if lucro is None else round(lucro, 6),
                            "celula": celula})

    # ------------------------------------------------------------------ execução
    def _descer(self, a: float, b: float, t: float):
        """Preço indo de a até b (b < a): executa compras em níveis L[i] com b <= L[i] < a."""
        n = len(self.q)
        i0 = bisect_left(self.niveis, b)
        i1 = min(bisect_left(self.niveis, a), n)
        for i in range(i1 - 1, i0 - 1, -1):
            if self.estado[i] == "compra":
                li = self.niveis[i]
                q = self.q[i]
                custo = q * li * (1 + self.taxa)
                if custo > self.usd + 1e-9:
                    continue
                self.usd -= custo
                self.sol += q
                self.taxas_pagas += q * li * self.taxa
                self.estado[i] = "venda"
                self.custo[i] = li
                self.n_compras += 1
                self._log(t, "compra", li, q, None, i)

    def _subir(self, a: float, b: float, t: float):
        """Preço indo de a até b (b > a): executa vendas em níveis L[i+1] com a < L[i+1] <= b."""
        n = len(self.q)
        j0 = bisect_right(self.niveis, a)
        j1 = bisect_right(self.niveis, b)
        for j in range(max(j0, 1), min(j1, n + 1)):
            i = j - 1
            if self.estado[i] == "venda":
                lj = self.niveis[j]
                q = min(self.q[i], self.sol)
                receita = q * lj * (1 - self.taxa)
                lucro = receita - q * self.custo[i] * (1 + self.taxa)
                self.usd += receita
                self.sol -= q
                self.taxas_pagas += q * lj * self.taxa
                self.lucro_grid += lucro
                self.estado[i] = "compra"
                self.n_vendas += 1
                self._log(t, "venda", lj, q, lucro, i)

    def processar_candle(self, t: float, o: float, h: float, l: float, c: float):
        """Simula o caminho do preço dentro do candle: alta O→L→H→C, baixa O→H→L→C."""
        caminho = (o, l, h, c) if c >= o else (o, h, l, c)
        for a, b in zip(caminho, caminho[1:]):
            if b < a:
                self._descer(a, b, t)
            elif b > a:
                self._subir(a, b, t)
        self._checar_faixa(t, c)

    def _checar_faixa(self, t: float, preco: float):
        horas = float(self.cfg.get("recentrar_apos_horas", 0) or 0)
        fora = preco < self.niveis[0] or preco > self.niveis[-1]
        if not fora:
            self.fora_desde = None
            return
        if self.fora_desde is None:
            self.fora_desde = t
        if horas > 0 and (t - self.fora_desde) >= horas * 3600:
            self.montar(preco, t, motivo="recentrado")

    # ------------------------------------------------------------------ leitura
    def patrimonio(self, preco: float) -> float:
        return self.usd + self.sol * preco

    def fora_da_faixa(self, preco: float) -> bool:
        return preco < self.niveis[0] or preco > self.niveis[-1]

    def to_dict(self) -> dict:
        return {"usd": self.usd, "sol": self.sol, "niveis": self.niveis, "q": self.q,
                "estado": self.estado, "custo": self.custo, "lucro_grid": self.lucro_grid,
                "taxas_pagas": self.taxas_pagas, "fora_desde": self.fora_desde,
                "n_compras": self.n_compras, "n_vendas": self.n_vendas}

    @classmethod
    def from_dict(cls, d: dict, grid_cfg: dict, taxa_pct: float) -> "Grid":
        g = cls(grid_cfg, taxa_pct, d["usd"], d["sol"])
        for k in ("niveis", "q", "estado", "custo", "lucro_grid", "taxas_pagas",
                  "fora_desde", "n_compras", "n_vendas"):
            setattr(g, k, d.get(k, getattr(g, k)))
        return g


def espacamento_pct(grid_cfg: dict) -> float:
    """Distância entre duas linhas vizinhas, em % (para grid geométrico)."""
    n = int(grid_cfg.get("linhas", 10))
    a = float(grid_cfg.get("faixa_abaixo_pct", 15)) / 100
    b = float(grid_cfg.get("faixa_acima_pct", 15)) / 100
    return ((1 + b) / (1 - a)) ** (1 / n) * 100 - 100


def simular(candles, grid_cfg: dict, taxa_pct: float, saldo: float, registrar=False,
            amostra_seg: int = 3600):
    """Roda o grid sobre uma lista de candles (t,o,h,l,c). Devolve o grid e a curva de patrimônio."""
    g = Grid(grid_cfg, taxa_pct, saldo, registrar=registrar)
    t0, o0 = candles[0][0], candles[0][1]
    g.montar(o0, t0)
    curva = []
    prox = t0
    for t, o, h, l, c in candles:
        g.processar_candle(t, o, h, l, c)
        if t >= prox:
            curva.append((t, c, g.patrimonio(c)))
            prox = t + amostra_seg
    t, _, _, _, c = candles[-1]
    curva.append((t, c, g.patrimonio(c)))
    return g, curva


def max_drawdown(valores) -> float:
    pico, pior = -math.inf, 0.0
    for v in valores:
        pico = max(pico, v)
        if pico > 0:
            pior = min(pior, v / pico - 1)
    return pior
