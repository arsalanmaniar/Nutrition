import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { AttendanceChart } from '@/features/nutrition/components/attendance/AttendanceChart'
import { TraineeHoursSection, TraineeLateExtraSection } from '@/features/nutrition/components/attendance/AttendanceHoursSection'
import { AttendanceTable } from '@/features/nutrition/components/attendance/AttendanceTable'
import { CheckInPanel } from '@/features/nutrition/components/attendance/CheckInPanel'
import { MonthPicker } from '@/features/nutrition/components/attendance/MonthPicker'
import { KARACHI_TIME_NOTE, monthLabel, percentageText } from '@/features/nutrition/components/attendance/attendance-display'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { getMyAttendance, getMyAttendanceCalendar, getMyCheckInStatus } from '@/features/nutrition/server/queries/attendance'
import { getMyAttendanceHours } from '@/features/nutrition/server/queries/attendance-hours'

const HREF = '/nutrition/trainee/attendance'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// The trainee's own attendance (Step 8 UI): today's check-in and check-out,
// then a month's strip, percentage and records. Deleted (voided) records are
// never shown here, and a day recorded by staff shows only that badge, never
// the reason. The loaders and actions apply every rule.
export default async function TraineeAttendancePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  const month = first(params.month)
  const [status, mine, calendar, hours] = await Promise.all([
    getMyCheckInStatus(),
    getMyAttendance(month),
    getMyAttendanceCalendar(month),
    getMyAttendanceHours(month),
  ])
  const shownMonth = mine?.month ?? status.today.slice(0, 7)

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description={`Check in when you arrive and check out when you leave. ${KARACHI_TIME_NOTE}`} />
      <CheckInPanel status={status} />
      <MonthPicker href={HREF} month={shownMonth} />

      {!mine || !calendar ? (
        <p role="alert" className="text-sm text-red-600">
          That month is not valid. Choose a month above.
        </p>
      ) : (
        <>
          <section aria-labelledby="month-title" className={`${CARD} space-y-3`}>
            <h2 id="month-title" className="text-lg font-semibold text-gray-900">
              {monthLabel(mine.month)}
            </h2>
            <p className="text-sm text-gray-700">{percentageText(mine.percentage)}</p>
            <AttendanceChart days={calendar.days} label={`Attendance, ${monthLabel(mine.month)}`} />
          </section>
          {hours && <TraineeHoursSection charts={hours} who="you" headingId="hours-title" />}
          {hours && <TraineeLateExtraSection ranges={hours.lateExtra} month={hours.month} who="you" headingId="late-extra-title" />}
          <section aria-labelledby="records-title" className="space-y-2">
            <h2 id="records-title" className="text-lg font-semibold text-gray-900">
              Records
            </h2>
            <AttendanceTable days={mine.days} empty="No attendance recorded this month." />
          </section>
        </>
      )}
    </section>
  )
}
