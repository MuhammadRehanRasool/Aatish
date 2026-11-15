"""PERS forecast core (numpy only), shared by pipeline/forecast_fit.py and the API.

Model chosen in the 2026-11-14 bake-off (pipeline/explore/forecast_bakeoff.py, docs/plan.md §7):
    log1p(y[T+h]) = clim10(T+h) + b0 + b1 * a1(T) + b2 * a12(T)
where clim10(t) = mean log1p of the same calendar month over the 10 most recent years observed by the origin,
a1 = last month's log anomaly vs its own clim10, a12 = mean log anomaly over the last 12 months.
Coefficients are pooled (country + 1-degree cells), one set per horizon h = 1..3.
The 80% band comes from out-of-sample rolling-origin residuals bucketed by the predicted count.
"""
from __future__ import annotations

import numpy as np

H = 3
CLIM_K = 10
BUCKETS = [(0, 2, "<2"), (2, 5, "2-5"), (5, 20, "5-20"), (20, 100, "20-100"), (100, 1000, "100-1000"),
           (1000, float("inf"), ">=1000")]


def same_moy_prior(t_target: int, t_origin: int, k: int | None = CLIM_K) -> list[int]:
    idx = [i for i in range(t_target - 12, -1, -12) if i <= t_origin]
    return idx[:k] if k else idx


def clim_log(L: np.ndarray, t_target: int, t_origin: int, k: int = CLIM_K) -> np.ndarray:
    idx = same_moy_prior(t_target, t_origin, k)
    if not idx:
        return np.full(L.shape[0], np.nan)
    return L[:, idx].mean(axis=1)


def feats(L: np.ndarray, t0: int) -> np.ndarray:
    a1 = L[:, t0] - clim_log(L, t0, t0 - 1)
    a12 = np.mean([L[:, t0 - j] - clim_log(L, t0 - j, t0 - j - 1) for j in range(12)], axis=0)
    return np.c_[np.ones(L.shape[0]), a1, a12]


def fit(L: np.ndarray, t_first: int, t0: int) -> dict[int, np.ndarray]:
    """Pooled OLS per horizon on all origins t_first..t0-h (targets observed by t0)."""
    co = {}
    for h in range(1, H + 1):
        X, y = [], []
        for t in range(t_first, t0 - h + 1):
            X.append(feats(L, t)); y.append(L[:, t + h] - clim_log(L, t + h, t))
        X, y = np.vstack(X), np.concatenate(y)
        ok = np.isfinite(X).all(axis=1) & np.isfinite(y)
        co[h] = np.linalg.lstsq(X[ok], y[ok], rcond=None)[0]
    return co


def point_log(L: np.ndarray, t0: int, co: dict[int, np.ndarray]) -> np.ndarray:
    """(S, H) forecast in log1p space."""
    F = feats(L, t0)
    return np.stack([clim_log(L, t0 + h, t0) + F @ co[h] for h in range(1, H + 1)], axis=1)


def bucket(count: float) -> str:
    for lo, hi, name in BUCKETS:
        if lo <= count < hi:
            return name
    return BUCKETS[-1][2]
