import { Briefing } from '@/components/home/Briefing'
import { Hero } from '@/components/home/Hero'
import { SensorIllusion } from '@/components/home/SensorIllusion'
import { CalendarFigure, FinalCta, Impact, MarqueeBand, Method, Problem, ProofNumbers } from '@/components/home/Sections'

export default function Home() {
  return (
    <>
      <Hero />
      <SensorIllusion />
      <Briefing />
      <ProofNumbers />
      <MarqueeBand />
      <Problem />
      <Method />
      <CalendarFigure />
      <Impact />
      <FinalCta />
    </>
  )
}
