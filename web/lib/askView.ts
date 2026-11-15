/** What the user is looking at right now, shared with the "Ask anything" assistant (set by the explorer). */
export type AskView = { aoi?: string; aoi_label?: string; ym?: string | null; page?: string }

let current: AskView = {}

export const setAskView = (v: AskView) => {
  current = v
}
export const getAskView = (): AskView => current
