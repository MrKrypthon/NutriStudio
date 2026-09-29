"""Renderiza la guía animada de un perímetro o de un diámetro. Uso:
    blender -b -P render_girth.py -- <slug> [--still] [--out DIR]

Mismo modelo que `render_site.py` (pliegues): cuerpo con metaballs, el instrumento colocado con
rayos contra la piel real, manos del evaluador ejecutando el movimiento, y un ciclo de 48 cuadros
que se repite en bucle.
"""
import bpy
import os
import sys
from math import radians, sin
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import body as body_mod   # noqa: E402
import guide as g         # noqa: E402
import hand as hand_mod   # noqa: E402
from sites_girth import BY_SLUG  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SLUG = argv[0] if argv else 'cintura-cm'
STILL = '--still' in argv
OUT = HERE + '/out'
if '--out' in argv:
    OUT = argv[argv.index('--out') + 1]
os.makedirs(OUT, exist_ok=True)

SITE = BY_SLUG[SLUG]
FPS = 12
FRAMES = 48

scene = g.clear_scene()
scene.render.resolution_x = 360
scene.render.resolution_y = 360
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES

body = body_mod.build_body(right_arm_abduction=SITE.get('abduction', 0.0))
body.data.materials.append(body_mod.skin_material())

mark_mat = g.emission_material('Marca', g.MARK_COLOR, 1.4)
steel = g.solid_material('Acero', g.CALIPER_COLOR, roughness=0.32, metallic=0.85)
tip_mat = g.solid_material('Punta', g.CALIPER_TIP, roughness=0.22, metallic=0.9)
hand_mat = hand_mod.hand_material()

animated = []


