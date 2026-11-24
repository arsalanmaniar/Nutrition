-- CDN-EP baseline: the complete nutr_* schema as it exists in production.
--
-- Built 2026-11-24 by concatenating, unchanged and in the order they were
-- applied to the survey app's live database, the three files from the
-- siut-survey repo (origin/main 846120f):
--   1. prisma/nutrition-step2.sql  (tables, enums, indexes, CHECKs, RLS)
--   2. prisma/nutrition-step3.sql  (unique indexes, append-only audit log)
--   3. prisma/nutrition-step8.sql  (attendance tables)
-- Their old "apply with prisma db execute" notes no longer apply: here this
-- file runs once, through `prisma migrate deploy`, on an EMPTY database.

-- ============================================================================
-- Part 1 of 3: nutrition-step2.sql
-- ============================================================================
-- CDN-EP Step 2: nutrition-only schema additions (CDN-EP-PLAN.md, Decision 1).
--
-- Generated offline (no database connection) on 2026-10-08 with:
--   npx prisma migrate diff --from-schema <HEAD:prisma/schema.prisma at 699c861> \
--     --to-schema prisma/schema.prisma --script
-- Below: the generator output (unedited), then hand-written blocks at the end.
--
-- Apply ONLY after the user's explicit "APPLY":
--   npx prisma db execute --file prisma/nutrition-step2.sql

