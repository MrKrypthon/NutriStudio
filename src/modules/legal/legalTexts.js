// Textos legales de Milpa (fase 117). BORRADORES TÉCNICOS: describen con exactitud lo que la
// plataforma hace con los datos (proveedores, almacenamiento, respaldos), pero NO están revisados por
// un abogado. Antes de abrir al público, un abogado debe revisarlos, en particular:
//  - Que las referencias legales correspondan a la ley vigente de protección de datos personales en
//    posesión de particulares (en 2025 se publicó una nueva ley que sustituyó a la de 2010) y a la
//    autoridad competente actual; plazos y medios para los derechos ARCO.
//  - Los datos del responsable: [RAZÓN SOCIAL], [DOMICILIO], [RFC], [CORREO DE PRIVACIDAD].
//  - Transferencias y remisiones internacionales (servidor y respaldos en EE. UU.).
//  - Limitación de responsabilidad, jurisdicción y condiciones de cobro y cancelación.
// Cada sección: `body` (párrafos), `items` (lista) y `after` (párrafos después de la lista).
// Al cambiar cualquier texto, cambia su versión en src/lib/legal.js.

const PROVIDERS = [
  'Hostinger: servidor donde vive la plataforma (centro de datos en Estados Unidos).',
  'Backblaze: respaldos cifrados de la base de datos y de los archivos (Estados Unidos). Se cifran antes de salir del servidor; el proveedor no puede leerlos.',
  'Stripe: cobro de la suscripción. Los datos de tu tarjeta los recibe y guarda Stripe; Milpa no los conoce ni los almacena.',
  'Google: inicio de sesión con Google (si lo usas) y las tipografías de la interfaz, que tu navegador descarga de Google Fonts.',
]

