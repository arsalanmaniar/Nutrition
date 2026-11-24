import type { GroupLateExtraRanges, LateExtraRanges } from '@/features/nutrition/server/attendance-hours-core'
import type { HoursCharts, ProgramAttendanceHours } from '@/features/nutrition/server/queries/attendance-hours'
import { CARD } from '../admin/styles'
import { AttendanceRangeChart, LateExtraChart } from './AttendanceHoursCharts'
import { KARACHI_TIME_NOTE, monthLabel } from './attendance-display'
import { GROUP_HIDDEN_TEXT, groupLateExtraRows, groupLines, programRangeRows, summaryLines, traineeLateExtraRows, traineeRangeRows } from './attendance-hours-display'

// The late / early / hours-worked section of the attendance pages: the chosen
// month's totals in words, then the one chart with its Daily, Weekly and
// Monthly ranges; and the late / extra-time bar chart, for one trainee or as
// group averages. Server components: they only lay out what the loaders
// returned.

const LATE_RULE = 'Late = minutes after the start of the working hours; left early = minutes before their end. Only days with both a check-in and a check-out are measured.'

const RANGE_NOTE = 'Daily: each day of the month. Weekly: Monday to Sunday weeks. Monthly: the 6 months up to this one.'

/** One trainee's section: the chosen month's totals and the range chart. `who` names the trainee for screen readers. */
export function TraineeHoursSection({ charts, who, headingId }: { charts: HoursCharts; who: string; headingId: string }) {
  const current = charts.months[charts.months.length - 1]
  return (
    <section aria-labelledby={headingId} className={`${CARD} space-y-4`}>
      <h2 id={headingId} className="text-lg font-semibold text-gray-900">
        Late arrival, early leaving and hours, {monthLabel(charts.month)}
      </h2>
      <ul className="space-y-1 text-sm text-gray-700">
        {summaryLines(current.summary).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        {LATE_RULE} {KARACHI_TIME_NOTE}
      </p>
      <AttendanceRangeChart
        ranges={traineeRangeRows(charts)}
        label={`Late and early-leave minutes and hours, ${who}`}
        note={`${RANGE_NOTE} Gaps have no record with both a check-in and a check-out.`}
      />
    </section>
  )
}

/** The program's section for ADMIN: averages only, each day, week or month under 3 trainees hidden. */
export function ProgramHoursSection({ hours, headingId }: { hours: ProgramAttendanceHours; headingId: string }) {
  const current = hours.months[hours.months.length - 1]
  return (
    <section aria-labelledby={headingId} className={`${CARD} space-y-4`}>
      <h2 id={headingId} className="text-lg font-semibold text-gray-900">
        Late arrival, early leaving and hours: program averages, {monthLabel(hours.month)}
      </h2>
      <ul className="space-y-1 text-sm text-gray-700">
        {groupLines(current.group).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        {LATE_RULE} {KARACHI_TIME_NOTE}
      </p>
      <AttendanceRangeChart
        ranges={programRangeRows(hours)}
        label="Program average late and early-leave minutes and hours"
        note={`${RANGE_NOTE} Averages per trainee. Shown from 3 trainees: a day, week or month with fewer than 3 trainees with both a check-in and a check-out has no marks.`}
      />
    </section>
  )
}

const LATE_EXTRA_RULE =
  'Late = minutes of check-in after the start of the working hours; extra time = minutes of check-out after their end. Late counts every day with a check-in, extra time every day with a check-out.'

/** One trainee's late / extra-time bar chart: minutes per day, or a week's or month's totals. */
export function TraineeLateExtraSection({ ranges, month, who, headingId }: { ranges: LateExtraRanges; month: string; who: string; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className={`${CARD} space-y-4`}>
      <h2 id={headingId} className="text-lg font-semibold text-gray-900">
        Late arrival and extra time, {monthLabel(month)}
      </h2>
      <p className="text-xs text-gray-500">
        {LATE_EXTRA_RULE} {KARACHI_TIME_NOTE}
      </p>
      <LateExtraChart
        ranges={traineeLateExtraRows(ranges)}
        label={`Late and extra-time minutes, ${who}`}
        note={`${RANGE_NOTE} Weekly and Monthly show the totals.`}
      />
    </section>
  )
}

/** A group's late / extra-time bar chart: averages per trainee, each measure of a day, week or month under 3 trainees hidden. */
export function GroupLateExtraSection({ ranges, month, title, headingId }: { ranges: GroupLateExtraRanges; month: string; title: string; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className={`${CARD} space-y-4`}>
      <h2 id={headingId} className="text-lg font-semibold text-gray-900">
        {title}, {monthLabel(month)}
      </h2>
      <p className="text-xs text-gray-500">
        {LATE_EXTRA_RULE} {KARACHI_TIME_NOTE}
      </p>
      <LateExtraChart
        ranges={groupLateExtraRows(ranges)}
        label={`${title}: late and extra-time minutes`}
        note={`${RANGE_NOTE} Averages per trainee. ${GROUP_HIDDEN_TEXT}: a day, week or month with fewer than 3 trainees measured has no bar.`}
      />
    </section>
  )
}
