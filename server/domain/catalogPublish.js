// Publicación del catálogo global: el admin edita la receta de la práctica base y este módulo
// lleva los cambios a las copias de cada consultorio. Las copias que la nutrióloga ya modificó
// (`catalogCustomizedAt`) se respetan y se devuelven en `skipped` para avisarle al admin.
//
// La identidad entre copias es `catalogId`; para las copias anteriores a esta función se intenta
// una conciliación por `source + nombre` y, si el contenido no coincide con la base, se marcan como
// modificadas en vez de sobrescribirlas.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'

const ingredientKey = (ingredient) => `${ingredient?.name || ''}\u0000${ingredient?.group || ''}`

// Huella del contenido que se puede editar en el catálogo (sin ids, que cambian por consultorio).
export function recipeContentSignature(recipe) {
  const ingredients = (recipe?.ingredients || [])
    .map((item) => ({
      name: item.ingredient?.name || item.name || '',
      group: item.ingredient?.group || '',
      quantity: Number(item.quantity) || 0,
      unit: item.unit || '',
    }))
    .sort((a, b) => `${a.name}\u0000${a.quantity}`.localeCompare(`${b.name}\u0000${b.quantity}`))
  return JSON.stringify({
    name: recipe?.name || '',
    mealTypes: [...(recipe?.mealTypes || [])].sort(),
    portions: Number(recipe?.portions) || 1,
    instructions: recipe?.instructions || '',
    ingredientsText: Array.isArray(recipe?.ingredientsText) ? recipe.ingredientsText : recipe?.ingredientsText || null,
    timeMinutes: recipe?.timeMinutes ?? null,
    ingredients,
  })
}

function copyFields(base, catalogId, now) {
  return {
    name: base.name,
    mealTypes: base.mealTypes,
    portions: base.portions,
    instructions: base.instructions,
    nutrition: base.nutrition,
    restrictions: base.restrictions,
    imageUrl: base.imageUrl,
    ingredientsText: base.ingredientsText == null ? Prisma.DbNull : base.ingredientsText,
    timeMinutes: base.timeMinutes,
    calculatedNutrition: base.calculatedNutrition == null ? Prisma.DbNull : base.calculatedNutrition,
    catalogId,
    catalogSyncedAt: now,
    catalogCustomizedAt: null,
  }
}

// Escribe (si hace falta) una copia de la foto del catálogo con nombre único por receta: así una
// cuenta puede cambiarla o quitarla sin borrar el archivo de las demás.
async function syncCopyImage({ copyId, oldImageFile, baseImageBytes, baseImageFile, imageDir }) {
  // La base no tiene foto: se quita en las copias. Si tiene foto pero el archivo no se pudo leer,
  // se deja la copia como está en vez de borrarle la suya.
  if (!baseImageFile) {
    if (oldImageFile?.startsWith('u-')) {
      await unlink(path.join(imageDir, oldImageFile)).catch(() => {})
      await unlink(path.join(imageDir, `thumb-${oldImageFile}`)).catch(() => {})
    }
    return null
  }
  if (!baseImageBytes) return oldImageFile
  const fileName = `u-${copyId}-${Date.now().toString(36)}.jpg`
  await mkdir(imageDir, { recursive: true })
  await writeFile(path.join(imageDir, fileName), baseImageBytes)
  if (oldImageFile && oldImageFile !== fileName && oldImageFile.startsWith('u-')) {
    await unlink(path.join(imageDir, oldImageFile)).catch(() => {})
    await unlink(path.join(imageDir, `thumb-${oldImageFile}`)).catch(() => {})
  }
  return fileName
}

/**
 * Lleva la receta base a todas las copias de los demás consultorios.
 * Devuelve un resumen para que el panel de admin muestre qué se actualizó y qué se respetó.
 */
