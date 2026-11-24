// Static definitions of every CDN-EP form: items, scales and maximum scores.
// The UI renders from these objects and the server scores against them, so a
// wording change is an edit here, not a migration.
//
// Rules for editing:
//  - Answers are stored as Json keyed by item `key`. Never rename or reuse a key
//    once real answers exist; add a new one instead.
//  - Bump a form's `version` when its items or scale change. Every stored row
//    records the version it was filled in against (`formVersion` in
//    prisma/schema.prisma), so older answers stay readable.
//  - Anything the source documents do not give yet is named in the form's
//    `pending` note. Nothing here invents clinical content.
//
// Source: the CDN-EP specification and the Assessment & Evaluation Manual
// SIUT-CT-NS-AEV-001 (structure as summarised in CDN-EP-PLAN.md; item wording
// verbatim from the manual).

import type {
  EpaLevel,
  EvaluationFormType,
  MillerLevel,
  StandardRating,
  WpbaType,
} from '@prisma/client'

// ── Building blocks ──────────────────────────────────────────────────────────

/** A rating scale. `anchors` names some or all points; the rest are plain numbers. */
export interface RatingScale {
  readonly min: number
  readonly max: number
  readonly anchors?: Readonly<Partial<Record<number, string>>>
}

export interface RatedItem {
  /** Unique within its form. */
  readonly key: string
  readonly label: string
  /** Descriptors for particular points of the scale (MDGRS: 1, 3 and 5). */
  readonly descriptors?: Readonly<Partial<Record<number, string>>>
}

export interface RatedSection {
  readonly key: string
  readonly title: string
  readonly scale: RatingScale
  readonly items: readonly RatedItem[]
  /** items × scale.max */
  readonly maxScore: number
}

export interface FreeTextField {
  /** Unique within its form. */
  readonly key: string
  readonly label: string
  readonly optional: boolean
}

function section(key: string, title: string, scale: RatingScale, items: readonly RatedItem[]): RatedSection {
  return { key, title, scale, items, maxScore: items.length * scale.max }
}

function sumMax(sections: readonly RatedSection[]): number {
  return sections.reduce((sum, s) => sum + s.maxScore, 0)
}

// ── Scales ───────────────────────────────────────────────────────────────────

export const SCALE_1_TO_5: RatingScale = { min: 1, max: 5 }

// The manual does not define Form 1.2's scale (plan Open Items), so it defaults
// to 1–5. Change it here and Form 1.2's maximum follows.
export const FORM_1_2_SCALE: RatingScale = SCALE_1_TO_5

export const FORM_1_3_SCALE: RatingScale = {
  min: 0,
  max: 3,
  anchors: { 3: 'Always', 2: 'Usually', 1: 'Sometimes', 0: 'Never' },
}

export const MINI_CEX_SCALE: RatingScale = { min: 1, max: 9 }

export const DOPS_SCALE: RatingScale = {
  min: 1,
  max: 5,
  anchors: {
    1: 'Unsafe / direct instruction',
    2: 'Substantial prompting',
    3: 'Competent with direct supervision',
    4: 'Competent with indirect supervision',
    5: 'Independent',
  },
}

// Each OSCE criterion is scored out of 5. OPEN ITEM, for the user to confirm:
// the spec does not give the lowest score, so 1 is assumed.
export const OSCE_SCALE: RatingScale = { min: 1, max: 5 }

// ── Evaluation forms (Step 4) ────────────────────────────────────────────────

/** Training months of the quarterly assessments (Forms 1.2 and 1.3). */
export const CHECKPOINT_MONTHS = [4, 8, 12] as const

export interface EvaluationFormDefinition {
  readonly type: EvaluationFormType
  readonly version: number
  readonly title: string
  /** Guidance shown in the form's header. */
  readonly headerNote?: string
  readonly filledBy: 'TRAINEE' | 'PRECEPTOR'
  readonly about: 'TRAINEE' | 'PRECEPTOR'
  /** CHECKPOINTS = the CHECKPOINT_MONTHS only. */
  readonly cadence: 'WEEKLY' | 'MONTHLY' | 'CHECKPOINTS'
  /** Author never stored; results shown as aggregates only (see NutritionEvaluationForm). */
  readonly confidential: boolean
  readonly sections: readonly RatedSection[]
  readonly freeText: readonly FreeTextField[]
  /** Sum of the section maxima; 0 for an unscored form. */
  readonly maxScore: number
  /** What the source documents have not supplied yet, if anything. */
  readonly pending?: string
}

