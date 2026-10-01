// Alias de compatibilidad. La implementación canónica del catálogo de términos PES vive en
// `pesTerms.js`; aquí se re-exporta con los nombres alternos para no romper los imports que
// quedaron en el expediente.
export { PES_DOMAINS as PES_CATALOG, searchPesTerms as searchPesDiagnoses } from './pesTerms.js'
