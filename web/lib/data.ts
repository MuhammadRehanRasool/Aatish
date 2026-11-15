import calib from '@/content/data/calibration_summary.json'
import overlap from '@/content/data/overlap_pakistan.json'
import calendar from '@/content/data/pakistan_calendar.json'
import regions from '@/content/data/regions_summary.json'

/** Pre-rendered outputs of api/export_static.py (same code path as the live API). */
export type Month = {
  ym: string
  year: number
  month: number
  value: number
  lo: number
  hi: number
  role: string
  provisional: boolean
  pct: number | null
  gap_days: number
  days_covered: number
  days_in_month: number
}

export type Anomaly = {
  month: number
  year: number
  window: string
  value: number
  lo: number
  hi: number
  baseline_years: [number, number]
  baseline_n: number
  median: number
  pct: number
  rank: number
  of: number
  ratio: number | null
  diff: number
  provisional: boolean
  series?: { year: number; value: number }[]
}

export type Trend = {
  years: [number, number]
  pct_per_year: number
  total_change_pct: number
  mann_kendall_p: number
  band_halfwidth_pct: number
  claim: boolean
}

export type WorstYear = { year: number; value: number; clear: boolean; wording: string; runner_up: number | null }
export type PeakMonth = { month: number; median: number; share_pct: number | null }

export const pakistan = calendar as unknown as {
  range: { from: string; to: string }
  data_extent: { from: string; to: string }
  unit_label: string
  months: Month[]
  stats: {
    total: number
    total_lo: number
    total_hi: number
    complete_years: number
    yearly: { year: number; value: number; lo: number; hi: number; provisional: boolean }[]
    worst_year?: WorstYear
    peak_month?: PeakMonth
    climatology?: { month: number; median: number }[]
    trend?: Trend | null
  }
  anomaly: Anomaly | null
}

export const regionSummary = regions as unknown as Record<
  string,
  { label: string; total: number; worst_year: WorstYear | null; peak_month: PeakMonth | null; trend: Trend | null; anomaly: Partial<Anomaly> }
>

export const overlapPk = overlap as unknown as {
  months: { ym: string; modis_observed: number; viirs_derived: number; terra: number | null; aqua: number | null; fit_window: boolean }[]
  note: string
}

export const calibration = calib as unknown as {
  unit: string
  method: string
  fit_window: [string, string]
  match_radius_km: number
  shrinkage_k: number
  frp_bins_mw: (number | null)[]
  P_aqua: { frp_bin: string; daynight: 'D' | 'N'; value: number }[]
  f: { daynight: 'D' | 'N'; moy: number; value: number }[]
  f_sat: Record<string, number>
  frp_scale?: Record<string, number>
  terra_scaling: { factor_by_moy: Record<string, number>; fit_years: [number, number] }
  filters: { modis_conf_min: number; viirs_conf: string[]; static_info: { viirs_cells: number; modis_cells: number; union_cells: number } }
  validation: {
    loyo_merged: {
      country_month: Metric
      cell1_month: Metric
      yearly_bias_pct: Record<string, number>
      anomaly_skill_country_month: {
        anomaly_R2: number
        anomaly_corr: number
        pctl_err_mean_pp: number
        pctl_err_p90_pp: number
        above_below_median_agreement_pct: number
        same_worst_year_months: string
      }
    }
    band_by_count: Record<string, { q10: number; q90: number; n: number; nested_80pct_coverage: number }>
    forward: { country_month: Metric; cell1_month: Metric }
    n20_transfer_no_factor: { country_month: Metric }
    n20_transfer_with_f_sat: { country_month: Metric }
    noise_floor: number
  }
  rows_total: number
  series_rows: number
}

type Metric = { bias_pct: number; MdAPE: number; RMSLE: number; R2: number; n: number }

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}
