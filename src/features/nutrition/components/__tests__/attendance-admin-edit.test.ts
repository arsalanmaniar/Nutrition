import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The client forms need a router and their server actions; neither runs here.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/features/nutrition/server/actions/attendance', () => ({
  editRecord: async () => ({ status: 'idle' }),
  voidRecord: async () => ({ status: 'idle' }),
}))

import type { AttendanceDay } from '../../server/queries/attendance'
import { AttendanceTable } from '../attendance/AttendanceTable'

// The admin's record list on /nutrition/admin/attendance: every record of the
// chosen trainee and month gets the existing RecordEditForm, staff-recorded
// ones included, and the section is shown to every nutrition ADMIN, not only
// to a super_admin. The server rules are tested in attendance-actions.test.ts.

const DAYS: AttendanceDay[] = [
  { id: 'rec-present', workDate: '2026-11-02', checkIn: '08:21', checkOut: '16:09', status: 'PRESENT' },
  { id: 'rec-staff', workDate: '2026-11-03', checkIn: '00:30', checkOut: '18:14', status: 'OUT_OF_WINDOW_RECORDED_BY_STAFF' },
  { id: 'rec-open', workDate: '2026-11-04', checkIn: '08:05', checkOut: null, status: 'PRESENT' },
]

describe('AttendanceTable with editable: an edit form on every record', () => {
  const html = renderToStaticMarkup(createElement(AttendanceTable, { days: DAYS, editable: true, empty: 'none' }))

  it('one edit form per record, staff-recorded included', () => {
    expect([...html.matchAll(/name="recordId" value="([^"]+)"/g)].map((m) => m[1])).toEqual(['rec-present', 'rec-staff', 'rec-open'])
    expect(html.match(/Edit…/g)).toHaveLength(3)
  })

  it('each form starts from the record: Karachi times and its current status', () => {
    expect(html).toContain('name="checkInTime" value="00:30"')
    expect(html).toContain('name="checkOutTime" value="18:14"')
    // The staff record's status select starts on "Recorded by staff".
    const staffForm = html.slice(html.indexOf('value="rec-staff"'), html.indexOf('value="rec-open"'))
    expect(staffForm).toMatch(/<option value="OUT_OF_WINDOW_RECORDED_BY_STAFF" selected="">Recorded by staff<\/option>/)
    // A record with no check-out starts with an empty check-out.
    const openForm = html.slice(html.indexOf('value="rec-open"'))
    expect(openForm).toContain('name="checkOutTime" value=""')
  })

  it('without editable there is no form', () => {
    const plain = renderToStaticMarkup(createElement(AttendanceTable, { days: DAYS, empty: 'none' }))
    expect(plain).not.toContain('name="recordId"')
  })
})

describe('the admin attendance page shows the editable list to every ADMIN', () => {
  const page = readFileSync(fileURLToPath(new URL('../../../../app/(nutrition)/nutrition/(portal)/admin/attendance/page.tsx', import.meta.url)), 'utf8')

  it('renders the chosen trainee\'s records with editable, and the missed-day form', () => {
    expect(page).toContain('<AttendanceTable days={chosen.days} editable')
    expect(page).toContain('<MissedDayForm traineeId={chosen.traineeId}')
  })

  it('loads the records without any super_admin condition (only the void list has one)', () => {
    const load = page.split('\n').find((line) => line.includes('getTraineeRecordsForAdmin('))
    expect(load).toBeDefined()
    expect(load).not.toMatch(/isSuperAdmin/)
    expect(page.match(/isSuperAdmin/g)).toHaveLength(1)
    expect(page).toMatch(/access\.isSuperAdmin && summary \? await listAttendanceRecordsForVoid\(/)
  })
})
