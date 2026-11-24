import { redirect } from 'next/navigation'

// The portal lives under /nutrition.
export default function Home() {
  redirect('/nutrition')
}
