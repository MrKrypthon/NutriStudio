// Mini-ilustraciones esquemáticas para cada hallazgo de la exploración física. Son referencias
// visuales simplificadas (no fotografías clínicas) para reconocer el signo de un vistazo.
const C = { skin: '#f3d3c6', skinL: '#f9e6dd', line: '#e0b7a7', red: '#d9534f', redL: '#f3b7b4', yellow: '#e8c34a', white: '#ffffff', gray: '#c9ccd3', grayD: '#9aa0ab', blue: '#7aa7d6', blueD: '#4f7fae', brown: '#b9822f', ink: '#3d3e51', green: '#3fa46a', dark: '#8a5a3b', blood: '#b23b3b' }

const Skin = ({ children, fill = C.skin }) => <><rect x="8" y="16" width="48" height="32" rx="11" fill={fill} stroke={C.line} />{children}</>
const Eye = ({ children, iris = C.blue }) => <><ellipse cx="32" cy="32" rx="22" ry="13" fill={C.white} stroke={C.line} /><circle cx="32" cy="32" r="7.5" fill={iris} /><circle cx="32" cy="32" r="3.4" fill={C.ink} /><circle cx="29.4" cy="29.4" r="1.4" fill={C.white} />{children}</>
const Mouth = ({ children }) => <><ellipse cx="32" cy="33" rx="17" ry="12" fill={C.redL} stroke={C.line} />{children}</>
const Tooth = ({ children, fill = C.white }) => <><path d="M24 16h16v18c0 4-2 10-4 12-1.4 1.4-4 1.4-4 0s-2-6-4-10c-2 4-2 8-4 10-1.4 1.4-4 1-4-2z" fill={fill} stroke={C.line} />{children}</>
const Nail = ({ children, fill = C.skinL }) => <><rect x="20" y="18" width="24" height="30" rx="10" fill={fill} stroke={C.line} /><rect x="24" y="22" width="16" height="22" rx="7" fill={C.white} stroke={C.line} />{children}</>
const Hair = ({ children }) => <><circle cx="32" cy="34" r="16" fill={C.skin} stroke={C.line} /><path d="M16 28a16 16 0 0 1 32 0c-6-4-10-5-16-3s-11 4-16 3Z" fill={C.dark} />{children}</>