export const LEGAL_TEXTS = {
  privacy: {
    intro: 'Este aviso explica qué datos personales trata Milpa, para qué, con quién los comparte y cómo puedes ejercer tus derechos. Aplica a quienes usan la plataforma: nutriólogos y su personal.',
    sections: [
      { title: 'Responsable', body: ['[RAZÓN SOCIAL] («Milpa»), con domicilio en [DOMICILIO], es responsable del tratamiento de los datos personales de las cuentas de la plataforma. Contacto de privacidad: [CORREO DE PRIVACIDAD].'] },
      { title: 'Datos de tu cuenta que tratamos', items: [
        'Identificación y contacto: nombre, correo, teléfono, identificador de acceso, cédula profesional y especialidad si las registras.',
        'Acceso: contraseña (guardada sólo como huella cifrada, nunca en claro), identificador de tu cuenta de Google si la vinculas, y la fecha y versión de los documentos que aceptaste.',
        'Facturación: estado de tu suscripción y referencias de pago de Stripe. No tratamos los números de tu tarjeta.',
        'Uso y seguridad: dirección IP y navegador en cada acceso y en la bitácora de auditoría del expediente (quién vio, editó o descargó qué y cuándo).',
      ] },
      { title: 'Datos de tus pacientes', body: [
        'Los datos de tus pacientes (incluidos los de salud, que la ley considera sensibles) los decides y capturas tú. Respecto de ellos, tú eres el responsable frente a tus pacientes y Milpa actúa como encargado: los trata sólo por tu cuenta y para darte el servicio, no los usa para fines propios, no los vende ni los comparte salvo con los proveedores de infraestructura de abajo.',
        'Tú debes informar a tus pacientes y obtener su consentimiento expreso. Milpa te ofrece una plantilla de aviso de privacidad para pacientes y un registro del consentimiento en cada expediente.',
      ] },
      { title: 'Finalidades', items: [
        'Necesarias: crear y administrar tu cuenta, darte acceso seguro, prestar el servicio (expediente, planes, documentos, agenda, finanzas), cobrar la suscripción, respaldar la información, prevenir accesos indebidos y cumplir obligaciones legales.',
        'No usamos tus datos para publicidad ni los vendemos.',
      ] },
      { title: 'Proveedores y transferencias', body: ['Para operar, Milpa se apoya en estos proveedores, que tratan datos por cuenta de Milpa y bajo sus instrucciones:'], items: PROVIDERS, after: ['Al aceptar este aviso consientes que tus datos se alojen y respalden en Estados Unidos con esos proveedores.'] },
      { title: 'Almacenamiento y seguridad', body: [
        'La información viaja cifrada (HTTPS), cada cuenta sólo ve sus propios datos, el acceso se protege con límite de intentos y cierre de sesiones, y los respaldos diarios se guardan cifrados fuera del servidor.',
        'En tu navegador sólo guardamos tu sesión y preferencias de la interfaz (almacenamiento local). No usamos cookies de rastreo ni publicidad.',
      ] },
      { title: 'Conservación', body: ['Conservamos los datos de tu cuenta mientras esté activa. Al cancelarla puedes solicitarnos una copia de tu información; después la eliminamos, salvo lo que la ley obligue a conservar. Los respaldos se renuevan y los anteriores se borran según su calendario (hasta 12 meses).'] },
      { title: 'Tus derechos', body: ['Puedes acceder a tus datos, rectificarlos, cancelarlos u oponerte a su tratamiento (derechos ARCO), y revocar tu consentimiento o limitar su uso, escribiendo a [CORREO DE PRIVACIDAD] con tu nombre, el correo de tu cuenta y lo que solicitas. Responderemos en los plazos que establece la ley. Revocar el consentimiento para las finalidades necesarias implica dejar de usar la plataforma.'] },
      { title: 'Cambios a este aviso', body: ['Si este aviso cambia, la plataforma te pedirá leerlo y aceptarlo de nuevo antes de continuar. La fecha de la versión vigente aparece arriba.'] },
    ],
  },

  terms: {
    intro: 'Estos términos regulan el uso de Milpa, plataforma para la práctica profesional de la nutrición. Al crear tu cuenta y aceptarlos, celebras un acuerdo con [RAZÓN SOCIAL] («Milpa»).',
    sections: [
      { title: 'El servicio', body: ['Milpa ofrece, mediante suscripción, herramientas para administrar pacientes, expediente clínico nutricional, planes de alimentación, documentos, agenda y finanzas. Las funciones pueden evolucionar; avisaremos con anticipación de cambios que reduzcan el servicio contratado.'] },
      { title: 'Tu cuenta', body: [
        'Cada cuenta es para un profesional de la nutrición. Eres responsable de la veracidad de tus datos, de guardar tu contraseña y de lo que se haga con tu cuenta. Avísanos de inmediato a [CORREO DE CONTACTO] si sospechas un acceso indebido.',
      ] },
      { title: 'Responsabilidad profesional', body: [
        'Milpa es una herramienta de apoyo. Los cálculos, equivalencias, sugerencias y documentos que genera no sustituyen tu juicio profesional: tú decides el diagnóstico, el tratamiento y lo que entregas a cada paciente, y eres responsable de ello.',
      ] },
      { title: 'Datos de tus pacientes', body: [
        'Tú eres el responsable de los datos de tus pacientes: debes informarles (puedes usar la plantilla de aviso de privacidad para pacientes), obtener su consentimiento expreso para tratar sus datos de salud y conservar el expediente conforme a las normas aplicables. Milpa los trata sólo por tu cuenta, como encargado, según el Aviso de privacidad.',
      ] },
      { title: 'Suscripción, pagos y cancelación', body: [
        'El servicio se paga por adelantado, mensual o anualmente, mediante Stripe, y se renueva solo hasta que lo canceles desde Configuración → Suscripción. La cancelación surte efecto al terminar el periodo pagado; no hay reembolsos por periodos parciales salvo que la ley lo exija. Si un pago falla hay un periodo de gracia de 7 días; después sólo verás la pantalla de pago hasta regularizarla, sin que se borren tus datos.',
        'Los precios pueden cambiar; te avisaremos con al menos 30 días de anticipación y aplicarán desde la siguiente renovación.',
      ] },
      { title: 'Uso permitido', body: ['No puedes usar Milpa para fines ilícitos, intentar acceder a datos de otras cuentas, vulnerar su seguridad, revenderlo o sobrecargarlo intencionalmente. Podemos suspender una cuenta que lo haga, avisándote salvo que la urgencia lo impida.'] },
      { title: 'Disponibilidad y respaldos', body: ['Procuramos que Milpa esté disponible de forma continua y respaldamos la información a diario, pero no garantizamos un servicio sin interrupciones (mantenimiento, fallas de proveedores o de internet). Te recomendamos descargar los documentos que entregas a tus pacientes.'] },
      { title: 'Tu información al terminar', body: ['Si cancelas o se suspende tu cuenta, durante [30] días puedes solicitar una copia de tu información en formato descargable. Después se elimina de la plataforma; las copias en respaldos se borran conforme a su calendario.'] },
      { title: 'Propiedad intelectual', body: ['La plataforma, su diseño y su código son de Milpa. Tu información y la de tus pacientes son tuyas; nos das sólo el permiso necesario para tratarlas y prestarte el servicio.'] },
      { title: 'Limitación de responsabilidad', body: ['En la medida en que la ley lo permita, la responsabilidad de Milpa se limita al monto pagado por tu suscripción en los últimos [12] meses, y no responde por decisiones clínicas ni por daños indirectos. [REVISAR CON ABOGADO]'] },
      { title: 'Cambios a estos términos', body: ['Si cambian, la plataforma te pedirá aceptarlos de nuevo antes de continuar. Si no estás de acuerdo, puedes cancelar tu suscripción.'] },
      { title: 'Ley aplicable', body: ['Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier controversia, las partes se someten a los tribunales de [CIUDAD], salvo lo que dispongan las leyes de protección al consumidor.'] },
    ],
  },
}

