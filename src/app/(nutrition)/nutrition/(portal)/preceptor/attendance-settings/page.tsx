import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { ScheduleTable } from '@/features/nutrition/components/attendance/AttendanceTable'
import { HolidayForm } from '@/features/nutrition/components/attendance/HolidayForm'
import { HolidayList } from '@/features/nutrition/components/attendance/HolidayList'
import { ScheduleForm } from '@/features/nutrition/components/attendance/ScheduleForm'
import { KARACHI_TIME_NOTE, WINDOW_SOURCE_LABELS, weekdaysText, windowText } from '@/features/nutrition/components/attendance/attendance-display'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { listMyAttendanceSettings } from '@/features/nutrition/server/queries/attendance'

const HREF = '/nutrition/preceptor/attendance-settings'

// The preceptor's own working hours and holidays (Step 8 UI). They apply to
// the trainees the caller is ACTIVE primary preceptor of. The program's
// holidays apply too and are listed read-only. The actions check the scope
// against the caller again.
export default async function PreceptorAttendanceSettingsPage() {
  await requireNutritionRole(pageRoles(HREF))
  const settings = await listMyAttendanceSettings()
  const { window, source } = settings.inForce

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description={`Working hours and holidays for your trainees. ${KARACHI_TIME_NOTE}`} />

      <section aria-labelledby="hours-title" className="space-y-3">
        <h2 id="hours-title" className="text-lg font-semibold text-gray-900">
          Working hours
        </h2>
        <p className="text-sm text-gray-700">
          In force today: {weekdaysText(window.weekdays)}, {windowText(window)}, from {WINDOW_SOURCE_LABELS[source]}.
        </p>
        <ScheduleForm scope="MINE" current={window} today={settings.today} />
        <ScheduleTable schedules={settings.schedules} empty="You have not set your own working hours; the program default applies." />
      </section>

      <section aria-labelledby="holidays-title" className="space-y-3">
        <h2 id="holidays-title" className="text-lg font-semibold text-gray-900">
          Your holidays
        </h2>
        <p className="text-sm text-gray-600">These apply to your trainees in addition to the program holidays below.</p>
        <HolidayForm scope="MINE" today={settings.today} />
        <HolidayList holidays={settings.holidays} removable empty="You have not added any holidays." />
      </section>

      <section aria-labelledby="program-holidays-title" className={`${CARD} space-y-3`}>
        <h2 id="program-holidays-title" className="text-lg font-semibold text-gray-900">
          Program holidays (set by the admin)
        </h2>
        <HolidayList holidays={settings.programHolidays} removable={false} empty="No program holidays." />
      </section>
    </section>
  )
}
