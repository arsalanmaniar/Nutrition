import { portalPage } from '../navigation'

/** An admin page's heading, named from the portal page table like the sidebar. */
export function PageHeader({ href, description }: { href: string; description?: string }) {
  const { page, section } = portalPage(href)
  return (
    <header>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section}</p>
      <h1 className="mt-1 text-2xl font-bold text-gray-900">{page.label}</h1>
      {description && <p className="mt-1 text-sm text-gray-600">{description}</p>}
    </header>
  )
}
