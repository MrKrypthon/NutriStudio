// Guarda de los scripts que siembran datos de demostración (prisma/seed.js con sus cuentas de
// contraseña conocida, prisma/import-demo-practice.js con su práctica de ejemplo). En producción
// esas cuentas serían una puerta abierta, así que el script se detiene antes de abrir la conexión
// a la base. Sin excepción por variable: el primer administrador de producción se crea con
// prisma/create-admin.js.

export function demoDataBlockedReason(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase()
  if (nodeEnv === 'production') return 'NODE_ENV=production'
  return null
}

export function assertDemoDataAllowed(scriptName, env = process.env) {
  const reason = demoDataBlockedReason(env)
  if (!reason) return
  console.error(`[${scriptName}] Se detuvo: crea datos y cuentas de demostración y está corriendo con ${reason}.`)
  console.error(`[${scriptName}] Para el primer administrador de producción usa: npm run admin:create`)
  process.exit(1)
}