const FORM_1_1_SECTIONS = [
  section('part_a', 'Part A', SCALE_1_TO_5, [
    { key: 'clinical_knowledge', label: 'Clinical/Nutritional knowledge of this topic' },
    { key: 'technical_skill_confidence', label: 'Technical/Procedural skill confidence' },
    { key: 'professionalism', label: 'Professionalism (self-rated accountability, punctuality, initiative)' },
    { key: 'communication_confidence', label: 'Communication skill confidence (caregiver/team)' },
    { key: 'data_management_confidence', label: 'Data management/documentation confidence' },
  ]),
  section('part_b', 'Part B', SCALE_1_TO_5, [
    { key: 'teaching_clarity', label: 'Clarity and effectiveness of teaching methods used this month' },
    { key: 'relevance', label: 'Relevance of content to actual clinical practice' },
    { key: 'preceptor_support', label: 'Quality of preceptor support and supervision' },
    { key: 'time_adequacy', label: 'Adequacy of time allocated to this topic' },
    { key: 'resource_quality', label: 'Availability/quality of learning resources' },
  ]),
]

const FORM_1_1: EvaluationFormDefinition = {
  type: 'FORM_1_1',
  version: 1,
  title: 'Form 1.1 — Trainee monthly evaluation',
  filledBy: 'TRAINEE',
  about: 'TRAINEE',
  cadence: 'MONTHLY',
  confidential: false,
  sections: FORM_1_1_SECTIONS,
  freeText: [
    { key: 'worked_well', label: 'What worked well this month?', optional: true },
    { key: 'could_improve', label: 'What could be improved?', optional: true },
  ],
  maxScore: sumMax(FORM_1_1_SECTIONS),
}

const FORM_1_2_SECTIONS = [
  section('areas', 'Areas', FORM_1_2_SCALE, [
    { key: 'attendance_punctuality', label: 'Attendance & punctuality' },
    { key: 'communication', label: 'Communication' },
    { key: 'professionalism_respect', label: 'Professionalism & respect' },
    { key: 'teamwork', label: 'Teamwork' },
    { key: 'quality_of_work', label: 'Quality of work' },
    { key: 'integrity_ethics', label: 'Integrity & ethics' },
    { key: 'engagement_initiative', label: 'Engagement & initiative' },
    { key: 'commitment_to_learning', label: 'Commitment to learning' },
    { key: 'critical_thinking', label: 'Critical thinking' },
    { key: 'responsiveness_to_feedback', label: 'Responsiveness to feedback' },
  ]),
]

const FORM_1_2: EvaluationFormDefinition = {
  type: 'FORM_1_2',
  version: 1,
  title: 'Form 1.2 — Preceptor evaluation of trainee',
  filledBy: 'PRECEPTOR',
  about: 'TRAINEE',
  cadence: 'CHECKPOINTS',
  confidential: false,
  sections: FORM_1_2_SECTIONS,
  freeText: [{ key: 'comments', label: 'General comments and suggestions for improvement', optional: true }],
  maxScore: sumMax(FORM_1_2_SECTIONS),
}

