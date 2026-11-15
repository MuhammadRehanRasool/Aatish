"""Audit raw FIRMS country CSVs: coverage, gaps, versions, extent."""
import sys, glob, os
import pandas as pd

root = sys.argv[1]
rows = []
for f in sorted(glob.glob(os.path.join(root, '*', '*_Pakistan.csv'))):
    d = pd.read_csv(f, dtype={'acq_time': str, 'confidence': str, 'version': str})
    dt = pd.to_datetime(d.acq_date)
    yr = int(os.path.basename(f).split('_')[1])
    months = set(dt.dt.month)
    exp = range(11, 13) if (yr == 2000 and 'modis' in f) else range(1, 13)
    missing_m = [m for m in exp if m not in months]
    # days with zero detections in the year (just a count; zero days can be genuine)
    rows.append(dict(file=os.path.basename(f), n=len(d), first=dt.min().date(), last=dt.max().date(),
                     missing_months=missing_m, versions=','.join(sorted(d.version.unique())),
                     sats=','.join(sorted(d.satellite.astype(str).unique())),
                     types=','.join(map(str, sorted(d.type.unique()))),
                     conf=('num' if d.confidence.str.isnumeric().all() else ','.join(sorted(d.confidence.unique()))),
                     dupes=int(d.duplicated().sum()),
                     lat=f"{d.latitude.min():.2f}..{d.latitude.max():.2f}", lon=f"{d.longitude.min():.2f}..{d.longitude.max():.2f}"))
pd.set_option('display.width', 250); pd.set_option('display.max_columns', 20); pd.set_option('display.max_rows', 100)
print(pd.DataFrame(rows).to_string(index=False))
