const USDA_URL = 'https://api.nal.usda.gov/fdc/v1'
const OFF_URL = 'https://world.openfoodfacts.org'
const userAgent = 'NutriStudio/0.1 (nutrition-platform)'

async function requestJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': userAgent, Accept: 'application/json', ...options.headers } })
    if (!response.ok) throw Object.assign(new Error(`Food provider responded with ${response.status}`), { statusCode: response.status })
    return response.json()
  } finally { clearTimeout(timeout) }
}

function nutrientMap(nutrients = []) {
  const map = {}
  for (const nutrient of nutrients) {
    const key = String(nutrient.nutrientName || nutrient.name || '').toLowerCase()
    if (key.includes('energy')) map.kcal = nutrient.value || nutrient.amount || 0
    if (key === 'protein') map.protein = nutrient.value || nutrient.amount || 0
    if (key.includes('carbohydrate')) map.carbs = nutrient.value || nutrient.amount || 0
    if (key.includes('total lipid') || key === 'fat') map.fat = nutrient.value || nutrient.amount || 0
    if (key.includes('fiber')) map.fiber = nutrient.value || nutrient.amount || 0
    if (key.includes('sugars')) map.sugar = nutrient.value || nutrient.amount || 0
    if (key.includes('sodium')) map.sodium = nutrient.value || nutrient.amount || 0
  }
  return map
}

export async function searchUsda(query, pageSize = 20) {
  const key = process.env.USDA_API_KEY || 'DEMO_KEY'
  const params = new URLSearchParams({ api_key: key, query, pageSize: String(Math.min(pageSize, 50)), dataType: 'Foundation,SR Legacy,Branded' })
  const data = await requestJson(`${USDA_URL}/foods/search?${params}`)
  return { source: 'usda', total: data.totalHits || 0, items: (data.foods || []).map((food) => ({ externalId: String(food.fdcId), source: 'usda', name: food.description, brand: food.brandName || null, serving: { quantity: 100, unit: 'g' }, nutrition: nutrientMap(food.foodNutrients), allergens: [], imageUrl: null, attribution: 'USDA ARS FoodData Central', confidence: food.dataType === 'Foundation' ? 'high' : 'medium' })) }
}

export async function searchOpenFoodFacts(query, pageSize = 20) {
  const params = new URLSearchParams({ search_terms: query, search_simple: '1', action: 'process', json: '1', page_size: String(Math.min(pageSize, 30)), fields: 'code,product_name,brands,nutriments,image_front_url,allergens_tags,categories_tags' })
  const data = await requestJson(`${OFF_URL}/cgi/search.pl?${params}`)
  return { source: 'openfoodfacts', total: data.count || 0, items: (data.products || []).filter((product) => product.product_name).map((product) => ({ externalId: product.code, source: 'openfoodfacts', name: product.product_name, brand: product.brands || null, serving: { quantity: 100, unit: 'g' }, nutrition: { kcal: product.nutriments?.['energy-kcal_100g'] || 0, protein: product.nutriments?.proteins_100g || 0, carbs: product.nutriments?.carbohydrates_100g || 0, fat: product.nutriments?.fat_100g || 0, fiber: product.nutriments?.fiber_100g || 0, sugar: product.nutriments?.sugars_100g || 0, sodium: product.nutriments?.sodium_100g || 0 }, allergens: product.allergens_tags || [], imageUrl: product.image_front_url || null, attribution: 'Open Food Facts (ODbL / CC BY-SA para imágenes)', confidence: 'medium' })) }
}

export async function searchFoods(source, query, pageSize = 20) {
  if (!query || query.trim().length < 2) throw Object.assign(new Error('La búsqueda debe tener al menos 2 caracteres.'), { statusCode: 400, code: 'INVALID_QUERY' })
  if (source === 'usda') {
    try { return await searchUsda(query.trim(), pageSize) } catch (error) {
      if (error.statusCode === 429) return { ...(await searchOpenFoodFacts(query.trim(), pageSize)), fallbackFrom: 'usda', fallbackReason: 'USDA alcanzó el límite de solicitudes.' }
      throw error
    }
  }
  if (source === 'openfoodfacts') return searchOpenFoodFacts(query.trim(), pageSize)
  if (source === 'all') {
    const results = await Promise.allSettled([searchUsda(query.trim(), pageSize), searchOpenFoodFacts(query.trim(), pageSize)])
    return { source: 'all', total: results.reduce((sum, result) => result.status === 'fulfilled' ? sum + result.value.total : sum, 0), items: results.flatMap((result) => result.status === 'fulfilled' ? result.value.items : []) }
  }
  throw Object.assign(new Error('Proveedor de alimentos no soportado.'), { statusCode: 400, code: 'UNKNOWN_SOURCE' })
}