// 8 + 12 + 7 + 8 + 9 = 44 items × 3 = 132, per the manual. The spec's "33-item"
// is a known discrepancy; the manual is followed (plan Open Items).
const FORM_1_3_SECTIONS = [
  section('organized_focused', 'Organized & Focused', FORM_1_3_SCALE, [
    { key: 'planned_activities_in_advance', label: 'The preceptor planned learning activities in advance.' },
    { key: 'prepared_and_punctual', label: 'Was prepared and punctual for internship activities.' },
    { key: 'explained_concepts_clearly', label: 'Explained concepts clearly and completely.' },
    { key: 'answered_questions_accurately', label: 'Answered questions carefully and accurately.' },
    { key: 'summarized_key_points', label: 'Summarized key learning points during teaching.' },
    { key: 'focused_on_objectives', label: 'Focused on defined learning objectives.' },
    { key: 'used_time_efficiently', label: 'Used time efficiently.' },
    { key: 'helped_prioritize_topics', label: 'Helped prioritize important topics.' },
  ]),
  section('values_interaction', 'Values Student-Preceptor Interaction', FORM_1_3_SCALE, [
    { key: 'encouraged_open_discussion', label: 'Encouraged open discussion and participation.' },
    { key: 'welcomed_student_opinions', label: 'Welcomed student opinions, ideas, and experiences.' },
    { key: 'comfortable_asking_questions', label: 'Made students feel comfortable asking questions.' },
    { key: 'appropriate_eye_contact', label: 'Maintained appropriate eye contact.' },
    { key: 'clarified_question_reasoning', label: 'Clarified reasoning behind questions.' },
    { key: 'ensured_understanding', label: 'Ensured students understood key points.' },
    { key: 'committed_to_quality_teaching', label: 'Demonstrated commitment to quality teaching.' },
    { key: 'encouraged_hands_on_learning', label: 'Encouraged active, hands-on learning.' },
    { key: 'showed_enthusiasm', label: 'Showed enthusiasm for professional and teaching duties.' },
    { key: 'varied_tone_and_pace', label: 'Used varying tone and pace to maintain interest.' },
    { key: 'appropriate_humor', label: 'Used appropriate humor when interacting with students.' },
    { key: 'engaging_presentation', label: 'Presented material in an engaging and interesting way.' },
  ]),
  section('relates_well', 'Relates Well to Students', FORM_1_3_SCALE, [
    { key: 'interest_in_student_learning', label: "Showed genuine interest in students' learning." },
    { key: 'treated_students_respectfully', label: 'Treated students respectfully and professionally.' },
    { key: 'recognized_students_as_individuals', label: 'Recognized students as individuals.' },
    { key: 'adapted_to_learning_needs', label: 'Adapted to diverse learning needs and styles.' },
    { key: 'guidance_beyond_internship', label: 'Provided valuable guidance beyond internship duties.' },
    { key: 'available_and_accessible', label: 'Was available and accessible when needed.' },
    { key: 'friendly_and_approachable', label: 'Maintained a friendly and approachable attitude.' },
  ]),
  section('teaching_strategies', 'Uses Effective Teaching Strategies', FORM_1_3_SCALE, [
    { key: 'shared_recent_practices', label: 'Shared updates and recent practices in the field.' },
    { key: 'referred_to_evidence', label: 'Referred to evidence-based guidelines and resources.' },
    { key: 'communicated_expectations', label: 'Clearly communicated student expectations.' },
    { key: 'stimulated_critical_thinking', label: 'Asked questions to stimulate critical thinking.' },
    { key: 'encouraged_self_directed_learning', label: 'Encouraged self-directed learning.' },
    { key: 'bridged_knowledge_gaps', label: 'Identified and helped bridge knowledge gaps.' },
    { key: 'aligned_with_competencies', label: 'Aligned teaching with relevant competencies.' },
    { key: 'timely_constructive_feedback', label: 'Provided timely, constructive feedback.' },
  ]),
  section('professional_competence', 'Displays Professional Competence', FORM_1_3_SCALE, [
    { key: 'subject_matter_knowledge', label: 'Demonstrated strong subject matter knowledge.' },
    { key: 'remained_updated', label: 'Remained updated in the area of precepting.' },
    { key: 'confidence_and_expertise', label: 'Showed confidence and expertise.' },
    { key: 'skilled_as_preceptor', label: 'Was confident and skilled as a preceptor.' },
    { key: 'respect_for_students_colleagues', label: 'Demonstrated respect for students and colleagues.' },
    { key: 'empathy_and_understanding', label: 'Showed empathy and understanding.' },
    { key: 'collaborated_with_team', label: 'Collaborated effectively with healthcare team.' },
    { key: 'accepted_responsibility', label: 'Accepted responsibility for their actions.' },
    { key: 'acknowledged_limitations', label: 'Acknowledged limitations professionally.' },
  ]),
]

