// Stands in for the 'server-only' marker under vitest (see vitest.config.mts).
// Next.js resolves that import itself and fails the build when a client
// component pulls in a server module; tests run outside Next, so it is empty here.
export {}
