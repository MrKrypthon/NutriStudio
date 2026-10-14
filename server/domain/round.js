// Redondeo compartido del dominio (evita copias locales con distinto número de decimales).
export const round1 = (value) => Math.round(value * 10) / 10
export const round2 = (value) => Math.round(value * 100) / 100