-- CreateEnum
CREATE TYPE "nutr_role" AS ENUM ('TRAINEE', 'PRECEPTOR', 'UNIT_LEAD', 'ASSESSOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "nutr_epa_level" AS ENUM ('E1', 'E2', 'E3', 'E4', 'E5');

-- CreateEnum
CREATE TYPE "nutr_miller_level" AS ENUM ('KNOWS', 'KNOWS_HOW', 'SHOWS_HOW', 'DOES');

-- CreateEnum
CREATE TYPE "nutr_submission_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "nutr_standard_rating" AS ENUM ('DEVELOPING', 'MEETS', 'EXCEEDS');

-- CreateEnum
CREATE TYPE "nutr_wpba_type" AS ENUM ('MINI_CEX', 'DOPS', 'CBD', 'OSCE');

-- CreateEnum
CREATE TYPE "nutr_case_form_type" AS ENUM ('A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "nutr_evaluation_form_type" AS ENUM ('FORM_1_1', 'FORM_1_2', 'FORM_1_3', 'FORM_3_1', 'WEEKLY');

-- CreateTable
CREATE TABLE "nutr_profile" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "nutr_role" NOT NULL,
    "institution" TEXT,
    "trainingStartDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_preceptor_assignment" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "preceptorId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_preceptor_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_rotation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitLeadId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_rotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_rotation_entry" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "rotationPreceptorId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "hours" DOUBLE PRECISION,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_rotation_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_case_log" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "rotationId" TEXT,
    "caseCode" TEXT NOT NULL,
    "ageBand" TEXT NOT NULL,
    "diagnosisCategory" TEXT NOT NULL,
    "formType" "nutr_case_form_type" NOT NULL,
    "formVersion" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "epaLevel" "nutr_epa_level",
    "status" "nutr_submission_status" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_case_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_evaluation_form" (
    "id" TEXT NOT NULL,
    "formType" "nutr_evaluation_form_type" NOT NULL,
    "formVersion" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorHash" TEXT,
    "monthNumber" INTEGER NOT NULL,
    "assessmentPoint" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "totalScore" INTEGER,
    "maxScore" INTEGER,
    "status" "nutr_submission_status" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "nutr_evaluation_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_wpba" (
    "id" TEXT NOT NULL,
    "type" "nutr_wpba_type" NOT NULL,
    "formVersion" INTEGER NOT NULL,
    "traineeId" TEXT NOT NULL,
    "assessorId" TEXT NOT NULL,
    "rotationEntryId" TEXT,
    "caseLogId" TEXT,
    "procedure" TEXT,
    "scores" JSONB NOT NULL,
    "total" INTEGER,
    "maxScore" INTEGER,
    "passed" BOOLEAN,
    "criticalError" BOOLEAN,
    "millerLevel" "nutr_miller_level" NOT NULL,
    "feedback" TEXT,
    "assessedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_wpba_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_epa_assessment" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "epaName" TEXT NOT NULL,
    "level" "nutr_epa_level" NOT NULL,
    "millerLevel" "nutr_miller_level" NOT NULL,
    "assessorId" TEXT NOT NULL,
    "assessedOn" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_epa_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_standards_checklist" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL DEFAULT 9,
    "formVersion" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "status" "nutr_submission_status" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_standards_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_msf_invite" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "assessorName" TEXT NOT NULL,
    "assessorRole" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_msf_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_msf_response" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "formVersion" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "nutr_msf_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_remediation_plan" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_remediation_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_remediation_step" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "deficiency" TEXT NOT NULL,
    "activity" TEXT,
    "reassessmentDate" DATE,
    "linkedWpbaId" TEXT,
    "outcome" TEXT,
    "epaName" TEXT,
    "epaBefore" "nutr_epa_level",
    "epaAfter" "nutr_epa_level",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_remediation_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_audit_log" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutr_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_credential" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "pdfPath" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nutr_profile_authUserId_key" ON "nutr_profile"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_profile_email_key" ON "nutr_profile"("email");

-- CreateIndex
CREATE INDEX "nutr_profile_role_idx" ON "nutr_profile"("role");

-- CreateIndex
CREATE INDEX "nutr_preceptor_assignment_traineeId_active_idx" ON "nutr_preceptor_assignment"("traineeId", "active");

-- CreateIndex
CREATE INDEX "nutr_preceptor_assignment_preceptorId_active_idx" ON "nutr_preceptor_assignment"("preceptorId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_rotation_name_key" ON "nutr_rotation"("name");

-- CreateIndex
CREATE INDEX "nutr_rotation_unitLeadId_idx" ON "nutr_rotation"("unitLeadId");

-- CreateIndex
CREATE INDEX "nutr_rotation_entry_traineeId_idx" ON "nutr_rotation_entry"("traineeId");

-- CreateIndex
CREATE INDEX "nutr_rotation_entry_rotationId_idx" ON "nutr_rotation_entry"("rotationId");

-- CreateIndex
CREATE INDEX "nutr_rotation_entry_rotationPreceptorId_idx" ON "nutr_rotation_entry"("rotationPreceptorId");

-- CreateIndex
CREATE INDEX "nutr_case_log_traineeId_status_idx" ON "nutr_case_log"("traineeId", "status");

-- CreateIndex
CREATE INDEX "nutr_case_log_rotationId_idx" ON "nutr_case_log"("rotationId");

-- CreateIndex
CREATE INDEX "nutr_case_log_reviewedById_idx" ON "nutr_case_log"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_evaluation_form_authorHash_key" ON "nutr_evaluation_form"("authorHash");

-- CreateIndex
CREATE INDEX "nutr_evaluation_form_subjectId_formType_idx" ON "nutr_evaluation_form"("subjectId", "formType");

-- CreateIndex
CREATE INDEX "nutr_evaluation_form_authorId_idx" ON "nutr_evaluation_form"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_evaluation_form_period_key" ON "nutr_evaluation_form"("formType", "subjectId", "authorId", "assessmentPoint");

-- CreateIndex
CREATE INDEX "nutr_wpba_traineeId_type_idx" ON "nutr_wpba"("traineeId", "type");

-- CreateIndex
CREATE INDEX "nutr_wpba_assessorId_idx" ON "nutr_wpba"("assessorId");

-- CreateIndex
CREATE INDEX "nutr_wpba_rotationEntryId_idx" ON "nutr_wpba"("rotationEntryId");

-- CreateIndex
CREATE INDEX "nutr_wpba_caseLogId_idx" ON "nutr_wpba"("caseLogId");

-- CreateIndex
CREATE INDEX "nutr_epa_assessment_traineeId_epaName_assessedOn_idx" ON "nutr_epa_assessment"("traineeId", "epaName", "assessedOn");

-- CreateIndex
CREATE INDEX "nutr_epa_assessment_assessorId_idx" ON "nutr_epa_assessment"("assessorId");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_standards_checklist_traineeId_monthNumber_key" ON "nutr_standards_checklist"("traineeId", "monthNumber");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_msf_invite_tokenHash_key" ON "nutr_msf_invite"("tokenHash");

-- CreateIndex
CREATE INDEX "nutr_msf_invite_traineeId_idx" ON "nutr_msf_invite"("traineeId");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_msf_response_inviteId_key" ON "nutr_msf_response"("inviteId");

-- CreateIndex
CREATE INDEX "nutr_remediation_plan_traineeId_idx" ON "nutr_remediation_plan"("traineeId");

-- CreateIndex
CREATE INDEX "nutr_remediation_step_linkedWpbaId_idx" ON "nutr_remediation_step"("linkedWpbaId");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_remediation_step_planId_position_key" ON "nutr_remediation_step"("planId", "position");

-- CreateIndex
CREATE INDEX "nutr_audit_log_entity_entityId_at_idx" ON "nutr_audit_log"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "nutr_audit_log_actorId_at_idx" ON "nutr_audit_log"("actorId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "nutr_credential_verificationId_key" ON "nutr_credential"("verificationId");

-- CreateIndex
CREATE INDEX "nutr_credential_traineeId_idx" ON "nutr_credential"("traineeId");

-- AddForeignKey
ALTER TABLE "nutr_preceptor_assignment" ADD CONSTRAINT "nutr_preceptor_assignment_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_preceptor_assignment" ADD CONSTRAINT "nutr_preceptor_assignment_preceptorId_fkey" FOREIGN KEY ("preceptorId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_rotation" ADD CONSTRAINT "nutr_rotation_unitLeadId_fkey" FOREIGN KEY ("unitLeadId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_rotation_entry" ADD CONSTRAINT "nutr_rotation_entry_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_rotation_entry" ADD CONSTRAINT "nutr_rotation_entry_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "nutr_rotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_rotation_entry" ADD CONSTRAINT "nutr_rotation_entry_rotationPreceptorId_fkey" FOREIGN KEY ("rotationPreceptorId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_rotation_entry" ADD CONSTRAINT "nutr_rotation_entry_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_case_log" ADD CONSTRAINT "nutr_case_log_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_case_log" ADD CONSTRAINT "nutr_case_log_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "nutr_rotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_case_log" ADD CONSTRAINT "nutr_case_log_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_wpba" ADD CONSTRAINT "nutr_wpba_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_wpba" ADD CONSTRAINT "nutr_wpba_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_wpba" ADD CONSTRAINT "nutr_wpba_rotationEntryId_fkey" FOREIGN KEY ("rotationEntryId") REFERENCES "nutr_rotation_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_wpba" ADD CONSTRAINT "nutr_wpba_caseLogId_fkey" FOREIGN KEY ("caseLogId") REFERENCES "nutr_case_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_epa_assessment" ADD CONSTRAINT "nutr_epa_assessment_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_epa_assessment" ADD CONSTRAINT "nutr_epa_assessment_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_standards_checklist" ADD CONSTRAINT "nutr_standards_checklist_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_msf_invite" ADD CONSTRAINT "nutr_msf_invite_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_msf_response" ADD CONSTRAINT "nutr_msf_response_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "nutr_msf_invite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_remediation_plan" ADD CONSTRAINT "nutr_remediation_plan_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_remediation_step" ADD CONSTRAINT "nutr_remediation_step_planId_fkey" FOREIGN KEY ("planId") REFERENCES "nutr_remediation_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_remediation_step" ADD CONSTRAINT "nutr_remediation_step_linkedWpbaId_fkey" FOREIGN KEY ("linkedWpbaId") REFERENCES "nutr_wpba"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_credential" ADD CONSTRAINT "nutr_credential_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Row Level Security on every nutr_* table (no policies, no FORCE).
ALTER TABLE "nutr_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_preceptor_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_rotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_rotation_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_case_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_evaluation_form" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_wpba" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_epa_assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_standards_checklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_msf_invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_msf_response" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_remediation_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_remediation_step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_credential" ENABLE ROW LEVEL SECURITY;

-- Hand-written CHECK constraints: Prisma cannot express CHECK constraints in schema.prisma.
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_period_format_check" CHECK ("assessmentPoint" ~ '^(W(0[1-9]|[1-4][0-9]|5[0-3])|M(0[1-9]|1[0-2]))$');
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_weekly_period_check" CHECK (("formType" = 'WEEKLY') = ("assessmentPoint" LIKE 'W%'));
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_checkpoint_month_check" CHECK ("formType" NOT IN ('FORM_1_2', 'FORM_1_3') OR "assessmentPoint" IN ('M04', 'M08', 'M12'));
ALTER TABLE "nutr_evaluation_form" ADD CONSTRAINT "nutr_evaluation_form_author_check" CHECK (("formType" = 'FORM_1_3') = ("authorId" IS NULL));

-- ============================================================================
-- Part 2 of 3: nutrition-step3.sql
-- ============================================================================
-- CDN-EP Step 3: hand-written additions to the nutrition schema (CDN-EP-PLAN.md,
-- Decisions "Step 3d outcome" item 4 and "Step 3e outcome" item 1).
--
-- Only CREATE INDEX, CREATE FUNCTION, CREATE TRIGGER and REVOKE, all on nutr_*
-- objects. No table is altered or dropped. `prisma db execute` sends the whole
-- file as one command, which Postgres runs as one transaction: if any statement
-- fails (for example a unique index over duplicate data), nothing is applied.
--
-- Apply ONLY after the user's explicit "APPLY":
--   npx prisma db execute --file prisma/nutrition-step3.sql

-- 1. One case code per trainee, backing up the create action's row lock (schema.prisma: @@unique, same name).
CREATE UNIQUE INDEX "nutr_case_log_trainee_case_code_key" ON "nutr_case_log" ("traineeId", "caseCode");

-- 2. Rotation names unique ignoring case; an expression index, which schema.prisma cannot express.
CREATE UNIQUE INDEX "nutr_rotation_name_lower_key" ON "nutr_rotation" (lower("name"));

-- 3a. Append-only audit log: this function refuses every UPDATE, DELETE and TRUNCATE of nutr_audit_log.
CREATE FUNCTION "nutr_audit_log_append_only"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'nutr_audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

-- 3b. Row trigger: updating or deleting any audit row fails.
CREATE TRIGGER "nutr_audit_log_no_update_delete" BEFORE UPDATE OR DELETE ON "nutr_audit_log"
FOR EACH ROW EXECUTE FUNCTION "nutr_audit_log_append_only"();

-- 3c. Statement trigger: TRUNCATE fails too, since TRUNCATE fires no row triggers.
CREATE TRIGGER "nutr_audit_log_no_truncate" BEFORE TRUNCATE ON "nutr_audit_log"
FOR EACH STATEMENT EXECUTE FUNCTION "nutr_audit_log_append_only"();

-- 3d. The Supabase API roles lose any right to change or empty the log.
REVOKE UPDATE, DELETE, TRUNCATE ON "nutr_audit_log" FROM anon, authenticated;

-- ============================================================================
-- Part 3 of 3: nutrition-step8.sql
-- ============================================================================
-- CDN-EP Step A (attendance module): new tables for trainee attendance.
--
-- Part 1 is generated offline and pasted unchanged:
--   npx prisma migrate diff --from-schema <copy of the committed schema.prisma, 7cd4f7c> \
--     --to-schema prisma/schema.prisma --script
-- Part 2 is hand-written: what schema.prisma cannot express.
--
-- Only CREATE TYPE, CREATE TABLE, CREATE INDEX, ADD CONSTRAINT (CHECK, and
-- FOREIGN KEY to nutr_profile) and ENABLE ROW LEVEL SECURITY, all on
-- nutr_attendance_* objects. No existing table is altered or dropped. The three
-- foreign keys REFERENCE nutr_profile(id), ON DELETE RESTRICT like every other
-- nutrition relation; nutr_profile itself is not changed. (Adding them briefly
-- locks nutr_profile against writes while the empty new tables are checked.)
-- `prisma db execute` sends the whole file as one command, which Postgres runs
-- as one transaction: if any statement fails, nothing is applied.
--
-- Apply ONLY after the user's explicit "APPLY":
--   npx prisma db execute --file prisma/nutrition-step8.sql

-- ===== Part 1: generated by prisma migrate diff =====
-- CreateEnum
CREATE TYPE "nutr_attendance_status" AS ENUM ('PRESENT', 'OUT_OF_WINDOW_RECORDED_BY_STAFF');

-- CreateTable
CREATE TABLE "nutr_attendance_holiday" (
    "id" TEXT NOT NULL,
    "scopeProfileId" TEXT,
    "workDate" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_attendance_holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_attendance_schedule" (
    "id" TEXT NOT NULL,
    "scopeProfileId" TEXT,
    "weekdays" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_attendance_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutr_attendance_record" (
    "id" TEXT NOT NULL,
    "traineeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" "nutr_attendance_status" NOT NULL DEFAULT 'PRESENT',
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "staffReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "nutr_attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nutr_attendance_holiday_scopeProfileId_workDate_idx" ON "nutr_attendance_holiday"("scopeProfileId", "workDate");

-- CreateIndex
CREATE INDEX "nutr_attendance_holiday_workDate_idx" ON "nutr_attendance_holiday"("workDate");

-- CreateIndex
CREATE INDEX "nutr_attendance_schedule_scopeProfileId_effectiveFrom_idx" ON "nutr_attendance_schedule"("scopeProfileId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "nutr_attendance_record_traineeId_workDate_idx" ON "nutr_attendance_record"("traineeId", "workDate");

-- CreateIndex
CREATE INDEX "nutr_attendance_record_workDate_idx" ON "nutr_attendance_record"("workDate");

-- AddForeignKey
ALTER TABLE "nutr_attendance_holiday" ADD CONSTRAINT "nutr_attendance_holiday_scopeProfileId_fkey" FOREIGN KEY ("scopeProfileId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_attendance_schedule" ADD CONSTRAINT "nutr_attendance_schedule_scopeProfileId_fkey" FOREIGN KEY ("scopeProfileId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutr_attendance_record" ADD CONSTRAINT "nutr_attendance_record_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "nutr_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Part 2: hand-written =====

-- 1. At most one live (non-voided) attendance row per trainee and Karachi day.
--    Partial, so a voided row stays in the table and the trainee can record the
--    day again after a super_admin voids it.
CREATE UNIQUE INDEX "nutr_attendance_record_trainee_day_live_key" ON "nutr_attendance_record" ("traineeId", "workDate") WHERE "voidedAt" IS NULL;

-- 2. One LIVE (non-voided) holiday per scope and day; a voided holiday stays
--    and the day can be set again. Postgres treats NULLs as distinct, so a
--    plain unique index on (scopeProfileId, workDate) would let two program-wide
--    (NULL scope) holidays share a day: hence one partial index per case.
-- 2a. Program-wide holidays (scopeProfileId NULL): one live holiday per day.
CREATE UNIQUE INDEX "nutr_attendance_holiday_program_day_key" ON "nutr_attendance_holiday" ("workDate") WHERE "scopeProfileId" IS NULL AND "voidedAt" IS NULL;
-- 2b. A preceptor's holidays: one live holiday per preceptor and day.
CREATE UNIQUE INDEX "nutr_attendance_holiday_scope_day_key" ON "nutr_attendance_holiday" ("scopeProfileId", "workDate") WHERE "scopeProfileId" IS NOT NULL AND "voidedAt" IS NULL;

-- 3. One schedule per scope and effectiveFrom, so "the latest row on or before
--    a day" is never a tie. Same NULL handling as item 2.
-- 3a. Program default schedules.
CREATE UNIQUE INDEX "nutr_attendance_schedule_program_from_key" ON "nutr_attendance_schedule" ("effectiveFrom") WHERE "scopeProfileId" IS NULL;
-- 3b. A preceptor's schedules.
CREATE UNIQUE INDEX "nutr_attendance_schedule_scope_from_key" ON "nutr_attendance_schedule" ("scopeProfileId", "effectiveFrom") WHERE "scopeProfileId" IS NOT NULL;

-- 4. Schedule values the server also validates (config/attendance.ts).
-- 4a. Weekdays: present, non-empty, each 0 (Sunday) to 6 (Saturday).
ALTER TABLE "nutr_attendance_schedule" ADD CONSTRAINT "nutr_attendance_schedule_weekdays_check"
  CHECK ("weekdays" IS NOT NULL AND cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
-- 4b. Times are zero-padded 24-hour "HH:MM" (HH_MM_PATTERN).
ALTER TABLE "nutr_attendance_schedule" ADD CONSTRAINT "nutr_attendance_schedule_time_format_check"
  CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
-- 4c. The window lies within one day: start before end. Zero-padded "HH:MM"
--     strings sort in time order, so a text comparison is exact.
ALTER TABLE "nutr_attendance_schedule" ADD CONSTRAINT "nutr_attendance_schedule_window_check"
  CHECK ("startTime" < "endTime");

-- 5. Attendance row consistency.
-- 5a. No check-out without a check-in, and never before it.
ALTER TABLE "nutr_attendance_record" ADD CONSTRAINT "nutr_attendance_record_checkout_check"
  CHECK ("checkOutAt" IS NULL OR ("checkInAt" IS NOT NULL AND "checkOutAt" >= "checkInAt"));
-- 5b. A void sets all three void columns or none of them.
ALTER TABLE "nutr_attendance_record" ADD CONSTRAINT "nutr_attendance_record_void_check"
  CHECK (("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
      OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL AND length(trim("voidReason")) > 0));

-- 5c. A holiday void sets all three void columns or none of them.
ALTER TABLE "nutr_attendance_holiday" ADD CONSTRAINT "nutr_attendance_holiday_void_check"
  CHECK (("voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
      OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL AND length(trim("voidReason")) > 0));

-- 6. Row level security on, as on every nutr_* table. The app's role bypasses
--    RLS; with no policies the Supabase API roles see nothing. (The project's
--    ensure_rls trigger also turns it on; repeating it is harmless.)
ALTER TABLE "nutr_attendance_holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_attendance_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nutr_attendance_record" ENABLE ROW LEVEL SECURITY;