def cam_axes_girth():
    """Perímetro: cinta ceñida al contorno + dos manos que la tensan al frente."""
    center = Vector(SITE['center'])
    axis = Vector(SITE['axis']).normalized()
    tape, points = g.build_tape(body, center, axis, g.tape_material(),
                                max_radius=SITE['max_radius'])

    # El "frente" del anillo es el punto más cercano al observador (-Y): ahí se cruzan los extremos
    # de la cinta y ahí van las manos, que es como se toma la medida en la práctica.
    front_dir = Vector((0, -1, 0))
    front_dir = (front_dir - axis * front_dir.dot(axis)).normalized()

    def radial_of(point):
        offset = point - center
        return (offset - axis * offset.dot(axis)).normalized()

    front_index = max(range(len(points)), key=lambda i: radial_of(points[i]).dot(front_dir))
    front = points[front_index]
    radial = radial_of(front)
    tangent = axis.cross(radial).normalized()

    g.build_mark(front + radial * 0.001, tangent, axis, radial, mark_mat, dashes=False)

    # Las manos se colocan sobre el propio anillo, a un arco fijo del frente, y no a una distancia
    # recta: así caen siempre sobre la piel tanto en un torso ancho como en una muñeca delgada.
    hands = []
    arc = max(4, len(points) // 9)
    for sign in (-1, 1):
        at = points[(front_index + sign * arc) % len(points)]
        out = radial_of(at)
        along = axis.cross(out).normalized()
        origin = at + out * 0.024 - axis * 0.010
        # Los dedos apuntan hacia el frente de la cinta y algo hacia arriba: así los antebrazos
        # entran por abajo y en diagonal, y no cruzan el encuadre tapando la cinta.
        obj, thumb = g.place_grip_hand('Mano_%d' % sign, origin, out,
                                       -along * sign + axis * 0.55,
                                       hand_mat, scale=0.62, forearm=0.10)
        g.parent_keep_transform(obj, tape)
        hands.append(obj)

    # La cinta entra floja, se ciñe, se mantiene durante la lectura y se afloja.
    TAPE_KEYS = [(1, 1.10), (10, 1.10), (22, 1.0), (38, 1.0), (46, 1.10), (48, 1.10)]
    for frame, value in TAPE_KEYS:
        tape.scale = (value, value, 1.0)
        tape.keyframe_insert('scale', frame=frame)
    animated.append(tape)
    # El giro va alrededor del eje del segmento (la cámara rodea el cuerpo) y la elevación se
    # inclina sobre la tangente, para mirar el anillo un poco desde arriba y que se lea como anillo.
    return front, radial, axis, -tangent, tangent, hands


def cam_axes_breadth():
    """Diámetro: antropómetro que abre, baja sobre los dos puntos óseos y cierra."""
    reach = SITE.get('reach', 0.9)
    # Si el sitio está en el brazo derecho y la pose lo abduce, el punto y el rayo escritos sobre el
    # cuerpo en reposo hay que girarlos con el brazo; si no, el rayo apunta al aire.
    deg = SITE.get('abduction', 0.0) if SITE.get('arm') else 0.0
    point_a, _ = g.surface_hit(body, body_mod.right_arm_point(SITE['point_a'], deg),
                               body_mod.right_arm_vector(SITE['ray_a'], deg), reach=reach)
    point_b, _ = g.surface_hit(body, body_mod.right_arm_point(SITE['point_b'], deg),
                               body_mod.right_arm_vector(SITE['ray_b'], deg), reach=reach)
    print('LANDMARKS A (%.3f, %.3f, %.3f)  B (%.3f, %.3f, %.3f)' % (*point_a, *point_b))

    # Un diámetro pequeño (codo, muñeca, tobillo) se mide con paquímetro, no con el antropómetro
    # grande: si se usara el mismo tamaño en todos, en los sitios chicos el instrumento taparía la
    # articulación entera y no se vería dónde se apoyan las puntas.
    small = SITE.get('small', False)
    out_dir = body_mod.right_arm_vector(SITE['out'], deg)
    if (point_b - point_a).length < 0.01:
        raise SystemExit('Los dos puntos de %s cayeron en el mismo sitio: revisa rays/reach' % SLUG)
    holder, branches, span = g.build_anthropometer(
        point_a, point_b, out_dir, steel, tip_mat,
        arm_len=0.048 if small else 0.085, bar_extra=0.055 if small else 0.100,
        thickness=0.7 if small else 1.0)
    axis = (point_b - point_a).normalized()
    out = Vector(out_dir).normalized()
    out = (out - axis * out.dot(axis)).normalized()
    side = axis.cross(out).normalized()
    middle = (point_a + point_b) / 2

    for point in (point_a, point_b):
        g.build_mark(point + out * 0.001, axis, side, out, mark_mat, dashes=False)

    # Las ramas son hijas del antropómetro: hasta que la escena no se reevalúa, su `matrix_world`
    # todavía no refleja esa jerarquía y no sirve ni para colocar la mano ni para emparentarla.
    bpy.context.view_layer.update()

    # La cámara orbita hacia +side (ver `cam_position`), así que las manos empuñan cada rama por el
    # lado opuesto: quedan detrás del instrumento y no tapan las puntas ni el punto óseo.
    hands = []
    reach_side = 0.026 if small else 0.034
    for sign, branch in zip((-1, 1), branches):
        origin = branch.matrix_world.translation - side * reach_side + out * (0.012 if small else 0.020)
        obj, thumb = g.place_grip_hand('Mano_%d' % sign, origin, -side, -axis * sign,
                                       hand_mat, scale=0.62 if small else 0.74, forearm=0.11)
        g.parent_keep_transform(obj, branch)
        hands.append(obj)

    # Las ramas se separan, el instrumento se acerca y las ramas cierran sobre los puntos óseos.
    gap = 0.022 if small else 0.055
    away = 0.045 if small else 0.085
    OPEN_KEYS = [(1, gap), (10, gap), (24, 0.0), (38, 0.0), (46, gap), (48, gap)]
    for frame, extra in OPEN_KEYS:
        for sign, branch in zip((-1, 1), branches):
            branch.location = (sign * (span / 2 + extra), 0, 0)
            branch.keyframe_insert('location', frame=frame)
    APPROACH_KEYS = [(1, away), (10, away), (22, 0.0), (38, 0.0), (46, away), (48, away)]
    base = holder.location.copy()
    for frame, back in APPROACH_KEYS:
        holder.location = base + out * back
        holder.keyframe_insert('location', frame=frame)
    animated.extend([holder, *branches])
    return middle + out * 0.02, out, axis, side, axis, hands


if SITE['kind'] == 'girth':
    origin, normal, orbit_axis, pitch_axis, screen_right, hands = cam_axes_girth()
else:
    origin, normal, orbit_axis, pitch_axis, screen_right, hands = cam_axes_breadth()

# --- luces relativas al sitio ---
key_dir = (normal * 0.9 + Vector((0, 0, 1)) * 0.5 + orbit_axis * 0.4).normalized()
g.add_light(origin + key_dir * 0.95, 14, size=0.9)
g.add_light(origin + (normal * 0.5 - orbit_axis * 0.8 + Vector((0, 0, 0.3))).normalized() * 1.0, 5, size=1.0)
g.add_light(origin - normal * 1.0 + Vector((0, 0, 0.6)), 3.5, size=1.2)

# --- cámara ---
az, el, dist = SITE['cam']
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 42
cam = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam


def aim_camera(position):
    """Apunta la cámara al sitio manteniendo `screen_right` horizontal en el encuadre.

    Con una restricción TRACK_TO el "arriba" lo decide el eje Z del mundo, y al orbitar alrededor de
    un eje horizontal la imagen sale inclinada: la barra del antropómetro aparecía en diagonal. Aquí
    el eje de la medición se fija como horizontal de la imagen, que es como se muestra en cualquier
    manual: la cinta y la barra se leen rectas y sólo cambia el punto de vista.
    """
    forward = (Vector(origin) - position).normalized()
    right = Vector(screen_right)
    right = (right - forward * right.dot(forward)).normalized()
    up = (-forward).cross(right).normalized()
    if up.z < 0:   # el eje de la medición admite dos sentidos; se toma el que deja la figura de pie
        right, up = -right, -up
    cam.matrix_world = g.frame_matrix(position, right, up, -forward)


def cam_position(frame):
    """Órbita partiendo de la normal del sitio.

    El giro se hace alrededor de `orbit_axis`, que en un perímetro es la tangente de la cinta y en
    un diámetro es el eje que une los dos puntos óseos: en ambos casos la cámara se mueve sin
    acortar en escorzo lo que hay que ver (el anillo ceñido, o la separación entre las ramas).
    """
    t = (frame - 1) / FRAMES
    swing = sin(t * 2 * 3.14159265) * 10.0
    yaw = Matrix.Rotation(radians(az + swing), 4, orbit_axis)
    pitch = Matrix.Rotation(radians(el), 4, pitch_axis)
    direction = (yaw @ pitch @ normal).normalized()
    return origin + direction * dist


for frame in range(1, FRAMES + 1):
    aim_camera(cam_position(frame))
    cam.keyframe_insert('location', frame=frame)
    cam.keyframe_insert('rotation_euler', frame=frame)


def iter_fcurves(action):
    """Blender 5 usa acciones por capas/slots; 4.x exponía action.fcurves directamente."""
    if hasattr(action, 'fcurves'):
        return list(action.fcurves)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


for obj in animated:
    if obj.animation_data and obj.animation_data.action:
        for fcurve in iter_fcurves(obj.animation_data.action):
            for kp in fcurve.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.easing = 'EASE_IN_OUT'

if STILL:
    scene.frame_set(30)
    scene.render.filepath = os.path.join(OUT, SLUG + '_still')
    bpy.ops.render.render(write_still=True)
else:
    frames_dir = os.path.join(OUT, SLUG)
    os.makedirs(frames_dir, exist_ok=True)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = os.path.join(frames_dir, 'f_')
    bpy.ops.render.render(animation=True)
print('RENDER_DONE', SLUG)