const FORM_1_3: EvaluationFormDefinition = {
  type: 'FORM_1_3',
  version: 1,
  title: 'Form 1.3 — Trainee evaluation of preceptor',
  filledBy: 'TRAINEE',
  about: 'PRECEPTOR',
  cadence: 'CHECKPOINTS',
  confidential: true,
  sections: FORM_1_3_SECTIONS,
  freeText: [
    { key: 'preceptor_comments', label: 'Overall comments (preceptor)', optional: true },
    { key: 'program_comments', label: 'Overall comments (program)', optional: true },
  ],
  maxScore: sumMax(FORM_1_3_SECTIONS),
}

const FORM_3_1_SECTIONS = [
  section('domains', 'Domains', SCALE_1_TO_5, [
    {
      key: 'clinical_knowledge',
      label: 'Clinical/Nutritional knowledge & application',
      descriptors: {
        1: 'Significant knowledge gaps; requires constant correction',
        3: 'Sound knowledge applied correctly with supervision',
        5: 'Comprehensive, independently applied to complex cases',
      },
    },
    {
      key: 'technical_skills',
      label: 'Technical/Procedural skills (feed calculation, formula selection, data entry)',
      descriptors: {
        1: 'Frequent errors; unsafe without direct oversight',
        3: 'Accurate with periodic checking',
        5: 'Consistently accurate and efficient, unsupervised',
      },
    },
    {
      key: 'professionalism',
      label: 'Professionalism (accountability, punctuality, initiative, ethical conduct)',
      descriptors: {
        1: 'Unreliable; requires repeated reminders',
        3: 'Reliable and accountable in routine situations',
        5: 'Consistently proactive role model of professional conduct',
      },
    },
    {
      key: 'communication',
      label: 'Communication skills (caregiver counselling, team communication, documentation clarity)',
      descriptors: {
        1: 'Unclear or ineffective communication',
        3: 'Clear, appropriate communication in most situations',
        5: 'Consistently clear, empathetic, adapts to audience',
      },
    },
    {
      key: 'data_management',
      label: 'Data management & record accuracy',
      descriptors: {
        1: 'Incomplete or inaccurate records',
        3: 'Complete, accurate records with occasional prompting',
        5: 'Meticulous, audit-ready records without prompting',
      },
    },
    {
      key: 'overall_clinical_judgment',
      label: 'Overall clinical judgment & case management',
      descriptors: {
        1: 'Poor prioritization; requires direct guidance',
        3: 'Sound judgment in routine cases with support',
        5: 'Sound, independent judgment even in complex cases',
      },
    },
  ]),
]

const FORM_3_1: EvaluationFormDefinition = {
  type: 'FORM_3_1',
  version: 1,
  title: 'Form 3.1 — MDGRS',
  headerNote: 'Trainees are not expected to meet every domain in the first few months; the preceptor may adapt expectations.',
  filledBy: 'PRECEPTOR',
  about: 'TRAINEE',
  cadence: 'MONTHLY',
  confidential: false,
  sections: FORM_3_1_SECTIONS,
  freeText: [],
  maxScore: sumMax(FORM_3_1_SECTIONS),
}

// A 10–15 minute check-in. Unscored; the preceptor may comment
// (NutritionEvaluationForm.reviewComment).
const WEEKLY: EvaluationFormDefinition = {
  type: 'WEEKLY',
  version: 1,
  title: 'Weekly check-in',
  filledBy: 'TRAINEE',
  about: 'TRAINEE',
  cadence: 'WEEKLY',
  confidential: false,
  sections: [],
  freeText: [
    { key: 'cases_this_week', label: 'Cases this week', optional: false },
    { key: 'progress_vs_objectives', label: 'Progress vs current month objectives', optional: false },
    { key: 'difficulties_supervision', label: 'Difficulties / supervision needs', optional: false },
    { key: 'plan_next_week', label: 'Plan for next week', optional: false },
  ],
  maxScore: 0,
}

