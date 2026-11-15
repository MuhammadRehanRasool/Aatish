import { Button, Kicker, Rich } from '@/components/primitives'

export default function NotFound() {
  return (
    <section className="container-page flex min-h-[80vh] flex-col justify-center pb-20 pt-32">
      <Kicker index="404">Not found</Kicker>
      <h1 className="rise mt-6 text-d1 font-bold">
        <span>
          <Rich text="No detections *here*." />
        </span>
      </h1>
      <p className="mt-6 max-w-xl text-lede text-ink-2">This page does not exist. Unlike an outage, though, that really does mean there is nothing to count.</p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Button href="/explore">Open the calendar</Button>
        <Button href="/" variant="ghost">
          Home
        </Button>
      </div>
    </section>
  )
}
