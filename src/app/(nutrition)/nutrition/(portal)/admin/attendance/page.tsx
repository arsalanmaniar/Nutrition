import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD, INPUT, SECONDARY_BUTTON } from '@/features/nutrition/components/admin/styles'
import { GroupLateExtraSection, ProgramHoursSection } from '@/features/nutrition/components/attendance/AttendanceHoursSection'
import { AttendanceTable, ScheduleTable, VoidableRecordsTable } from '@/features/nutrition/components/attendance/AttendanceTable'
import { HolidayForm } from '@/features/nutrition/components/attendance/HolidayForm'
import { HolidayList } from '@/features/nutrition/components/attendance/HolidayList'
import { MissedDayForm } from '@/features/nutrition/components/attendance/MissedDayForm'
import { MonthPicker } from '@/features/nutrition/components/attendance/MonthPicker'
import { ScheduleForm } from '@/features/nutrition/components/attendance/ScheduleForm'
import {
  KARACHI_TIME_NOTE,
  WINDOW_SOURCE_LABELS,
  groupNote,
  groupText,
  monthLabel,
  weekdaysText,
  windowText,
} from '@/features/nutrition/components/attendance/attendance-display'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { getTraineeRecordsForAdmin, listPreceptorAttendanceHolidays } from '@/features/nutrition/server/queries/attendance-admin'
import { listPeople } from '@/features/nutrition/server/queries/people'
import { getProgramAttendanceSettings, getProgramAttendanceSummary, listAttendanceRecordsForVoid } from '@/features/nutrition/server/queries/attendance'
import { getProgramAttendanceHours } from '@/features/nutrition/server/queries/attendance-hours'