export const EVALUATION_FORMS: Readonly<Record<EvaluationFormType, EvaluationFormDefinition>> = {
  FORM_1_1,
  FORM_1_2,
  FORM_1_3,
  FORM_3_1,
  WEEKLY,
}

// ── Workplace-based assessments (Step 5) ─────────────────────────────────────

export interface WpbaDefinition {
  readonly type: WpbaType
  readonly version: number
  readonly title: string
  /** Recorded on every WPBA; the suggested EPA range follows from MILLER_EPA_TARGETS. */
  readonly millerLevel: MillerLevel
  readonly sections: readonly RatedSection[]
  readonly freeText: readonly FreeTextField[]
  readonly maxScore: number
  /** OSCE: PASS needs a total of at least minPercent of maxScore AND no critical error. */
  readonly passRule?: { readonly minPercent: number; readonly noCriticalError: boolean }
  readonly pending?: string
}

/** DOPS procedures. "Other" is free text, stored in NutritionWpba.procedure. */
export const DOPS_PROCEDURES = [
  { key: 'tube_feeding_calculation', label: 'Tube feeding calculation' },
  { key: 'growth_plotting', label: 'Growth plotting' },
  { key: 'diet_formulation', label: 'Diet formulation' },
] as const

/** The DOPS "other" choice. Its description is then required, and is what NutritionWpba.procedure stores. */
export const DOPS_OTHER_PROCEDURE = { key: 'other', label: 'Other (describe)' } as const

const MINI_CEX_SECTIONS = [
  section('domains', 'Domains', MINI_CEX_SCALE, [
    { key: 'medical_interviewing', label: 'Medical interviewing (gathering accurate history and relevant data)' },
    { key: 'physical_examination', label: 'Physical examination (proper technique, respectful communication)' },
    { key: 'clinical_reasoning', label: 'Clinical reasoning (diagnosis, safety, planning)' },
    { key: 'professionalism_communication', label: 'Professionalism & communication (empathy, listening, ethics)' },
    { key: 'counseling_organization', label: 'Counseling & organization (time management, explaining the plan clearly)' },
  ]),
]

const DOPS_SECTIONS = [section('rating', 'Rating', DOPS_SCALE, [{ key: 'overall', label: 'Overall' }])]

// A DEFAULT set of CbD questions until the program supplies its own (see CBD.pending).
const CBD_SECTIONS = [
  section('questions', 'Structured questions', SCALE_1_TO_5, [
    { key: 'assessment', label: 'Assessment (anthropometric, biochemical, clinical, dietary data)' },
    { key: 'nutrition_diagnosis', label: 'Nutrition diagnosis (identifying and prioritising the problem)' },
    { key: 'intervention_planning', label: 'Intervention planning (feeding/nutrition plan)' },
    { key: 'monitoring_evaluation', label: 'Monitoring and evaluation (outcomes, adjusting the plan)' },
    { key: 'overall_clinical_judgment', label: 'Overall clinical judgment' },
  ]),
]

const OSCE_SECTIONS = [
  section('criteria', 'Criteria', OSCE_SCALE, [
    { key: 'case_selection_reasoning', label: 'Case selection and clinical reasoning' },
    { key: 'nutrition_care_process', label: 'Application of nutrition care process' },
    { key: 'communication_clarity', label: 'Communication and clarity of presentation' },
    { key: 'response_to_questioning', label: 'Response to questioning' },
    { key: 'professionalism', label: 'Professionalism' },
  ]),
]

