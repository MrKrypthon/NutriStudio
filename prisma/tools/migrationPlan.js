// Qué hacer con una base según lo que ya tiene (prisma/migrate.js, fase 112). Hasta la fase 111 el
// esquema se aplicaba con `prisma db push`, que no deja historial; las bases de entonces tienen las
// tablas pero no `_prisma_migrations`, y se adoptan marcando la línea base como ya aplicada.
export const BASELINE_MIGRATION = '0_init'

export function migrationPlan({ hasTables, hasHistory }) {
  if (hasHistory) return 'deploy'
  if (hasTables) return 'baseline-then-deploy'
  return 'deploy'
}
