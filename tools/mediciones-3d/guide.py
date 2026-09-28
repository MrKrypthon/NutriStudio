"""Construye la escena 3D de la guía de un pliegue cutáneo y renderiza la animación.

Cada guía muestra, en bucle: la marca del sitio sobre la piel con la dirección del pliegue, el
pliegue levantado (como lo toma el evaluador con los dedos) y el plicómetro aplicado
perpendicular al pliegue, a un centímetro de los dedos.
"""
import bpy
import bmesh
import os
import sys
from math import radians, cos, sin
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body as body_mod  # noqa: E402

MARK_COLOR = (0.72, 0.09, 0.16, 1)      # marca del sitio (rojo clínico)
CALIPER_COLOR = (0.16, 0.17, 0.22, 1)   # plicómetro (acero oscuro)
CALIPER_TIP = (0.85, 0.86, 0.90, 1)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = True
    world = bpy.data.worlds.new('W')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.90, 0.92, 0.96, 1)
    bg.inputs[1].default_value = 0.55
    return scene


def emission_material(name, color, strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs[0].default_value = color
    emit.inputs[1].default_value = strength
    nt.links.new(emit.outputs[0], out.inputs[0])
    return mat


def solid_material(name, color, roughness=0.35, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat


def add_light(loc, energy, size=1.5):
    data = bpy.data.lights.new('L', 'AREA')
    data.energy = energy
    data.size = size
    obj = bpy.data.objects.new('L', data)
    obj.location = loc
    bpy.context.collection.objects.link(obj)
    return obj


def surface_hit(body, point, ray):
    """Lanza un rayo hacia el cuerpo y devuelve (punto en la piel, normal)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    direction = Vector(ray).normalized()
    origin = Vector(point) + direction * 0.9
    hit, location, normal, _ = evaluated.ray_cast(origin, -direction, distance=2.0)
    if not hit:
        return Vector(point), direction
    return location, normal.normalized()


def tangent_frame(normal, fold_deg):
    """Marco (fold_axis, across_axis, normal) en la piel: fold_axis es la dirección del pliegue."""
    up = Vector((0, 0, 1))
    if abs(normal.dot(up)) > 0.95:
        up = Vector((0, 1, 0))
    tangent_v = (up - normal * up.dot(normal)).normalized()   # "vertical" proyectada en la piel
    tangent_h = normal.cross(tangent_v).normalized()          # horizontal en la piel
    angle = radians(fold_deg)
    fold_axis = (tangent_v * cos(angle) + tangent_h * sin(angle)).normalized()
    across = normal.cross(fold_axis).normalized()
    return fold_axis, across, normal


def frame_matrix(origin, x_axis, y_axis, z_axis):
    m = Matrix().to_3x3()
    m.col[0] = x_axis
    m.col[1] = y_axis
    m.col[2] = z_axis
    mat = m.to_4x4()
    mat.translation = origin
    return mat


def add_box(name, size, matrix, material):
    """Caja con el tamaño horneado en la malla (la escala del objeto queda en 1).

    Así, animar o reasignar `scale`/`location` de estos objetos nunca deforma su tamaño real.
    """
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.data.transform(Matrix.Diagonal(Vector(size).to_4d()))
    obj.matrix_world = matrix
    obj.data.materials.append(material)
    return obj


def build_mark(origin, fold_axis, across, normal, material):
    """Cruz del sitio + línea discontinua con la dirección del pliegue."""
    parts = []
    lift = normal * 0.0015
    cross_len = 0.022
    for axis in (fold_axis, across):
        m = frame_matrix(origin + lift, fold_axis, across, normal)
        obj = add_box('mark', (cross_len if axis is fold_axis else 0.0035,
                               0.0035 if axis is fold_axis else cross_len, 0.001), m, material)
        parts.append(obj)
    # línea de dirección del pliegue (segmentos)
    for i in (-2, -1, 1, 2):
        pos = origin + lift + fold_axis * (i * 0.017)
        m = frame_matrix(pos, fold_axis, across, normal)
        parts.append(add_box('dash', (0.010, 0.0025, 0.0008), m, material))
    return parts


def build_fold(origin, fold_axis, across, normal, material, size=(0.064, 0.024, 0.052)):
    """Pliegue levantado: cresta alargada en la dirección del pliegue.

    El tamaño se hornea en la malla (no en la escala del objeto) porque la animación anima
    `scale` para levantar/bajar el pliegue: si el tamaño viviera en la escala del objeto, el
    keyframe la sobreescribiría y el pliegue pasaría a medir un metro.
    """
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = 'Pliegue'
    obj.data.transform(Matrix.Diagonal(Vector(size).to_4d()))
    # la base del pliegue queda al ras de la piel: se sube media altura
    obj.data.transform(Matrix.Translation(Vector((0, 0, size[2] * 0.30))))
    obj.matrix_world = frame_matrix(origin, fold_axis, across, normal)
    sub = obj.modifiers.new('S', 'SUBSURF')
    sub.levels = 3
    sub.render_levels = 3
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


ARM_LEN = 0.078   # largo del brazo desde la bisagra hasta la punta
CALIPER_OFFSET = 0.017  # el plicómetro se aplica ~1 cm de los dedos, sobre el eje del pliegue


def build_fingers(origin, fold_axis, across, normal, material):
    """Pulgar e índice del evaluador tomando el pliegue en el sitio marcado.

    Se modelan como dos yemas redondeadas que aprietan a ambos lados del pliegue; su separación
    se anima junto con el pliegue (`location` local en el eje transversal).
    """
    holder = bpy.data.objects.new('Dedos', None)
    bpy.context.collection.objects.link(holder)
    holder.matrix_world = frame_matrix(origin, fold_axis, across, normal)

    pads = []
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=24, ring_count=14)
        pad = bpy.context.object
        pad.name = 'yema_%d' % sign
        pad.data.transform(Matrix.Diagonal(Vector((0.024, 0.015, 0.019)).to_4d()))
        pad.parent = holder
        pad.location = (0, sign * 0.022, 0.012)
        pad.data.materials.append(material)
        for poly in pad.data.polygons:
            poly.use_smooth = True
        pads.append(pad)
    return holder, pads


def add_cylinder(name, radius, depth, matrix, material, axis='X'):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=28)
    obj = bpy.context.object
    obj.name = name
    if axis == 'X':
        obj.data.transform(Matrix.Rotation(radians(90), 4, 'Y'))
    elif axis == 'Y':
        obj.data.transform(Matrix.Rotation(radians(90), 4, 'X'))
    obj.matrix_world = matrix
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def build_caliper(origin, fold_axis, across, normal, material, tip_material):
    """Plicómetro tipo pinza: dos brazos que giran sobre una bisagra, puntas planas y dial.

    Marco local: X = eje del pliegue, Y = ancho del pliegue (por donde cierran las puntas),
    Z = normal de la piel. Los brazos giran alrededor de X, como el instrumento real; las puntas
    quedan siempre paralelas a la piel y perpendiculares al pliegue.
    """
    holder = bpy.data.objects.new('Plicometro', None)
    bpy.context.collection.objects.link(holder)
    holder.matrix_world = frame_matrix(origin + fold_axis * CALIPER_OFFSET + normal * 0.030, fold_axis, across, normal)

    hinge_z = ARM_LEN
    arms = []
    for sign in (-1, 1):
        pivot = bpy.data.objects.new('brazo_%d' % sign, None)
        bpy.context.collection.objects.link(pivot)
        pivot.parent = holder
        pivot.location = (0, 0, hinge_z)

        arm = add_box('arm', (0.007, 0.010, ARM_LEN), Matrix.Identity(4), material)
        arm.parent = pivot
        arm.location = (0, 0, -ARM_LEN / 2)

        # punta plana (cara de medición) mirando hacia la otra punta
        tip = add_box('tip', (0.020, 0.016, 0.005), Matrix.Identity(4), tip_material)
        tip.parent = pivot
        tip.location = (0, sign * 0.006, -ARM_LEN + 0.002)
        arms.append(pivot)

    # dial redondo sobre la bisagra: hace que se lea como plicómetro de un vistazo
    dial = add_cylinder('dial', 0.019, 0.008, Matrix.Identity(4), material, axis='X')
    dial.parent = holder
    dial.location = (0, 0, hinge_z + 0.018)
    face = add_cylinder('dial_face', 0.015, 0.010, Matrix.Identity(4), tip_material, axis='X')
    face.parent = holder
    face.location = (0, 0, hinge_z + 0.018)
    hinge = add_cylinder('hinge', 0.009, 0.026, Matrix.Identity(4), material, axis='X')
    hinge.parent = holder
    hinge.location = (0, 0, hinge_z)
    return holder, arms


def jaw_angle(opening):
    """Ángulo de cada brazo (rad) para una separación `opening` (m) entre las puntas."""
    from math import asin
    ratio = max(-1.0, min(1.0, (opening / 2) / ARM_LEN))
    return asin(ratio)