// Miller levels per the plan (Step 5): Mini-CEX and OSCE = Shows How,
// DOPS = Does, CbD = Knows How.
export const WPBA_FORMS: Readonly<Record<WpbaType, WpbaDefinition>> = {
  MINI_CEX: {
    type: 'MINI_CEX',
    version: 1,
    title: 'Mini-CEX',
    millerLevel: 'SHOWS_HOW',
    sections: MINI_CEX_SECTIONS,
    freeText: [],
    maxScore: sumMax(MINI_CEX_SECTIONS),
  },
  DOPS: {
    type: 'DOPS',
    version: 1,
    title: 'DOPS',
    millerLevel: 'DOES',
    sections: DOPS_SECTIONS,
    freeText: [],
    maxScore: sumMax(DOPS_SECTIONS),
    pending: 'Confirm one 1–5 rating per procedure (assumed), or supply the DOPS items',
  },
  CBD: {
    type: 'CBD',
    version: 1,
    title: 'CbD',
    millerLevel: 'KNOWS_HOW',
    sections: CBD_SECTIONS,
    // Every WPBA's written feedback is stored in NutritionWpba.feedback; on a CbD it is labelled this.
    freeText: [{ key: 'feedback', label: 'Feedback and agreed action', optional: false }],
    maxScore: sumMax(CBD_SECTIONS),
    pending: "Default CbD questions; replace with the program's own",
  },
  OSCE: {
    type: 'OSCE',
    version: 1,
    title: 'OSCE',
    millerLevel: 'SHOWS_HOW',
    sections: OSCE_SECTIONS,
    freeText: [],
    maxScore: sumMax(OSCE_SECTIONS),
    passRule: { minPercent: 70, noCriticalError: true },
  },
}

// ── Miller's pyramid and EPA entrustment ─────────────────────────────────────

export const EPA_LEVEL_LABELS: Readonly<Record<EpaLevel, string>> = {
  E1: 'Observer',
  E2: 'Direct supervision',
  E3: 'Indirect supervision',
  E4: 'Unsupervised (spot-checked)',
  E5: 'Supervises / teaches others',
}

export const MILLER_LEVEL_LABELS: Readonly<Record<MillerLevel, string>> = {
  KNOWS: 'Knows',
  KNOWS_HOW: 'Knows How',
  SHOWS_HOW: 'Shows How',
  DOES: 'Does',
}

export interface EpaRange {
  readonly min: EpaLevel
  readonly max: EpaLevel
}

/** The EPA range an assessment at each Miller level should map to. */
export const MILLER_EPA_TARGETS: Readonly<Record<MillerLevel, EpaRange>> = {
  KNOWS: { min: 'E1', max: 'E1' },
  KNOWS_HOW: { min: 'E1', max: 'E2' },
  SHOWS_HOW: { min: 'E2', max: 'E3' },
  DOES: { min: 'E3', max: 'E5' },
}

/** Month 12 summative sign-off target. */
export const SUMMATIVE_EPA_TARGET: EpaRange = { min: 'E4', max: 'E5' }

// ── Month 9 standards checklist (Step 6) ─────────────────────────────────────

export interface StandardsGroup {
  readonly key: string
  readonly title: string
  readonly standards: readonly { readonly key: string; readonly label: string }[]
}

export interface StandardsChecklistDefinition {
  readonly version: number
  readonly monthNumber: number
  readonly groups: readonly StandardsGroup[]
}

// Every standard is rated with a StandardRating and carries an evidence
// reference: the id of a case log or a WPBA.
export const STANDARDS_CHECKLIST: StandardsChecklistDefinition = {
  version: 1,
  monthNumber: 9,
  groups: [
    {
      key: 'sop',
      title: 'SOP',
      standards: [
        { key: 'sop_nutrition_assessment', label: 'Nutrition Assessment' },
        { key: 'sop_diagnosis', label: 'Diagnosis' },
        { key: 'sop_intervention', label: 'Intervention' },
        { key: 'sop_monitoring_evaluation', label: 'Monitoring & Evaluation' },
      ],
    },
    {
      key: 'sopp',
      title: 'SOPP',
      standards: [
        { key: 'sopp_quality_in_practice', label: 'Quality in Practice' },
        { key: 'sopp_competence_accountability', label: 'Competence & Accountability' },
        { key: 'sopp_provision_of_services', label: 'Provision of Services' },
        { key: 'sopp_application_of_research', label: 'Application of Research' },
        { key: 'sopp_communication_knowledge', label: 'Communication & Application of Knowledge' },
        { key: 'sopp_utilization_resources', label: 'Utilization & Management of Resources' },
      ],
    },
  ],
}

export const STANDARD_RATING_LABELS: Readonly<Record<StandardRating, string>> = {
  DEVELOPING: 'Developing',
  MEETS: 'Meets',
  EXCEEDS: 'Exceeds',
}
