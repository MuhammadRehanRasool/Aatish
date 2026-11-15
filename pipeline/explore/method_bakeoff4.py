"""Round 4: ensemble of physics weight + GBM (LOYO), and physics weight transfer to NOAA-20."""
import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).parent))
import numpy as np, pandas as pd
src = (pathlib.Path(__file__).parent / "method_bakeoff3.py").read_text(encoding="utf-8")
exec(src.split("# ---------------- R1 + R2 under LOYO")[0])  # matched flag + helpers
years = sorted(T.year.unique())
H = {k: pd.Series(np.nan, index=T.index) for k in ("phys+moy+local", "GBM", "ens(phys,GBM)")}
for yr in years:
    tr, te = T[T.year != yr], T[T.year == yr]
    phys = pd.Series(physics_feature([y for y in years if y != yr]), index=T.index)
    btr, bte = fit_pred_phys(tr, te, phys)
    a = local_adj(tr, te, btr, bte); g = m_gbm(tr, te)
    H["phys+moy+local"].loc[te.index] = a; H["GBM"].loc[te.index] = g; H["ens(phys,GBM)"].loc[te.index] = (a + g) / 2
print(pd.DataFrame([evaluate(T, h.values, k)[0] for k, h in H.items()]).to_string(index=False))
# NOAA-20 transfer of the physics weight: P(frp,dn) and f/L fitted on S-NPP 2012-2017, applied to N20 points
tr = T[T.year <= 2017]
pr = Vh[Vh.year <= 2017].groupby(["fb2", "dn"]).hit.mean()
phys_tr = pd.Series(physics_feature(list(range(2012, 2018))), index=T.index)[tr.index].values
g = tr.assign(b=phys_tr).groupby(["dn", "moy"])[["m", "b"]].sum(); f = g.m / g.b
N = V20.assign(fb2=pd.cut(V20.frp, FB, right=False, labels=False))
N["pw"] = pr.reindex(pd.MultiIndex.from_frame(N[["fb2", "dn"]])).values
m20 = M[M.date >= "2018-04-01"].groupby(K).size().rename("m")
T20b = pd.concat([m20, N.groupby(K).pw.sum()], axis=1).fillna(0).reset_index()
bte = T20b.pw.values * f.reindex(pd.MultiIndex.from_frame(T20b[["dn", "moy"]])).values
btr = phys_tr * f.reindex(pd.MultiIndex.from_frame(tr[["dn", "moy"]])).values
print("phys N20 transfer:", evaluate(T20b, local_adj(tr, T20b, btr, bte), "phys+moy+local N20")[0])
print("P(MODIS-Aqua detects | S-NPP FRP bin, dn), all years:\n", Vh.groupby(["fb2", "dn"]).hit.mean().unstack().round(3).rename(index=dict(enumerate(["<1", "1-2", "2-4", "4-8", "8-16", "16-32", ">=32"]))).to_string())
