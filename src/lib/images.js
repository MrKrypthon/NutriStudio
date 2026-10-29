// Las fotos de receta se guardan siempre como JPEG de a lo más 1600 px: es de sobra para la tarjeta
// y para el plan impreso, y el servidor sólo acepta JPEG. Así una foto del celular (varios MB) se
// puede subir tal cual. Lo comparten la pantalla de Recetas y el catálogo del panel de admin.
export const RECIPE_PHOTO_MAX_SIDE = 1600

export async function shrinkToJpeg(file) {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'))
      img.src = url
    })
    const scale = Math.min(1, RECIPE_PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    // Fondo blanco: el JPEG no tiene transparencia y un PNG recortado saldría con fondo negro.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
}
