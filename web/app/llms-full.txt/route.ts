import { site } from '@/lib/content'
import { MONTHS, pakistan } from '@/lib/data'
import { llmsSummary } from '@/lib/llms'

/** Long form: the summary, the method in prose, and the full Pakistan monthly table. */
export function GET() {
  const steps = site.method.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.body}`).join('\n')
  const problem = site.problem.points.map((p) => `- ${p.title}: ${p.body}`).join('\n')
  const years = Array.from(new Set(pakistan.months.map((m) => m.year)))
  const table = [
    `year,${MONTHS.join(',')},complete_year_total`,
    ...years.map((y) => {
      const row = MONTHS.map((_, i) => pakistan.months.find((m) => m.year === y && m.month === i + 1)?.value.toFixed(1) ?? '')
      const yt = pakistan.stats.yearly.find((r) => r.year === y)
      return `${y},${row.join(',')},${yt ? yt.value.toFixed(0) : ''}`
    }),
  ].join('\n')
  const body = `${llmsSummary()}
## The problem
${problem}

## The method
${steps}

## Pakistan, monthly MODIS-equivalent detections (${pakistan.data_extent.from} to ${pakistan.data_extent.to}; months from ${pakistan.months.find((m) => m.provisional)?.ym ?? 'n/a'} are provisional NRT)
\`\`\`csv
${table}
\`\`\`
`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
