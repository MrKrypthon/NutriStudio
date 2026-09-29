"""Renderiza la guía animada de un pliegue. Uso:
    blender -b -P render_site.py -- <slug> [--still] [--out DIR]
"""
import bpy
import os
import sys
from math import radians, cos, sin
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import body as body_mod   # noqa: E402
import guide as g         # noqa: E402
from sites import SITES_BY_SLUG  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SLUG = argv[0] if argv else 'tricipital-mm'
STILL = '--still' in argv
OUT = HERE + '/out'
if '--out' in argv:
    OUT = argv[argv.index('--out') + 1]
os.makedirs(OUT, exist_ok=True)

SITE = SITES_BY_SLUG[SLUG]
FPS = 12
FRAMES = 48  # 4 s en bucle

scene = g.clear_scene()
scene.render.resolution_x = 360
scene.render.resolution_y = 360
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES

body = body_mod.build_body(right_arm_abduction=SITE.get('abduction', 0.0))
body.data.materials.append(body_mod.skin_material())

origin, normal = g.surface_hit(body, SITE['point'], SITE['ray'])
fold_axis, across, normal = g.tangent_frame(normal, SITE['fold'])
print('SITE_HIT %s at (%.3f, %.3f, %.3f) normal (%.2f, %.2f, %.2f)' % (
    SLUG, origin.x, origin.y, origin.z, normal.x, normal.y, normal.z))

mark_mat = g.emission_material('Marca', g.MARK_COLOR, 1.4)
fold_mat = g.solid_material('PlieguePiel', (0.92, 0.70, 0.62, 1), roughness=0.62)
steel = g.solid_material('Acero', g.CALIPER_COLOR, roughness=0.32, metallic=0.85)
tip_mat = g.solid_material('Punta', g.CALIPER_TIP, roughness=0.22, metallic=0.9)

g.build_mark(origin, fold_axis, across, normal, mark_mat)
fold = g.build_fold(origin, fold_axis, across, normal, fold_mat)
import hand as hand_mod  # noqa: E402
hand_mat = hand_mod.hand_material()
hand, thumb = g.place_hand(origin, fold_axis, across, normal, hand_mat, roll=25, scale=0.78)
hand_base = hand.location.copy()
caliper, jaws = g.build_caliper(origin, fold_axis, across, normal, steel, tip_mat)

# --- luces relativas al sitio para que la región quede bien iluminada ---
key_dir = (normal * 0.9 + Vector((0, 0, 1)) * 0.5 + across * 0.4).normalized()
g.add_light(origin + key_dir * 0.85, 12, size=0.8)
g.add_light(origin + (normal * 0.5 - across * 0.8 + Vector((0, 0, 0.3))).normalized() * 0.9, 4, size=0.9)
g.add_light(origin - normal * 0.9 + Vector((0, 0, 0.6)), 3, size=1.2)

# --- cámara orbitando el sitio ---
az, el, dist = SITE['cam']
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 42
cam = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam

target = bpy.data.objects.new('Target', None)
bpy.context.collection.objects.link(target)
target.location = origin
track = cam.constraints.new('TRACK_TO')
track.target = target
track.track_axis = 'TRACK_NEGATIVE_Z'
track.up_axis = 'UP_Y'


def cam_position(frame):
    """Órbita suave alrededor del sitio, partiendo de su propia normal.

    La cámara no usa un azimut absoluto del mundo sino la normal de la piel en el sitio: se
    aparta `az` grados girando alrededor del eje del pliegue, de modo que siempre se ve la región
    de frente-oblicua y el plicómetro se aprecia de perfil (acercándose a la piel) en vez de en
    escorzo. `el` sube o baja la cámara sobre ese mismo marco.
    """
    t = (frame - 1) / FRAMES
    swing = sin(t * 2 * 3.14159265) * 12.0
    # el giro se hace alrededor del eje transversal (across) para que la cámara se desplace a lo
    # largo del pliegue: así el plano en que cierran las puntas queda de perfil y no en escorzo
    yaw = Matrix.Rotation(radians(az + swing), 4, across)
    pitch = Matrix.Rotation(radians(el), 4, fold_axis)
    direction = (yaw @ pitch @ normal).normalized()
    return origin + direction * dist


def key_all(frame):
    cam.location = cam_position(frame)
    cam.keyframe_insert('location', frame=frame)


# --- animación del pliegue y del plicómetro (bucle) ---
# 1-8   marca visible, piel lisa
# 9-18  se levanta el pliegue (dedos del evaluador)
# 19-26 el plicómetro baja y cierra sus puntas sobre el pliegue
# 27-38 lectura (se mantiene cerrado ~2 s)
# 39-48 abre, se retira y el pliegue baja  -> vuelve al inicio
FOLD_KEYS = [(1, 0.02), (8, 0.02), (18, 1.0), (38, 1.0), (46, 0.02), (48, 0.02)]
CAL_Z_KEYS = [(1, 0.105), (18, 0.105), (26, 0.020), (38, 0.020), (46, 0.105), (48, 0.105)]
JAW_KEYS = [(1, 0.056), (20, 0.056), (26, 0.024), (38, 0.024), (44, 0.056), (48, 0.056)]  # separación entre puntas (m)

# La mano entra desde fuera, cierra la pinza sobre el pliegue, la sostiene y se retira.
HAND_KEYS = [(1, 0.085), (8, 0.060), (18, 0.0), (38, 0.0), (46, 0.085), (48, 0.085)]
for frame, retreat in HAND_KEYS:
    hand.location = hand_base + normal * retreat + across * (retreat * 0.6)
    hand.keyframe_insert('location', frame=frame)
THUMB_KEYS = [(1, 26), (8, 26), (18, 0), (38, 0), (46, 26), (48, 26)]
for frame, degrees in THUMB_KEYS:
    thumb.rotation_euler = (0, radians(degrees), 0)
    thumb.keyframe_insert('rotation_euler', frame=frame)

for frame, value in FOLD_KEYS:
    fold.scale = (1.0, 1.0, value)
    fold.keyframe_insert('scale', frame=frame)

for frame, value in CAL_Z_KEYS:
    caliper.location = origin + normal * value
    caliper.keyframe_insert('location', frame=frame)

for frame, value in JAW_KEYS:
    angle = g.jaw_angle(value)
    for sign, jaw in zip((-1, 1), jaws):
        jaw.rotation_euler = (sign * angle, 0, 0)
        jaw.keyframe_insert('rotation_euler', frame=frame)

for frame in range(1, FRAMES + 1):
    key_all(frame)

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


for obj in (fold, caliper, *jaws, hand, thumb):
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
