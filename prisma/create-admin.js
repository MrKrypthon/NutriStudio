// Crea el primer administrador del SaaS (panel /admin) sin contraseñas en el repositorio. Sirve en
// producción, donde prisma/seed.js se niega a correr. Lee:
//   ADMIN_EMAIL     correo con el que entrará (se guarda en minúsculas)
//   ADMIN_PASSWORD  al menos 12 caracteres; nunca se imprime ni se guarda en claro
//   ADMIN_NAME      opcional, «Administrador» por defecto
//
// Para que la contraseña no quede en el historial de la consola:
//   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD     (bash/zsh; en fish: read -s -x ADMIN_PASSWORD)
//   ADMIN_EMAIL=tu@correo.mx npm run admin:create
//   unset ADMIN_PASSWORD                                  (en fish: set -e ADMIN_PASSWORD)
//
// Si ya existe un administrador con ese correo no lo toca: este script sólo crea.

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
  const existing = await prisma.adminUser.findUnique({ where: { email: input.email }, select: { id: true } })
  if (existing) {
    console.error(`[admin] Ya existe un administrador con ${input.email}; no se modificó.`)
    process.exitCode = 1
    return
  }
  const passwordHash = await bcrypt.hash(input.password, ADMIN_BCRYPT_ROUNDS)
  const admin = await prisma.adminUser.create({ data: { email: input.email, name: input.name, passwordHash }, select: { id: true, email: true } })
  console.log(`[admin] Administrador creado: ${admin.email} (${admin.id}). Entra en /admin con esa contraseña.`)
}

main()
  .catch((error) => {
    // Sólo el tipo y el código de Prisma: el mensaje completo puede incluir la dirección de la base.
    console.error(`[admin] No se pudo crear el administrador: ${error.name}${error.code ? ` ${error.code}` : ''}.`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
