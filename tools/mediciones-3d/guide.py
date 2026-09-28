"""Construye la escena 3D de la guía de un pliegue cutáneo y renderiza la animación.

Cada guía muestra, en bucle: la marca del sitio sobre la piel con la dirección del pliegue, el
pliegue levantado (como lo toma el evaluador con los dedos) y el plicómetro aplicado
perpendicular al pliegue, a un centímetro de los dedos.
"""
import bpy
import bmesh
import os
import sys
from math import cos, pi, radians, sin
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


def surface_hit(body, point, ray, reach=0.9):
    """Lanza un rayo hacia el cuerpo y devuelve (punto en la piel, normal).

    `reach` es desde qué distancia se lanza. En un accidente óseo de una extremidad hay que
    acortarlo (~0.09 m): desde lejos, un rayo dirigido a la cara interna del codo atraviesa el hueco
    entre el brazo y el tronco y acaba impactando en el tronco.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    direction = Vector(ray).normalized()
    origin = Vector(point) + direction * reach
    hit, location, normal, _ = evaluated.ray_cast(origin, -direction, distance=reach * 2)
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


def build_mark(origin, fold_axis, across, normal, material, dashes=True):
    """Cruz del sitio + línea discontinua con la dirección del pliegue.

    `dashes=False` deja sólo la cruz: en perímetros y diámetros no hay una dirección de pliegue que
    señalar, y la línea discontinua competiría con la cinta o con la barra del antropómetro.
    """
    parts = []
    lift = normal * 0.0015
    cross_len = 0.022
    for axis in (fold_axis, across):
        m = frame_matrix(origin + lift, fold_axis, across, normal)
        obj = add_box('mark', (cross_len if axis is fold_axis else 0.0035,
                               0.0035 if axis is fold_axis else cross_len, 0.001), m, material)
        parts.append(obj)
    # línea de dirección del pliegue (segmentos)
    for i in (-2, -1, 1, 2) if dashes else ():
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
CALIPER_OFFSET = -0.020  # el plicómetro se aplica ~1 cm de los dedos, sobre el eje del pliegue


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


def place_hand(origin, fold_axis, across, normal, material, pinch=0.030, curl=0.55, lift=0.004,
               roll=-70, scale=0.85, forearm=0.11):
    """Coloca la mano del evaluador tomando el pliegue en el sitio.

    El marco se elige para que la pinza (pulgar-índice) cierre sobre el ancho del pliegue y la palma
    quede mirando a la piel: X = ancho del pliegue, Y = normal (palma hacia la piel), Z = eje del
    pliegue (los dedos siguen la dirección en que corre el pliegue).
    """
    import hand as hand_mod
    # `roll` gira la mano alrededor del propio eje de la pinza: sirve para que el brazo del
    # evaluador entre por el lado contrario a la cámara y no tape el sitio ni el instrumento.
    spin = Matrix.Rotation(radians(roll), 4, across)
    up = (spin @ normal).normalized()
    fingers = (spin @ fold_axis).normalized()
    rotation = frame_matrix(Vector((0, 0, 0)), across, up, fingers).to_3x3()
    target = origin + normal * lift
    location = target - (rotation @ (hand_mod.PINCH_CENTER * scale))
    matrix = frame_matrix(location, across, up, fingers) @ Matrix.Scale(scale, 4)
    return hand_mod.build_hand('ManoEvaluador', matrix, material, pinch=pinch, curl=curl,
                               forearm=forearm)


def place_grip_hand(name, origin, palm_out, fingers, material, scale=0.78, forearm=0.11):
    """Mano del evaluador empuñando un instrumento (cinta, antropómetro).

    `palm_out` es hacia dónde mira el dorso: la palma queda del lado opuesto, es decir contra el
    instrumento. `fingers` es hacia dónde apuntan los dedos antes de cerrarse en garra.
    """
    import hand as hand_mod
    palm_out = Vector(palm_out).normalized()
    fingers = Vector(fingers)
    fingers = (fingers - palm_out * fingers.dot(palm_out)).normalized()
    side = palm_out.cross(fingers).normalized()
    matrix = frame_matrix(Vector(origin), side, palm_out, fingers) @ Matrix.Scale(scale, 4)
    obj, thumb = hand_mod.build_hand(name, matrix, material, grip=True, forearm=forearm)
    return obj, thumb


def parent_keep_transform(child, parent):
    """Emparenta sin mover al hijo, para que siga al instrumento durante la animación."""
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = world


def ring_points(body, center, axis, samples=64, offset=0.004, max_radius=0.6):
    """Contorno real del cuerpo alrededor de `axis` a la altura de `center`.

    Para cada ángulo se lanza un rayo desde fuera hacia el eje: el impacto da el punto de piel, así
    que la cinta sigue la silueta verdadera (un torso no es un círculo) en vez de aproximarla.

    `max_radius` acota desde qué distancia se lanza el rayo. En una extremidad hay que mantenerlo
    corto (~0.10 m): con un radio grande, los rayos que apuntan hacia adentro pasan de largo el
    brazo y golpean el tronco, y la "cinta" sale enganchada al torso.
    """
    axis = Vector(axis).normalized()
    reference = Vector((0, 0, 1)) if abs(axis.dot(Vector((0, 0, 1)))) < 0.9 else Vector((1, 0, 0))
    u = (reference - axis * reference.dot(axis)).normalized()
    v = axis.cross(u).normalized()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)

    raw = []
    for i in range(samples):
        angle = 2 * pi * i / samples
        direction = (u * cos(angle) + v * sin(angle)).normalized()
        origin = center + direction * max_radius
        hit, location, normal, _ = evaluated.ray_cast(origin, -direction, distance=max_radius * 2)
        if hit and (location - center).length <= max_radius * 0.95:
            raw.append((direction, location + normal.normalized() * offset))
        else:
            raw.append((direction, None))

    # Un rayo puede perder el miembro o colarse a una parte vecina (el brazo colgante junto al
    # tronco, por ejemplo). Esos ángulos se marcan vacíos y se rellenan interpolando el radio de los
    # vecinos válidos, de modo que la cinta siga siendo un anillo cerrado y suave.
    radii = [((point - center).length if point is not None else None) for _, point in raw]
    valid = [i for i, r in enumerate(radii) if r is not None]
    if not valid:
        return [center + direction * 0.05 for direction, _ in raw]
    for i, radius in enumerate(radii):
        if radius is not None:
            continue
        before = max((j for j in valid if j <= i), default=valid[-1])
        after = min((j for j in valid if j >= i), default=valid[0])
        radii[i] = (radii[before] + radii[after]) / 2

    points = []
    for (direction, point), radius in zip(raw, radii):
        points.append(point if point is not None else center + direction * radius)
    return points


def ring_frame(axis):
    """Marco ortonormal (u, v, axis) del plano en que se apoya la cinta."""
    axis = Vector(axis).normalized()
    reference = Vector((0, 0, 1)) if abs(axis.dot(Vector((0, 0, 1)))) < 0.9 else Vector((1, 0, 0))
    u = (reference - axis * reference.dot(axis)).normalized()
    v = axis.cross(u).normalized()
    return u, v, axis


def build_tape(body, center, axis, material, width=0.016, offset=0.004, samples=64, max_radius=0.6):
    """Cinta métrica ceñida al contorno del cuerpo en ese nivel.

    La malla se guarda en coordenadas locales del anillo (u, v, eje) y el objeto se coloca con su
    matriz: así, animar `scale` en (s, s, 1) afloja o ciñe la cinta radialmente sin deformar su
    ancho ni sobreescribir ningún tamaño, porque el tamaño vive en la malla y no en la escala.
    """
    u, v, axis = ring_frame(axis)
    center = Vector(center)
    points = ring_points(body, center, axis, samples=samples, offset=offset, max_radius=max_radius)
    mesh = bpy.data.meshes.new('Cinta')
    obj = bpy.data.objects.new('Cinta', mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    top, bottom = [], []
    for point in points:
        local = point - center
        local = Vector((local.dot(u), local.dot(v), local.dot(axis)))
        top.append(bm.verts.new(local + Vector((0, 0, width / 2))))
        bottom.append(bm.verts.new(local - Vector((0, 0, width / 2))))
    bm.verts.ensure_lookup_table()
    for i in range(len(points)):
        j = (i + 1) % len(points)
        bm.faces.new((top[i], top[j], bottom[j], bottom[i]))
    bm.to_mesh(mesh)
    bm.free()
    obj.matrix_world = frame_matrix(center, u, v, axis)
    obj.data.materials.append(material)
    solid = obj.modifiers.new('Grosor', 'SOLIDIFY')
    solid.thickness = 0.0016
    for poly in mesh.polygons:
        poly.use_smooth = False
    return obj, points


def tape_material(name='Cinta'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.96, 0.76, 0.15, 1)
    bsdf.inputs['Roughness'].default_value = 0.55
    return mat


def build_anthropometer(point_a, point_b, out, material, tip_material, arm_len=0.085,
                        bar_extra=0.075, thickness=1.0):
    """Antropómetro / paquímetro: barra graduada con dos ramas rectas que cierran sobre dos puntos.

    A diferencia del plicómetro (que pinza un pliegue), aquí las ramas quedan paralelas y sus puntas
    se apoyan en los dos accidentes óseos; por eso la barra va paralela al eje de la medición y las
    ramas bajan perpendiculares a ella.
    """
    axis = (point_b - point_a)
    span = axis.length
    axis = axis.normalized()
    out = Vector(out).normalized()
    out = (out - axis * out.dot(axis)).normalized()
    side = axis.cross(out).normalized()
    middle = (point_a + point_b) / 2

    holder = bpy.data.objects.new('Antropometro', None)
    bpy.context.collection.objects.link(holder)
    holder.matrix_world = frame_matrix(middle + out * arm_len, axis, side, out)

    bar = add_box('barra', (span + bar_extra, 0.011 * thickness, 0.013 * thickness),
                  Matrix.Identity(4), material)
    bar.parent = holder
    bar.location = (0, 0, 0.012 * thickness)

    branches = []
    for sign in (-1, 1):
        branch = bpy.data.objects.new('rama_%d' % sign, None)
        bpy.context.collection.objects.link(branch)
        branch.parent = holder
        branch.location = (sign * span / 2, 0, 0)

        shaft = add_box('vastago', (0.010 * thickness, 0.010 * thickness, arm_len),
                        Matrix.Identity(4), material)
        shaft.parent = branch
        shaft.location = (0, 0, -arm_len / 2)

        tip = add_box('punta', (0.006 * thickness, 0.020 * thickness, 0.012 * thickness),
                      Matrix.Identity(4), tip_material)
        tip.parent = branch
        tip.location = (0, 0, -arm_len + 0.004 * thickness)
        branches.append(branch)
    return holder, branches, span
