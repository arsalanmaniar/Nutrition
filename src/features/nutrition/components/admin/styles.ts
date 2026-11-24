// Class names for the nutrition admin, matching the existing admin
// (StaffForms.tsx). A plain module, not 'use client', so server components can
// use them too: a value imported from a client module reaches the server only
// as a client reference.

export const INPUT =
  'w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:border-red-500 disabled:opacity-60'
export const LABEL = 'block text-xs font-medium text-gray-600 mb-1'
export const PRIMARY_BUTTON =
  'px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50'
export const SECONDARY_BUTTON =
  'px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50'
export const CARD = 'rounded-xl border border-gray-200 bg-white p-4 md:p-6'