// Plantilla del aviso que cada consulta entrega a sus pacientes. Los datos de la consulta se llenan
// con lo que la app conoce; lo que falta queda entre corchetes para completarlo a mano.
export function patientNoticeText({ practiceName, professionalName, address, email } = {}) {
  const responsible = practiceName || '[NOMBRE DE LA CONSULTA]'
  const professional = professionalName || '[NOMBRE DEL NUTRIÓLOGO(A)]'
  return {
    intro: `${responsible} (${professional}) es responsable del tratamiento de sus datos personales, con domicilio en ${address || '[DOMICILIO DE LA CONSULTA]'} y contacto en ${email || '[CORREO DE CONTACTO]'}.`,
    sections: [
      { title: 'Datos que se recaban', body: ['Identificación y contacto (nombre, fecha de nacimiento, sexo, teléfono, correo, domicilio, CURP si la proporciona) y datos de salud: antecedentes, mediciones corporales, estudios de laboratorio, hábitos de alimentación, diagnóstico nutricional y plan de tratamiento. Los datos de salud son sensibles y sólo se tratan con su consentimiento expreso.'] },
      { title: 'Para qué se usan', body: [
        'Brindarle atención nutricional: valoración, diagnóstico, plan de alimentación, seguimiento y documentos de su consulta; integrar y conservar su expediente clínico conforme a las normas aplicables; agendar sus citas y llevar el registro de pagos.',
        'Sólo si usted lo autoriza aparte: enviarle recordatorios y materiales por WhatsApp o correo.',
      ] },
      { title: 'Con quién se comparten', body: [
        'Su expediente se guarda en Milpa, la plataforma que usa la consulta, que lo trata sólo por cuenta de la consulta y se apoya en proveedores de servidor y respaldos cifrados ubicados en Estados Unidos.',
        'No se comparten con terceros sin su consentimiento, salvo los casos que la ley permita (por ejemplo, requerimiento de autoridad competente o atención de una urgencia).',
      ] },
      { title: 'Conservación', body: ['El expediente clínico se conserva por el tiempo que señalan las normas aplicables (al menos cinco años desde el último acto registrado).'] },
      { title: 'Sus derechos', body: [`Puede acceder a sus datos, rectificarlos, cancelarlos, oponerse a su uso o revocar su consentimiento solicitándolo a ${email || '[CORREO DE CONTACTO]'}. Algunas peticiones pueden no proceder sobre el expediente clínico mientras la ley obligue a conservarlo.`] },
      { title: 'Consentimiento', body: ['☐ Consiento el tratamiento de mis datos personales, incluidos mis datos de salud, para las finalidades de atención descritas.', '☐ Autorizo recibir recordatorios y materiales por WhatsApp o correo (opcional).', 'Nombre y firma del paciente (o de su madre, padre o tutor): ______________________________   Fecha: ____________'] },
    ],
  }
}
