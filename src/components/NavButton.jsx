// Botón de navegación (cambiar de pestaña, tipo o sección) que sigue funcionando dentro de un
// <fieldset disabled>. El expediente bloquea una consulta cerrada con un fieldset deshabilitado, y
// eso apaga todo <button> que contiene; un <div role="button"> no es control de formulario, así que
// se puede revisar una visita pasada completa mientras los campos de verdad siguen bloqueados.
export default function NavButton({ className = '', disabled = false, onClick, children, ...rest }) {
  const activate = () => { if (!disabled) onClick?.() }
  return <div
    role="button"
    tabIndex={disabled ? -1 : 0}
    aria-disabled={disabled || undefined}
    className={className + (disabled ? ' is-disabled' : '')}
    onClick={activate}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }}
    {...rest}
  >{children}</div>
}
