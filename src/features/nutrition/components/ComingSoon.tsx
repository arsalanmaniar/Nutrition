import { portalPage } from './navigation'

/** The body of a portal page whose plan step has not been built yet. */
export function ComingSoon({ href, greeting }: { href: string; greeting?: string }) {
  const { page, section } = portalPage(href)
  return (
    <section className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section}</p>
      <h1 className="mt-1 text-2xl font-bold text-gray-900">{page.label}</h1>
      {greeting && <p className="mt-1 text-sm text-gray-600">Welcome, {greeting}.</p>}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <p className="font-medium text-gray-800">Coming in Step {page.step}</p>
        <p className="mt-1 text-sm text-gray-500">This part of the portal has not been built yet.</p>
      </div>
    </section>
  )
}
