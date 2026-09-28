"""Cuerpo humano base para las guías antropométricas (metaballs).

Se construye con metaballs que se funden entre sí, evitando los escalones y pestañas que el
modificador Skin deja en las ramificaciones (pelvis, hombros). Dos reglas del ajuste, medidas
empíricamente con este mismo motor:

  * el radio de la metaball rinde en pantalla ~0.55 de su valor (umbral 0.6, rigidez 2.0), así que
    el radio se calcula como grosor_deseado / BLEND;
  * las esferas sólo se funden si su separación es menor que su radio, por eso las cadenas se
    interpolan con un paso pequeño en vez de poner una esfera por articulación.

Después se convierte a malla para poder lanzar rayos sobre la piel y colocar cada sitio de
medición con su normal real. Unidades en metros, sujeto de pie mirando hacia -Y. El lado derecho
anatómico es x < 0, que es el que marca el protocolo ISAK.
"""
import bpy
from mathutils import Matrix, Vector

BLEND = 0.55   # proporción entre el radio de la metaball y el grosor que se ve
STEP = 0.030   # paso de interpolación de las cadenas (m)

# Articulaciones de las extremidades: (x, y, z, grosor deseado)
ARM_JOINTS = [
    (0.168, 0.000, 1.420, 0.050),   # hombro
    (0.248, 0.010, 1.285, 0.046),   # brazo medio (nivel del pliegue tricipital/bicipital)
    (0.300, 0.016, 1.120, 0.040),   # codo
    (0.340, 0.022, 0.960, 0.033),   # antebrazo
    (0.360, 0.026, 0.858, 0.027),   # muñeca
    (0.368, 0.028, 0.790, 0.029),   # mano
]
LEG_JOINTS = [
    (0.092, 0.004, 0.895, 0.066),   # cadera
    (0.104, 0.004, 0.745, 0.060),   # muslo medio (nivel del pliegue del muslo)
    (0.108, 0.004, 0.540, 0.048),   # rodilla
    (0.110, 0.004, 0.355, 0.047),   # pantorrilla (perímetro máximo)
    (0.111, 0.002, 0.150, 0.029),   # tobillo
    (0.111, -0.030, 0.055, 0.027),  # talón
    (0.111, -0.090, 0.035, 0.025),  # punta del pie
]
# Tronco: (z, semiancho de las columnas, grosor deseado, desplazamiento en Y)
TRUNK_LEVELS = [
    (1.500, 0.000, 0.048, 0.010),   # cuello
    (1.450, 0.055, 0.068, 0.004),   # hombros
    (1.390, 0.072, 0.074, 0.000),   # tórax alto (nivel pectoral)
    (1.330, 0.076, 0.076, -0.004),  # tórax
    (1.270, 0.074, 0.074, -0.006),  # tórax bajo (nivel axilar medial)
    (1.210, 0.064, 0.070, -0.006),  # cintura alta
    (1.150, 0.058, 0.068, -0.004),  # cintura
    (1.100, 0.058, 0.070, -0.002),  # abdomen (nivel abdominal/supraespinal)
    (1.050, 0.066, 0.072, 0.000),   # caderas altas (nivel cresta ilíaca)
    (1.000, 0.074, 0.076, 0.004),   # pelvis
    (0.950, 0.072, 0.074, 0.006),   # glúteos
    (0.905, 0.058, 0.068, 0.004),   # base de la pelvis
]
HEAD_LEVELS = [
    (1.565, 0.000, 0.046, 0.008),
    (1.620, 0.022, 0.062, 0.006),
    (1.678, 0.016, 0.054, 0.004),
]


def _interpolate(joints, step=STEP):
    """Puntos (co, grosor) densificados a lo largo de una cadena de articulaciones."""
    points = []
    for (x1, y1, z1, r1), (x2, y2, z2, r2) in zip(joints, joints[1:]):
        a, b = Vector((x1, y1, z1)), Vector((x2, y2, z2))
        segments = max(1, int((b - a).length / step))
        for i in range(segments):
            t = i / segments
            points.append((a.lerp(b, t), r1 + (r2 - r1) * t))
    x, y, z, r = joints[-1]
    points.append((Vector((x, y, z)), r))
    return points


def _abduct(points, pivot, degrees):
    """Gira una cadena alrededor del hombro en el plano frontal (eje Y).

    Los sitios del tronco (cresta ilíaca, supraespinal, axilar medial) se miden con el brazo
    derecho abducido o cruzado sobre el pecho, justo para dejar libre la línea axilar; sin eso el
    brazo colgante tapa el sitio tanto en la realidad como en la guía.
    """
    from math import radians as _rad
    rot = Matrix.Rotation(_rad(degrees), 4, 'Y')
    moved = []
    for co, thickness in points:
        moved.append((pivot + rot @ (co - pivot), thickness))
    return moved


def right_arm_point(point, degrees):
    """Dónde acaba un punto del brazo derecho cuando el brazo se abduce `degrees`.

    Las especificaciones de los sitios están escritas sobre el cuerpo en reposo. Si el sitio está en
    el brazo y la pose lo abduce, hay que mover también el punto: si no, el rayo de búsqueda apunta
    a donde el brazo ya no está y no encuentra piel.
    """
    if not degrees:
        return Vector(point)
    shoulder = Vector((-ARM_JOINTS[0][0], ARM_JOINTS[0][1], ARM_JOINTS[0][2]))
    return _abduct([(Vector(point), 0.0)], shoulder, -degrees)[0][0]


def right_arm_vector(vector, degrees):
    """La misma abducción aplicada a una dirección (sin trasladar), para girar los rayos."""
    from math import radians as _rad
    if not degrees:
        return Vector(vector)
    return Matrix.Rotation(_rad(-degrees), 4, 'Y') @ Vector(vector)


def build_body(name='Cuerpo', resolution=0.009, right_arm_abduction=0.0):
    mball = bpy.data.metaballs.new(name)
    mball.resolution = resolution
    mball.render_resolution = resolution
    obj = bpy.data.objects.new(name, mball)
    bpy.context.collection.objects.link(obj)

    def add(co, thickness):
        el = mball.elements.new(type='BALL')
        el.co = Vector(co)
        el.radius = thickness / BLEND
        el.stiffness = 2.0
        return el

    for z, half_width, thickness, y in TRUNK_LEVELS + HEAD_LEVELS:
        columns = (0.0,) if half_width <= 0.001 else (-half_width, 0.0, half_width)
        for x in columns:
            add((x, y, z), thickness)
    for side in (-1, 1):
        arm = [(Vector((side * co.x, co.y, co.z)), thickness) for co, thickness in _interpolate(ARM_JOINTS)]
        if side == -1 and right_arm_abduction:
            shoulder = Vector((side * ARM_JOINTS[0][0], ARM_JOINTS[0][1], ARM_JOINTS[0][2]))
            arm = _abduct(arm, shoulder, -right_arm_abduction)
        for co, thickness in arm:
            add(co, thickness)
        for co, thickness in _interpolate(LEG_JOINTS):
            add((side * co.x, co.y, co.z), thickness)

    # Se convierte a malla porque las guías lanzan rayos contra la piel para obtener el punto y la
    # normal exactos de cada sitio, y ray_cast no opera sobre una metaball sin convertir.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    mesh_obj = bpy.context.object
    mesh_obj.name = name
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True
    return mesh_obj


def skin_material(name='Piel'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.93, 0.74, 0.65, 1)
    bsdf.inputs['Roughness'].default_value = 0.68
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
    return mat
