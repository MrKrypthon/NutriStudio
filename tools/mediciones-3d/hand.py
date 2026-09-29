"""Mano del evaluador para las guías antropométricas.

Se construye con mallas normales (no metaballs) porque los dedos tienen que quedar separados: con
metaballs, a los radios que necesita un dedo, los vecinos se funden y la mano sale como un mitón.
La palma tampoco es una caja (al suavizarla se redondeaba en una pelota) sino cuatro metacarpianos
en abanico desde la muñeca, que es lo que le da la silueta de mano.

Marco local: +Z hacia donde apuntan los dedos, +X hacia el pulgar, -Y hacia la palma.
"""
import bpy
import bmesh
from math import radians
from mathutils import Matrix, Vector

WRIST = Vector((0.0, 0.0, -0.098))
# (x de la base del dedo, largo del dedo, radio)
FINGERS = [
    (-0.032, 0.076, 0.0090),   # meñique
    (-0.011, 0.090, 0.0098),   # anular
    (0.010, 0.094, 0.0100),    # medio
    (0.031, 0.086, 0.0096),    # índice
]
PHALANX_SPLIT = (0.42, 0.33, 0.25)
# Punto (local) donde se juntan las yemas: la escena alinea este punto con el sitio de medición.
PINCH_CENTER = Vector((0.016, -0.004, 0.084))


def _capsule(bm, start, end, radius, segments=14):
    direction = end - start
    length = direction.length
    if length < 1e-6:
        return
    rot = direction.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    mid = (start + end) / 2
    cyl = bmesh.ops.create_cone(bm, cap_ends=False, segments=segments,
                                radius1=radius, radius2=radius, depth=length)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(mid) @ rot, verts=cyl['verts'])
    for point in (start, end):
        sphere = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=segments // 2, radius=radius)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(point), verts=sphere['verts'])


def _chain_to(bm, start, target, radius, bow=0.012, segments=3):
    """Cadena de falanges de `start` a `target`, arqueada `bow` hacia la palma (-Y)."""
    for step in range(segments):
        t0, t1 = step / segments, (step + 1) / segments
        arc0 = bow * (t0 * (1 - t0) * 4)
        arc1 = bow * (t1 * (1 - t1) * 4)
        a = start.lerp(target, t0) + Vector((0, -arc0, 0))
        b = start.lerp(target, t1) + Vector((0, -arc1, 0))
        _capsule(bm, a, b, radius * (1.0 - 0.09 * step))


def build_hand(name, matrix, material, pinch=0.022, curl=0.0, grip=False, forearm=0.16):
    """Mano del evaluador.

    `pinch` separación entre las yemas de pulgar e índice (pliegues).
    `curl`  cuánto se cierran meñique, anular y medio (0 extendidos, 1 cerrados sobre la palma).
    `grip`  mano tomando un instrumento: todos los dedos se cierran en garra.
    """
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    # palma: metacarpianos en abanico desde la muñeca hasta la base de cada dedo
    for base_x, _, radius in FINGERS:
        _capsule(bm, WRIST + Vector((base_x * 0.35, 0, 0)), Vector((base_x, 0, 0)), radius * 1.25)

    # La pinza se define por dónde deben quedar las yemas: índice y pulgar apuntan a dos objetivos
    # separados exactamente `pinch`, centrados delante de la palma. Así la separación de la pinza
    # es la que dice el parámetro, y no el resultado incidental de ir acumulando ángulos.
    pinch_center = PINCH_CENTER
    index_tip = pinch_center - Vector((pinch / 2, 0, 0))
    thumb_tip = pinch_center + Vector((pinch / 2, 0, 0))

    for index, (base_x, length, radius) in enumerate(FINGERS):
        is_index = index == len(FINGERS) - 1
        point = Vector((base_x, 0, 0))
        if is_index and not grip:
            _chain_to(bm, point, index_tip, radius, bow=0.016)
            continue
        closure = 1.0 if grip else curl
        bend = radians(12 + closure * 62)
        direction = Vector((0, 0, 1))
        for step, fraction in enumerate(PHALANX_SPLIT):
            rot = Matrix.Rotation(bend * (0.45 if step == 0 else 1.0), 4, 'X')
            direction = (rot @ direction).normalized()
            nxt = point + direction * (length * fraction)
            _capsule(bm, point, nxt, radius * (1.0 - 0.09 * step))
            point = nxt

    # muñeca y antebrazo, para que la mano no aparezca flotando
    _capsule(bm, WRIST + Vector((0, 0, 0.012)), WRIST, 0.024)
    _capsule(bm, WRIST, WRIST + Vector((0, 0.012, -forearm)), 0.025)

    bm.to_mesh(mesh)
    bm.free()
    obj.matrix_world = matrix
    obj.data.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = True

    # El pulgar va en su propio objeto, con el origen en el nudillo: así la animación puede abrir y
    # cerrar la pinza girándolo, sin rehacer la malla de la mano en cada cuadro.
    thumb_base = WRIST + Vector((0.020, 0, 0.018))
    knuckle = thumb_base + Vector((0.046, -0.006, 0.034))
    tb = bmesh.new()
    _capsule(tb, thumb_base - knuckle, Vector((0, 0, 0)), 0.0135)
    if grip:
        _chain_to(tb, Vector((0, 0, 0)), Vector((-0.010, -0.030, 0.034)), 0.0125, bow=0.010)
    else:
        _chain_to(tb, Vector((0, 0, 0)), thumb_tip - knuckle, 0.0125, bow=0.012)
    thumb_mesh = bpy.data.meshes.new(name + '_pulgar')
    tb.to_mesh(thumb_mesh)
    tb.free()
    thumb = bpy.data.objects.new(name + '_pulgar', thumb_mesh)
    bpy.context.collection.objects.link(thumb)
    thumb.parent = obj
    thumb.location = knuckle
    thumb.data.materials.append(material)
    for poly in thumb_mesh.polygons:
        poly.use_smooth = True
    return obj, thumb


def hand_material(name='PielMano'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.88, 0.65, 0.57, 1)
    bsdf.inputs['Roughness'].default_value = 0.64
    return mat
