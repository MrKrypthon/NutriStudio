// Cambia la contraseña de un administrador del panel y cierra todas sus sesiones (fase 112). Sirve si
// la contraseña se filtró o se olvidó. Lee ADMIN_EMAIL y ADMIN_PASSWORD del entorno, con las mismas
// reglas que prisma/create-admin.js; la contraseña nunca se imprime:
//   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD     (bash/zsh; en fish: read -s -x ADMIN_PASSWORD)
//   ADMIN_EMAIL=tu@correo.mx npm run admin:reset-password
//   unset ADMIN_PASSWORD                                  (en fish: set -e ADMIN_PASSWORD)

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { ADMIN_BCRYPT_ROUNDS, readAdminInput } from './tools/adminAccount.js'

const input = readAdminInput()
delete process.env.ADMIN_PASSWORD
if (input.errors.length) {
  for (const error of input.errors) console.error(`[admin] ${error}`)
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const admin = await prisma.adminUser.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true, email: true } })
  if (!admin) {
    console.error(`[admin] No hay un administrador con ${input.email}. Para crearlo: npm run admin:create`)
    process.exitCode = 1
    return
  }
  const passwordHash = await bcrypt.hash(input.password, ADMIN_BCRYPT_ROUNDS)
  await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash, sessionVersion: { increment: 1 } } })
  console.log(`[admin] Contraseña cambiada para ${admin.email}; sus sesiones abiertas se cerraron.`)
}

main()
  .catch((error) => {
    // Sólo el tipo y el código de Prisma: el mensaje completo puede incluir la dirección de la base.
    console.error(`[admin] No se pudo cambiar la contraseña: ${error.name}${error.code ? ` ${error.code}` : ''}.`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
