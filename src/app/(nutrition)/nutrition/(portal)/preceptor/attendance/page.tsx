import Link from 'next/link'
import { requireNutritionRole } from '@/features/nutrition/auth/guard'
import { PageHeader } from '@/features/nutrition/components/admin/PageHeader'
import { CARD } from '@/features/nutrition/components/admin/styles'
import { AttendanceChart } from '@/features/nutrition/components/attendance/AttendanceChart'
import { GroupLateExtraSection, TraineeHoursSection } from '@/features/nutrition/components/attendance/AttendanceHoursSection'
import { AttendanceTable } from '@/features/nutrition/components/attendance/AttendanceTable'
import { MissedDayForm } from '@/features/nutrition/components/attendance/MissedDayForm'
import { MonthPicker } from '@/features/nutrition/components/attendance/MonthPicker'
import { KARACHI_TIME_NOTE, groupNote, groupText, monthLabel, percentageText } from '@/features/nutrition/components/attendance/attendance-display'
import { minutesText } from '@/features/nutrition/components/attendance/attendance-hours-display'
import { pageRoles } from '@/features/nutrition/components/navigation'
import { localDateKarachi } from '@/features/nutrition/server/attendance-core'
import type { HoursSummary } from '@/features/nutrition/server/attendance-hours-core'
import { getTraineeAttendanceCalendar, listMyTraineesAttendance } from '@/features/nutrition/server/queries/attendance'
import { listMyTraineesAttendanceHours } from '@/features/nutrition/server/queries/attendance-hours'

const HREF = '/nutrition/preceptor/attendance'

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

// Attendance of the trainees the caller is ACTIVE primary preceptor of (Step 8
// UI): the month's group average (hidden below 3), each trainee's percentage
// and late / early totals, the late / extra-time averages of the trainees
// (hidden below 3), and for the chosen trainee (the first one until
// another is chosen) the daily strip (deleted records greyed), the late /
// early / hours chart, the records with edit forms, and the missed-day form.
// Void reasons are never shown here. The loaders choose the trainees; the
// actions check every rule.
export default async function PreceptorAttendancePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireNutritionRole(pageRoles(HREF))
  const params = await searchParams
  const today = localDateKarachi(new Date())
  const [list, hours] = await Promise.all([listMyTraineesAttendance(first(params.month)), listMyTraineesAttendanceHours(first(params.month))])
  const month = list?.month ?? today.slice(0, 7)
  const selected = list?.trainees.find((trainee) => trainee.traineeId === first(params.trainee)) ?? list?.trainees[0] ?? null
  const calendar = selected ? await getTraineeAttendanceCalendar(selected.traineeId, month) : null
  const hoursOf = (traineeId: string) => hours?.trainees.find((trainee) => trainee.traineeId === traineeId) ?? null
  const selectedHours = selected ? hoursOf(selected.traineeId) : null
  const deletedDays = calendar?.days.filter((day) => day.kind === 'VOIDED').length ?? 0
  const keep: Record<string, string> = selected ? { trainee: selected.traineeId } : {}

  return (
    <section className="max-w-3xl space-y-6">
      <PageHeader href={HREF} description={`Attendance of the trainees you are primary preceptor of. ${KARACHI_TIME_NOTE}`} />
      <MonthPicker href={HREF} month={month} keep={keep} />

      {!list ? (
        <p role="alert" className="text-sm text-red-600">
          That month is not valid. Choose a month above.
        </p>
      ) : list.trainees.length === 0 ? (
        <p className="text-sm text-gray-500">You are not the primary preceptor of any trainee.</p>
      ) : (
        <>
          <section aria-labelledby="group-title" className={`${CARD} space-y-2`}>
            <h2 id="group-title" className="text-lg font-semibold text-gray-900">
              {monthLabel(month)}: your trainees
            </h2>
            <p className="text-sm text-gray-700">{groupText(list.group)}</p>
            {groupNote(list.group) && <p className="text-xs text-gray-500">{groupNote(list.group)}</p>}
            <ul className="divide-y divide-gray-100 text-sm">
              {list.trainees.map((trainee) => (
                <li key={trainee.traineeId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link
                    href={`${HREF}?${new URLSearchParams({ trainee: trainee.traineeId, month })}`}
                    aria-current={trainee.traineeId === selected?.traineeId ? 'true' : undefined}
                    className="font-medium text-red-700 underline"
                  >
                    <span dir="auto">{trainee.traineeName}</span>
                  </Link>
                  <span className="text-gray-700">{percentageText(trainee.percentage)}</span>
                  <MonthHoursText summary={hoursOf(trainee.traineeId)?.months.at(-1)?.summary ?? null} />
                </li>
              ))}
            </ul>
          </section>

          {hours && <GroupLateExtraSection ranges={hours.lateExtraGroup} month={hours.month} title="Your trainees' late arrival and extra time" headingId="late-extra-title" />}

          {selected && (
            <>
              <section aria-labelledby="strip-title" className={`${CARD} space-y-3`}>
                <h2 id="strip-title" className="text-lg font-semibold text-gray-900">
                  <span dir="auto">{selected.traineeName}</span>, {monthLabel(month)}
                </h2>
                {calendar && <AttendanceChart days={calendar.days} label={`Attendance of ${selected.traineeName}, ${monthLabel(month)}`} />}
                {deletedDays > 0 && (
                  <p className="text-xs text-gray-500">
                    {deletedDays} day{deletedDays === 1 ? '' : 's'} with only a deleted record, shown in grey. Deleted records do not count.
                  </p>
                )}
              </section>
              {selectedHours && <TraineeHoursSection charts={selectedHours} who={selected.traineeName} headingId="hours-title" />}
              <section aria-labelledby="records-title" className="space-y-2">
                <h2 id="records-title" className="text-lg font-semibold text-gray-900">
                  Records
                </h2>
                <AttendanceTable days={selected.days} editable empty="No attendance recorded this month." />
              </section>
              <section aria-labelledby="missed-title" className="space-y-2">
                <h2 id="missed-title" className="text-lg font-semibold text-gray-900">
                  Record a missed day
                </h2>
                <MissedDayForm traineeId={selected.traineeId} today={today} />
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** One trainee's late and early-leave totals for the month, under their name in the list: shown for every trainee. */
function MonthHoursText({ summary }: { summary: HoursSummary | null }) {
  const days = summary?.completeDays ?? 0
  return (
    <span className="w-full text-xs text-gray-500">
      Late {minutesText(summary?.lateMinutes ?? 0)}, left early {minutesText(summary?.earlyMinutes ?? 0)} this month
      {days === 0 ? ' (no day with both a check-in and a check-out yet)' : `, over ${days} measured day${days === 1 ? '' : 's'}`}
    </span>
  )
}
