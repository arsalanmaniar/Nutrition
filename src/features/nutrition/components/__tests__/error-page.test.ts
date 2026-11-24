import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import NutritionError from '@/app/(nutrition)/nutrition/error'

// The nutrition error page must not show anything about the error (plan:
// Decisions, Step 3d outcome, item 5), whatever Next.js passes it.

describe('the nutrition error page', () => {
  it('shows no message, stack or digest, only a way back home', () => {
    const error = Object.assign(new Error('relation "nutr_case_log" does not exist (db.internal:5432)'), {
      digest: 'DIGEST-4242',
    })
    const page = NutritionError as unknown as (props: Record<string, unknown>) => ReactElement
    const html = renderToStaticMarkup(createElement(page, { error, unstable_retry: () => {}, reset: () => {} }))

    expect(html).toContain('Something went wrong')
    expect(html).toMatch(/<a [^>]*href="\/nutrition"[^>]*>Back to home<\/a>/)
    for (const detail of [error.message, 'nutr_case_log', 'db.internal', 'DIGEST-4242', 'Error:', ' at ']) {
      expect(html).not.toContain(detail)
    }
  })
})
