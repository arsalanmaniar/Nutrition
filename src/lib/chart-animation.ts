'use client'

import { useMemo } from 'react'
import { useReducedMotion } from '@/lib/use-reduced-motion'

/**
 * Entrance animation for every Recharts series in the admin.
 *
 * One definition keeps timing identical across Dashboard, Analytics, Log Book
 * and MDT, so charts on the same page never draw at different speeds.
 *
 * Recharts animates in JavaScript, so a CSS media query cannot switch it off.
 * Instead every helper reports `isAnimationActive: false` when the viewer has
 * asked for reduced motion, and the chart renders in its finished state.
 */
export function useChartAnimation() {
  const reduced = useReducedMotion()

  return useMemo(() => {
    const active = !reduced

    return {
      active,

      /**
       * Bars grow from the baseline. `series` staggers stacked or grouped
       * charts — series 0 starts at once, each later one 150ms behind, which
       * reads as the stack filling upwards.
       */
      bar(series = 0) {
        return {
          isAnimationActive: active,
          animationBegin: active ? series * 150 : 0,
          animationDuration: 900,
          animationEasing: 'ease-out' as const,
          // Recharts brightens the hovered bar rather than recolouring it, so
          // this works whatever fill the series uses.
          activeBar: { filter: 'brightness(1.1)' },
        }
      },

      /** Lines draw left to right, with dots that grow under the cursor. */
      line(color?: string) {
        return {
          isAnimationActive: active,
          animationBegin: 0,
          animationDuration: 1200,
          animationEasing: 'ease-in-out' as const,
          dot: { r: 4, strokeWidth: 2, ...(color ? { fill: color } : {}) },
          activeDot: { r: 6, strokeWidth: 0 },
        }
      },

      /** Slices fan out from the centre, with a hairline gap between them. */
      pie() {
        return {
          isAnimationActive: active,
          animationBegin: active ? 100 : 0,
          animationDuration: 800,
          animationEasing: 'ease-out' as const,
          paddingAngle: 2,
        }
      },
    }
  }, [reduced])
}
