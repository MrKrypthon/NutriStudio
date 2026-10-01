import { useState } from 'react'
import FoodIcon from './FoodIcon.jsx'
import { ALL_FREQUENCY_ITEMS, FOOD_GROUPS, FOODS, FREQUENCY_BUCKETS } from '../lib/foodFrequencyItems.js'
import { assignItem, itemsInBucket, unassignItem, unassignedItems } from '../lib/foodFrequencyMap.js'

/**
 * Tablero de "Frecuencia de consumo de alimentos": arrastra un alimento a la frecuencia con la que
 * se come, o si prefieres sin arrastrar, haz clic en el alimento y luego en la frecuencia. Las dos
 * formas llaman al mismo `assign`, así que el resultado es idéntico — es sólo otra manera de hacer
 * el mismo gesto, pensada para pantalla táctil o para cuando arrastrar no es cómodo.
 *
 * Un alimento vive en un solo lugar a la vez: clasificarlo lo saca de la paleta y lo manda a su
 * frecuencia (como ordenar tarjetas en un tablero), y sacarlo de la frecuencia lo devuelve a la
 * paleta. Así el panel de la izquierda muestra, de un vistazo, qué falta por clasificar.
 */
export default function FoodFrequencyBoard({ value, onChange, disabled }) {
  const map = value || {}
  // Qué alimento se "levantó" con un clic, a la espera de que se elija su frecuencia con otro clic.
  const [pickedKey, setPickedKey] = useState(null)

  const assign = (itemKey, bucketKey) => { if (!disabled) onChange(assignItem(map, itemKey, bucketKey)) }
  const remove = (itemKey) => { if (!disabled) onChange(unassignItem(map, itemKey)) }

  const onItemClick = (itemKey) => { if (!disabled) setPickedKey((prev) => (prev === itemKey ? null : itemKey)) }
  // Clasifica lo "levantado" con un clic. El encabezado y el cuerpo del bucket llaman a lo mismo:
  // toda la tarjeta es un blanco válido, no sólo el título.
  const dropOnBucket = (bucketKey) => {
    if (pickedKey) { assign(pickedKey, bucketKey); setPickedKey(null) }
  }

  const onDragStart = (event, itemKey) => {
    if (disabled) { event.preventDefault(); return }
    event.dataTransfer.setData('text/plain', itemKey)
    event.dataTransfer.effectAllowed = 'move'
    // Arrastrar y seleccionar son dos caminos al mismo gesto: si había algo "levantado" con clic,
    // empezar a arrastrar otra cosa lo cancela para no mezclar los dos modos a la vez.
    setPickedKey(null)
  }
  const onDragOverBucket = (event) => { if (!disabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }
  const onDropOnBucket = (event, bucketKey) => {
    event.preventDefault()
    if (disabled) return
    const itemKey = event.dataTransfer.getData('text/plain')
    if (itemKey) assign(itemKey, bucketKey)
  }

  const renderPaletteGroup = (title, badgeClass, items) => {
    const pending = unassignedItems(map, items.map((i) => i.key), FREQUENCY_BUCKETS.map((b) => b.key))
    const pendingSet = new Set(pending)
    const visible = items.filter((item) => pendingSet.has(item.key))
    return <div className="food-palette">
      <div className={'food-palette-badge ' + badgeClass}>{title}</div>
      <div className="food-palette-box">
        {visible.length === 0
          ? <p className="muted food-palette-empty">Ya clasificaste todo{title === 'Grupos' ? 's los grupos' : ' aquí'}.</p>
          : <div className="food-chip-grid">{visible.map((item) => <FoodChip key={item.key} item={item} draggable={!disabled} picked={pickedKey === item.key} onClick={() => onItemClick(item.key)} onDragStart={(e) => onDragStart(e, item.key)} />)}</div>}
      </div>
    </div>
  }

  return <div className="food-frequency-board">
    <div className="food-frequency-sources">
      {renderPaletteGroup('Grupos', 'food-badge-groups', FOOD_GROUPS)}
      {renderPaletteGroup('Alimentos', 'food-badge-foods', FOODS)}
    </div>
    <div className="food-frequency-buckets">
      {pickedKey && <p className="food-pick-hint">Elige la frecuencia de <b>{ALL_FREQUENCY_ITEMS.find((i) => i.key === pickedKey)?.label}</b> ↓</p>}
      {FREQUENCY_BUCKETS.map((bucket) => {
        const items = itemsInBucket(map, bucket.key, ALL_FREQUENCY_ITEMS.map((i) => i.key))
        return <div
          className={'food-bucket' + (pickedKey ? ' food-bucket-targetable' : '')}
          key={bucket.key}
          onDragOver={onDragOverBucket}
          onDrop={(e) => onDropOnBucket(e, bucket.key)}
        >
          <button type="button" className="food-bucket-head" disabled={disabled} onClick={() => dropOnBucket(bucket.key)}>{bucket.label}</button>
          <div className="food-bucket-body" role="button" tabIndex={-1} onClick={() => dropOnBucket(bucket.key)}>
            {items.length === 0
              ? <span className="food-bucket-empty">Arrastra aquí, o elige un alimento y toca esta frecuencia.</span>
              : items.map((key) => <FoodChip key={key} item={ALL_FREQUENCY_ITEMS.find((i) => i.key === key)} compact removable={!disabled} onRemove={() => remove(key)} />)}
          </div>
        </div>
      })}
    </div>
  </div>
}

function FoodChip({ item, draggable, picked, compact, removable, onClick, onDragStart, onRemove }) {
  if (!item) return null
  return <div
    className={'food-chip food-color-' + item.color + (picked ? ' picked' : '') + (compact ? ' compact' : '')}
    draggable={draggable}
    onDragStart={onDragStart}
    onClick={onClick}
    title={compact ? item.label : `${item.label} — arrastra o haz clic`}
  >
    <span className="food-chip-badge"><FoodIcon name={item.key} /></span>
    <span className="food-chip-label">{item.label}</span>
    {removable && <button type="button" className="food-chip-remove" title="Quitar de esta frecuencia" onClick={(e) => { e.stopPropagation(); onRemove() }}>×</button>}
  </div>
}
