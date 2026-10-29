-- Identidad compartida entre la receta/ingrediente del catálogo global y sus copias por consultorio.
-- `catalogCustomizedAt` marca las copias editadas localmente: al publicar se respetan y se avisan.
ALTER TABLE "Recipe" ADD COLUMN     "catalogId" TEXT,
ADD COLUMN     "catalogCustomizedAt" TIMESTAMP(3),
ADD COLUMN     "catalogSyncedAt" TIMESTAMP(3);

ALTER TABLE "Ingredient" ADD COLUMN     "catalogId" TEXT;

CREATE INDEX "Recipe_catalogId_idx" ON "Recipe"("catalogId");
CREATE INDEX "Ingredient_catalogId_idx" ON "Ingredient"("catalogId");