const HREF = '/nutrition/admin/attendance'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// Program attendance for ADMIN (Step 8 UI): the month's program average
// (aggregate only, hidden below 3 trainees), the program default working
// hours, program holidays and every preceptor's holidays (each removable),
// and a trainee picker: for the chosen trainee and month, the records with an
// edit form each and the missed-day form. Every nutrition ADMIN sees these;
// the actions check the caller again. The record list with delete is a
// section for a super_admin only: it is not rendered, and its loader is not
// called, for any other admin (the loader refuses them anyway).
export default async function AdminAttendancePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const access = await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  const [summary, settings, hours] = await Promise.all([
    getProgramAttendanceSummary(first(params.month)),
    getProgramAttendanceSettings(),
    getProgramAttendanceHours(first(params.month)),
  ])
  const month = summary?.month ?? settings.today.slice(0, 7)
  const records = access.isSuperAdmin && summary ? await listAttendanceRecordsForVoid(summary.month) : null
  const traineeParam = first(params.trainee)
  const [people, preceptorHolidays, chosen] = await Promise.all([
    listPeople(),
    listPreceptorAttendanceHolidays(),
    traineeParam ? getTraineeRecordsForAdmin(traineeParam, month) : Promise.resolve(null),
  ])
  const trainees = people.filter((person) => person.role === 'TRAINEE' && person.isActive)
  const { window, source } = settings.inForce

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description={`Program-wide attendance settings and the program average. ${KARACHI_TIME_NOTE}`} />
      <MonthPicker href={HREF} month={month} keep={chosen ? { trainee: chosen.traineeId } : {}} />

      {!summary ? (
        <p role="alert" className="text-sm text-red-600">
          That month is not valid. Choose a month above.
        </p>
      ) : (
        <section aria-labelledby="average-title" className={`${CARD} space-y-1`}>
          <h2 id="average-title" className="text-lg font-semibold text-gray-900">
            Program average, {monthLabel(summary.month)}
          </h2>
          <p className="text-sm text-gray-700">{groupText(summary.average)}</p>
          {groupNote(summary.average) && <p className="text-xs text-gray-500">{groupNote(summary.average)}</p>}
        </section>
      )}

      {hours && <ProgramHoursSection hours={hours} headingId="program-hours-title" />}
      {hours && <GroupLateExtraSection ranges={hours.lateExtra} month={hours.month} title="Program late arrival and extra time" headingId="program-late-extra-title" />}

      <section aria-labelledby="hours-title" className="space-y-3">
        <h2 id="hours-title" className="text-lg font-semibold text-gray-900">
          Program default working hours
        </h2>
        <p className="text-sm text-gray-700">
          In force today: {weekdaysText(window.weekdays)}, {windowText(window)}, from {WINDOW_SOURCE_LABELS[source]}. A preceptor&apos;s own hours replace these for
          their trainees.
        </p>
        <ScheduleForm scope="PROGRAM" current={window} today={settings.today} />
        <ScheduleTable schedules={settings.schedules} empty="No program default set yet; the built-in default applies." />
      </section>

      <section aria-labelledby="holidays-title" className="space-y-3">
        <h2 id="holidays-title" className="text-lg font-semibold text-gray-900">
          Program holidays
        </h2>
        <p className="text-sm text-gray-600">These apply to every trainee, together with their preceptor&apos;s own holidays.</p>
        <HolidayForm scope="PROGRAM" today={settings.today} />
        <HolidayList holidays={settings.holidays} removable empty="No program holidays." />
      </section>

      <section aria-labelledby="preceptor-holidays-title" className="space-y-3">
        <h2 id="preceptor-holidays-title" className="text-lg font-semibold text-gray-900">
          Preceptors&apos; holidays
        </h2>
        <p className="text-sm text-gray-600">Each applies to that preceptor&apos;s trainees. As an admin you may remove any of them.</p>
        {preceptorHolidays.length === 0 ? (
          <p className="text-sm text-gray-500">No preceptor holidays.</p>
        ) : (
          preceptorHolidays.map((group) => (
            <div key={group.preceptorId} className="space-y-2">
              <h3 dir="auto" className="text-sm font-semibold text-gray-900">
                {group.preceptorName}
              </h3>
              <HolidayList holidays={group.holidays} removable empty="No holidays." />
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="trainee-records-title" className="space-y-3">
        <h2 id="trainee-records-title" className="text-lg font-semibold text-gray-900">
          A trainee&apos;s records, {monthLabel(month)}
        </h2>
        <form method="get" action={HREF} className={`${CARD} flex flex-wrap items-end gap-3`}>
          <input type="hidden" name="month" value={month} />
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Trainee
            <select name="trainee" defaultValue={chosen?.traineeId ?? ''} required className={INPUT}>
              <option value="" disabled>
                Choose a trainee
              </option>
              {trainees.map((trainee) => (
                <option key={trainee.id} value={trainee.id}>
                  {trainee.fullName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={SECONDARY_BUTTON}>
            Show records
          </button>
        </form>
        {trainees.length === 0 && <p className="text-sm text-gray-500">There are no active trainees.</p>}
        {traineeParam && !chosen && (
          <p role="alert" className="text-sm text-red-600">
            That trainee was not found. Choose one above.
          </p>
        )}
        {chosen && (
          <>
            <h3 className="text-sm font-semibold text-gray-900">
              <span dir="auto">{chosen.traineeName}</span>: records
            </h3>
            <AttendanceTable days={chosen.days} editable empty="No attendance recorded this month." />
            <h3 className="text-sm font-semibold text-gray-900">Record a missed day</h3>
            <MissedDayForm traineeId={chosen.traineeId} today={settings.today} />
          </>
        )}
      </section>

      {records && (
        <section aria-labelledby="records-title" className="space-y-3">
          <h2 id="records-title" className="text-lg font-semibold text-gray-900">
            Attendance records, {monthLabel(records.month)} (super admin)
          </h2>
          <p className="text-sm text-gray-600">Deleting keeps the record in the history, marked deleted; it then no longer counts.</p>
          <VoidableRecordsTable records={records.records} />
        </section>
      )}
    </section>
  )
}