const ART = {
  // Piel y ojos
  'Petequias': <Skin>{[[20, 26], [30, 31], [41, 25], [26, 39], [38, 40], [47, 33], [16, 35]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.7" fill={C.red} />)}</Skin>,
  'Xerosis conjuntival': <Eye iris={C.grayD}><path d="M12 32q20-9 40 0" fill="none" stroke={C.yellow} strokeWidth="1.4" strokeDasharray="2 2" /></Eye>,
  'Piel seca': <Skin>{[[22, 26, 5], [34, 34, 6], [44, 25, 4], [28, 41, 5], [41, 40, 4]].map(([x, y, r], i) => <path key={i} d={`M${x - r} ${y} l${r} ${r / 1.6} l${r} -${r / 1.6}`} fill="none" stroke={C.line} strokeWidth="1.2" />)}</Skin>,
  'Dermatitis pelagrosa': <Skin fill={C.skinL}>{<rect x="8" y="16" width="48" height="32" rx="11" fill={C.redL} opacity="0.55" stroke={C.red} strokeDasharray="3 2" />}</Skin>,
  'Manchas de Bitot': <Eye><ellipse cx="26" cy="28" rx="6" ry="3.4" fill={C.gray} opacity="0.9" /><ellipse cx="40" cy="35" rx="4.4" ry="2.6" fill={C.white} stroke={C.grayD} /></Eye>,
  'Hiperqueratosis folicular': <Skin>{[[20, 24], [28, 30], [36, 24], [44, 30], [24, 40], [34, 41], [43, 40]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.4" fill="none" stroke={C.dark} strokeWidth="1.2" />)}</Skin>,
  'Edema': <><path d="M14 44c6-3 8-9 8-16 0-5 4-8 10-8s10 3 10 8c0 7 2 13 8 16Z" fill={C.skin} stroke={C.line} /><path d="M22 30q10 4 20 0" fill="none" stroke={C.line} strokeWidth="1.4" /></>,
  'Queratomalacia': <Eye iris={C.gray}><ellipse cx="32" cy="32" rx="9" ry="5" fill={C.gray} opacity="0.75" /></Eye>,
  'Conjuntivas pálidas': <><ellipse cx="32" cy="34" rx="22" ry="13" fill={C.skinL} stroke={C.line} /><path d="M10 34q22 9 44 0" fill="none" stroke={C.white} strokeWidth="3" /></>,
  'Cianosis': <Mouth><path d="M25 29q7 12 14 0" fill={C.blueD} opacity="0.85" /></Mouth>,
  'Xantelasma': <Eye><path d="M14 27q6-4 16-3l-2 5q-8 0-14 2Z" fill={C.yellow} opacity="0.9" /></Eye>,
  'Piel quebradiza y escamosa': <Skin>{[[24, 23], [34, 22], [44, 24], [28, 34], [39, 35], [23, 42], [34, 43], [45, 42]].map(([x, y], i) => <path key={i} d={`M${x} ${y} l5 3 -5 3`} fill="none" stroke={C.line} strokeWidth="1.2" />)}</Skin>,
  // Cabello
  'Caídas': <Hair>{[[20, 30], [26, 24], [34, 22], [42, 24], [46, 30], [30, 44]].map(([x, y], i) => <path key={i} d={`M${x} ${y} q2 10 5 15`} fill="none" stroke={C.dark} strokeWidth="1.4" />)}</Hair>,
  'Frágil y delgado': <Hair>{[[22, 26], [28, 24], [34, 24], [40, 26]].map(([x, y], i) => <path key={i} d={`M${x} ${y} q${i % 2 ? 2 : -2} 8 0 12`} fill="none" stroke={C.dark} strokeWidth="0.9" />)}</Hair>,
  // Boca
  'Sialorrea': <Mouth><path d="M32 44c0 6-1 9 1 12 1 2 4 1 3-1-1-3-1-6-1-11Z" fill={C.blue} opacity="0.6" /></Mouth>,
  'Halitosis': <Mouth>{[[28, 42], [36, 44], [32, 48]].map(([x, y], i) => <path key={i} d={`M${x} ${y} q6 3 0 10`} fill="none" stroke={C.grayD} strokeWidth="1.3" />)}</Mouth>,
  'Queilosis': <Mouth><path d="M17 29q3-4 8-4M47 29q-3-4-8-4" fill="none" stroke={C.red} strokeWidth="1.6" /><path d="M18 36l4 0M42 36l4 0" stroke={C.red} strokeWidth="1.6" /></Mouth>,
  'Glositis': <><ellipse cx="32" cy="34" rx="11" ry="15" fill={C.red} opacity="0.55" /><ellipse cx="32" cy="34" rx="11" ry="15" fill="none" stroke={C.red} />{[[28, 28], [35, 32], [29, 39], [36, 41], [32, 24]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.4" fill={C.red} />)}</>,
  'Sangrado de encías': <><ellipse cx="32" cy="34" rx="18" ry="12" fill={C.redL} stroke={C.line} /><path d="M20 30q12 6 24 0" fill="none" stroke={C.red} strokeWidth="2.4" /><circle cx="26" cy="33" r="1.8" fill={C.blood} /><circle cx="38" cy="33" r="1.8" fill={C.blood} /></>,
  'Xerostomía': <><ellipse cx="32" cy="34" rx="12" ry="15" fill={C.redL} stroke={C.line} />{[[27, 28], [37, 34], [28, 40], [36, 42]].map(([x, y], i) => <path key={i} d={`M${x} ${y} l4 2 l-4 2`} fill="none" stroke={C.grayD} strokeWidth="1.1" />)}</>,
  'Atrofia papilar': <><ellipse cx="32" cy="34" rx="12" ry="15" fill={C.redL} stroke={C.line} /><path d="M26 28h12M25 35h14M27 42h10" stroke={C.white} strokeWidth="1" /></>,
  // Dentadura
  'Sarro': <Tooth><path d="M24 34q8-3 16 0v6q-8 3-16 0Z" fill={C.yellow} opacity="0.85" /></Tooth>,
  'Movilización de piezas dentales': <><Tooth /><path d="M44 24l6-6M46 30l7 0M44 36l6 6" stroke={C.blueD} strokeWidth="1.4" /></>,
  'Deterioro del esmalte': <Tooth fill="#f2ead9">{[[27, 26], [34, 30], [31, 38], [39, 36]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.1" fill={C.brown} opacity="0.8" />)}</Tooth>,
  // Uñas
  'Fragilidad': <Nail>{<path d="M26 26l5 6M34 24l-4 8M31 36l5 4" stroke={C.line} strokeWidth="1.3" />}</Nail>,
  'Reblandecimiento': <Nail>{<path d="M24 30q8 6 16 0" fill="none" stroke={C.yellow} strokeWidth="3" />}</Nail>,
  'Onicolisis': <Nail><path d="M40 22v22" stroke={C.blueD} strokeWidth="1.6" /><rect x="38" y="22" width="6" height="22" fill={C.gray} opacity="0.5" /></Nail>,
  'Hiperqueratosis subungueal': <Nail>{<path d="M24 40q8 6 16 0v6H24Z" fill={C.brown} opacity="0.8" />}</Nail>,
  'Coiloniquia': <><rect x="20" y="18" width="24" height="30" rx="10" fill={C.skinL} stroke={C.line} /><path d="M24 24q8 10 16 0v16q-8 8-16 0Z" fill={C.white} stroke={C.line} /></>,
}

export default function ExamArt({ finding }) {
  return <svg className="exam-art" viewBox="0 0 64 64" role="img" aria-label={`Referencia: ${finding}`}><rect x="1" y="1" width="62" height="62" rx="14" fill="#fbfcfc" />{ART[finding] || <><rect x="8" y="16" width="48" height="32" rx="11" fill={C.skinL} stroke={C.line} /><path d="M22 32h20M32 22v20" stroke={C.line} /></>}</svg>
}
