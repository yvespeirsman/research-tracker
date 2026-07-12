'use client'

import { useEffect, useRef, useState } from 'react'
import type { MonthCount } from '@/lib/queries'

const SLOT_WIDTH = 10
const BAR_WIDTH = 8
const BAR_RADIUS = 4
const PLOT_HEIGHT = 110
/** Reserves room above the bars for the hover tooltip, so it never gets
 * clipped by the horizontally-scrolling container. */
const TOP_PAD = 28
/** Same idea, sideways: room for the first/last bar's tooltip to stay
 * centered without its edge falling outside the scrollable content. */
const SIDE_PAD = 60

function formatMonth(month: string): string {
  const [year, mm] = month.split('-').map(Number)
  return new Date(year, mm - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
}

/** Round up to a clean-looking axis max: 5, or a multiple of a nice step. */
function niceMax(n: number): number {
  if (n <= 5) return 5
  const magnitude = 10 ** Math.floor(Math.log10(n))
  const step = magnitude / 2
  return Math.ceil(n / step) * step
}

function roundedTopRectPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(BAR_RADIUS, h, w / 2)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

/** A month-by-month bar chart of a topic's papers, by arXiv submission month. */
export function PapersByMonthChart({ data }: { data: MonthCount[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [data])

  if (data.length === 0) return null

  const max = niceMax(Math.max(...data.map((d) => d.count)))
  const width = data.length * SLOT_WIDTH
  const active = hovered !== null ? data[hovered] : null

  const yearTicks = data
    .map((d, i) => ({ i, month: d.month }))
    .filter(({ i, month }) => i === 0 || month.slice(5) === '01')

  return (
    <div className="flex gap-2 text-xs text-black/40 dark:text-white/40">
      <div
        className="flex shrink-0 flex-col justify-between py-0.5"
        style={{ height: PLOT_HEIGHT, marginTop: TOP_PAD }}
      >
        <span>{max}</span>
        <span>0</span>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative" style={{ width: width + SIDE_PAD * 2, paddingTop: TOP_PAD }}>
          {active && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-black/10 bg-background px-2 py-1 shadow-sm dark:border-white/15"
              style={{ left: SIDE_PAD + hovered! * SLOT_WIDTH + SLOT_WIDTH / 2 }}
            >
              <span className="font-medium text-black dark:text-white">{active.count}</span>{' '}
              paper{active.count === 1 ? '' : 's'} · {formatMonth(active.month)}
            </div>
          )}

          <svg
            width={width}
            height={PLOT_HEIGHT}
            className="block overflow-visible"
            style={{ marginLeft: SIDE_PAD }}
          >
            <line
              x1={0}
              y1={PLOT_HEIGHT}
              x2={width}
              y2={PLOT_HEIGHT}
              className="stroke-black/15 dark:stroke-white/15"
              strokeWidth={1}
            />

            {data.map((d, i) => {
              const barHeight = d.count === 0 ? 0 : Math.max((d.count / max) * PLOT_HEIGHT, 2)
              const x = i * SLOT_WIDTH + (SLOT_WIDTH - BAR_WIDTH) / 2
              const y = PLOT_HEIGHT - barHeight

              return (
                <g key={d.month}>
                  {barHeight > 0 && (
                    <path
                      d={roundedTopRectPath(x, y, BAR_WIDTH, barHeight)}
                      className={hovered === i ? 'fill-blue-600 dark:fill-blue-300' : 'fill-blue-500'}
                    />
                  )}
                  <rect
                    x={i * SLOT_WIDTH}
                    y={0}
                    width={SLOT_WIDTH}
                    height={PLOT_HEIGHT}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${formatMonth(d.month)}: ${d.count} paper${d.count === 1 ? '' : 's'}`}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                  />
                </g>
              )
            })}
          </svg>

          <div className="relative mt-1" style={{ width, height: 14, marginLeft: SIDE_PAD }}>
            {yearTicks.map(({ i, month }) => (
              <span key={month} className="absolute" style={{ left: i * SLOT_WIDTH }}>
                {month.slice(0, 4)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
