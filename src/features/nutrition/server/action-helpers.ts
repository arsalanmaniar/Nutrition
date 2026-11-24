import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { fail, type ActionResult } from '@/features/nutrition/lib/action-result'

// Server-side helpers shared by the nutrition server actions.

/** An expected, user-facing failure raised inside a transaction so it rolls back. */
export class ActionFailure extends Error {
  readonly fieldErrors?: Record<string, string>
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.fieldErrors = fieldErrors
  }
}

/** A zod failure as an ActionResult: the first message per field, for the form to show. */
export function invalid(error: z.ZodError): ActionResult {
  const { formErrors, fieldErrors } = z.flattenError(error)
  const firstPerField: Record<string, string> = {}
  for (const [field, messages] of Object.entries(fieldErrors as Record<string, string[] | undefined>)) {
    if (messages?.[0]) firstPerField[field] = messages[0]
  }
  return fail(formErrors[0] ?? 'Check the highlighted fields.', firstPerField)
}

/** Postgres unique violation, as Prisma reports it (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** The text fields of a submitted form; files are ignored. */
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of formData.entries()) if (typeof value === 'string') fields[key] = value
  return fields
}