export async function publishCatalogRecipe(db, { basePracticeId, recipeId, imageDir, now = new Date() }) {
  const base = await db.recipe.findFirst({
    where: { id: recipeId, practiceId: basePracticeId },
    include: { ingredients: { include: { ingredient: true } } },
  })
  if (!base) throw new Error('La receta del catálogo no existe.')

  // La receta base y sus ingredientes reciben una identidad estable la primera vez que se publica.
  const catalogId = base.catalogId || randomUUID()
  if (!base.catalogId) await db.recipe.update({ where: { id: base.id }, data: { catalogId } })
  for (const item of base.ingredients) {
    if (item.ingredient.catalogId) continue
    const ingredientCatalogId = randomUUID()
    await db.ingredient.update({ where: { id: item.ingredient.id }, data: { catalogId: ingredientCatalogId } })
    item.ingredient.catalogId = ingredientCatalogId
  }

  const baseImageBytes = base.imageFile ? await readFile(path.join(imageDir, base.imageFile)).catch(() => null) : null
  const baseSignature = recipeContentSignature(base)
  const practices = await db.practice.findMany({ where: { id: { not: basePracticeId } }, select: { id: true, name: true } })
  const updated = []
  const created = []
  const skipped = []
  const errors = []

  for (const practice of practices) {
    try {
      const outcome = await db.$transaction(async (tx) => {
        let copy = await tx.recipe.findFirst({
          where: { practiceId: practice.id, catalogId },
          include: { ingredients: { include: { ingredient: true } } },
        })
        // Copias creadas antes de que existiera `catalogId` (incluye las del DIETOCÁLCULO, que
        // tienen source nulo y se reconocen por nombre).
        if (!copy) {
          copy = await tx.recipe.findFirst({
            where: { practiceId: practice.id, catalogId: null, source: base.source, name: base.name },
            include: { ingredients: { include: { ingredient: true } } },
          })
        }
        if (copy?.status === 'ARCHIVED') return { action: 'skipped', reason: 'archived' }
        if (copy?.catalogCustomizedAt) return { action: 'skipped', reason: 'modified' }
        // Copia legacy: si su contenido ya no coincide con la base, se respeta como modificación.
        if (copy && !copy.catalogId) {
          if (recipeContentSignature(copy) !== baseSignature) {
            await tx.recipe.update({ where: { id: copy.id }, data: { catalogId, catalogCustomizedAt: now } })
            return { action: 'skipped', reason: 'modified' }
          }
          await tx.recipe.update({ where: { id: copy.id }, data: { catalogId } })
        }

        // Ingredientes locales: se reutilizan por identidad de catálogo o por nombre+grupo, y se
        // crean si el catálogo agregó uno que esta cuenta todavía no tiene.
        const localIngredients = await tx.ingredient.findMany({ where: { practiceId: practice.id }, select: { id: true, name: true, group: true, catalogId: true } })
        const byCatalog = new Map(localIngredients.filter((item) => item.catalogId).map((item) => [item.catalogId, item]))
        const byName = new Map(localIngredients.map((item) => [ingredientKey(item), item]))
        const rows = []
        for (const item of base.ingredients) {
          const ingredientCatalogId = item.ingredient.catalogId
          let local = (ingredientCatalogId && byCatalog.get(ingredientCatalogId)) || byName.get(ingredientKey(item.ingredient))
          if (!local) {
            local = await tx.ingredient.create({
              data: {
                practiceId: practice.id,
                name: item.ingredient.name,
                group: item.ingredient.group,
                unit: item.ingredient.unit,
                nutrition: item.ingredient.nutrition,
                equivalence: item.ingredient.equivalence ?? undefined,
                catalogId: ingredientCatalogId,
                status: 'ACTIVE',
              },
            })
            byName.set(ingredientKey(item.ingredient), local)
          } else if (ingredientCatalogId && !local.catalogId) {
            await tx.ingredient.update({ where: { id: local.id }, data: { catalogId: ingredientCatalogId } })
            local.catalogId = ingredientCatalogId
          }
          rows.push({ ingredientId: local.id, quantity: item.quantity, unit: item.unit, equivalence: item.equivalence })
        }

        const fields = copyFields(base, catalogId, now)
        if (copy) {
          const saved = await tx.recipe.update({ where: { id: copy.id }, data: fields })
          await tx.recipeIngredient.deleteMany({ where: { recipeId: copy.id } })
          if (rows.length) await tx.recipeIngredient.createMany({ data: rows.map((row) => ({ recipeId: copy.id, ...row })) })
          return { action: 'updated', copyId: saved.id, oldImageFile: saved.imageFile, practiceName: practice.name }
        }
        // Receta nueva en el catálogo: se agrega a las cuentas que todavía no la tienen.
        const archived = await tx.recipe.findFirst({ where: { practiceId: practice.id, catalogId, status: 'ARCHIVED' }, select: { id: true } })
        if (archived) return { action: 'skipped', reason: 'archived' }
        const saved = await tx.recipe.create({ data: { ...fields, practiceId: practice.id, source: base.source, status: 'ACTIVE' } })
        if (rows.length) await tx.recipeIngredient.createMany({ data: rows.map((row) => ({ recipeId: saved.id, ...row })) })
        return { action: 'created', copyId: saved.id, oldImageFile: null, practiceName: practice.name }
      }, { maxWait: 10000, timeout: 30000 })

      if (outcome.action === 'skipped') {
        skipped.push({ practiceId: practice.id, practiceName: practice.name, reason: outcome.reason })
        continue
      }
      // La foto se sincroniza después de guardar la receta (ya existe el id de la copia).
      try {
        const imageFile = await syncCopyImage({ copyId: outcome.copyId, oldImageFile: outcome.oldImageFile, baseImageBytes, baseImageFile: base.imageFile, imageDir })
        if (imageFile !== outcome.oldImageFile) await db.recipe.update({ where: { id: outcome.copyId }, data: { imageFile } })
      } catch (imageError) {
        errors.push({ practiceId: practice.id, practiceName: practice.name, reason: 'image', message: imageError?.message || 'No se pudo copiar la foto.' })
      }
      const entry = { practiceId: practice.id, practiceName: practice.name, recipeId: outcome.copyId }
      if (outcome.action === 'created') created.push(entry)
      else updated.push(entry)
    } catch (error) {
      errors.push({ practiceId: practice.id, practiceName: practice.name, reason: 'error', message: error?.message || 'No se pudo publicar en esta cuenta.' })
    }
  }

  await db.recipe.update({ where: { id: base.id }, data: { catalogId, catalogSyncedAt: now } })
  return { catalogId, updated, created, skipped, errors, total: practices.length }
}
