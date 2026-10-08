import * as THREE from 'three/webgpu';
import {attribute, float, select, smoothstep, uniform, uv, vec2, vec3} from 'three/tsl';

export const MAX_SPRAY_PARTICLES = 160;
const GRAVITY = 9.81;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * One instanced, camera-facing draw. Spawn data changes only on emit/reset;
 * ballistic position, finite lifetime and fade are evaluated on the GPU.
 * update(time) must use the same simulation clock as the landing event.
 */
export function createSpray(scene, {capacity = MAX_SPRAY_PARTICLES} = {}) {
  capacity = Number.isFinite(capacity) ? clamp(Math.floor(capacity), 1, MAX_SPRAY_PARTICLES) : MAX_SPRAY_PARTICLES;
  const starts = new Float32Array(capacity * 4);
  const motions = new Float32Array(capacity * 4);
  const sizes = new Float32Array(capacity);
  const expires = new Float64Array(capacity);
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(plane);
  plane.dispose();
  geometry.instanceCount = capacity;
  const startAttribute = new THREE.InstancedBufferAttribute(starts, 4).setUsage(THREE.DynamicDrawUsage);
  const motionAttribute = new THREE.InstancedBufferAttribute(motions, 4).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.InstancedBufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('sprayStart', startAttribute);
  geometry.setAttribute('sprayMotion', motionAttribute);
  geometry.setAttribute('spraySize', sizeAttribute);

  const now = uniform(0);
  const start = attribute('sprayStart', 'vec4');
  const motion = attribute('sprayMotion', 'vec4');
  const size = attribute('spraySize', 'float');
  const age = now.sub(start.w);
  const alive = age.greaterThanEqual(0).and(age.lessThan(motion.w));
  const t = age.clamp(0, motion.w.max(0));
  const progress = t.div(motion.w.max(.001));
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: true,
    alphaTest: .008,
  });
  material.positionNode = start.xyz.add(motion.xyz.mul(t)).add(vec3(0, t.mul(t).mul(-GRAVITY * .5), 0));
  material.scaleNode = vec2(size).mul(select(alive, float(1), float(0)));
  material.colorNode = vec3(.82, .93, 1);
  const disk = float(1).sub(smoothstep(.22, .5, uv().sub(.5).length()));
  material.opacityNode = disk.mul(float(1).sub(smoothstep(.45, 1, progress)))
    .mul(select(alive, float(.86), float(0)));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Landing spray';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  scene.add(mesh);

  let cursor = 0, latestExpiry = 0, emitted = 0, bursts = 0, overwritten = 0, disposed = false;
  let lastEvent = null;
  let randomState = 1;
  function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }
  function upload() {
    startAttribute.needsUpdate = true;
    motionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
  }
  function emit(event) {
    if (disposed || !event || event === lastEvent) return 0;
    const position = event.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
        || !Number.isFinite(position.z) || !(event.impact > 0)) return 0;
    if (lastEvent && event.id !== undefined && event.id === lastEvent.id && event.time === lastEvent.time) return 0;
    lastEvent = event;
    const impact = clamp(event.impact, 0, 1);
    const radius = clamp(Number.isFinite(event.radius) ? event.radius : .32, .05, 2);
    const birth = Number.isFinite(event.time) ? event.time : now.value;
    const count = Math.min(capacity, Math.ceil(12 + impact * 48));
    randomState = ((Math.floor(birth * 10000) ^ Math.imul(bursts + 1, 2654435761)) >>> 0) || 1;
    for (let i = 0; i < count; i++) {
      const slot = cursor, offset = slot * 4;
      cursor = (cursor + 1) % capacity;
      if (expires[slot] > Math.max(now.value, birth)) overwritten++;
      const angle = (i + random() * .8) * (Math.PI * 2 / count);
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const launchRadius = radius * (.45 + random() * .55);
      const horizontalSpeed = (.4 + impact * 1.7) * (.5 + random() * .7);
      const verticalSpeed = (.7 + impact * 2.5) * (.65 + random() * .6);
      // End just before the ballistic trajectory returns to its launch height.
      const lifetime = Math.min(1.1, verticalSpeed * 2 / GRAVITY * (.85 + random() * .13));
      starts[offset] = position.x + dx * launchRadius;
      starts[offset + 1] = position.y + .025;
      starts[offset + 2] = position.z + dz * launchRadius;
      starts[offset + 3] = birth;
      motions[offset] = dx * horizontalSpeed;
      motions[offset + 1] = verticalSpeed;
      motions[offset + 2] = dz * horizontalSpeed;
      motions[offset + 3] = lifetime;
      sizes[slot] = (.025 + impact * .032) * (.65 + random() * .65);
      expires[slot] = birth + lifetime;
      latestExpiry = Math.max(latestExpiry, expires[slot]);
    }
    emitted += count;
    bursts++;
    upload();
    mesh.visible = latestExpiry > now.value;
    return count;
  }
  function reset(time = 0) {
    if (disposed) return;
    starts.fill(0);
    motions.fill(0);
    sizes.fill(0);
    expires.fill(0);
    now.value = Number.isFinite(time) ? time : 0;
    cursor = emitted = bursts = overwritten = 0;
    latestExpiry = 0;
    lastEvent = null;
    mesh.visible = false;
    upload();
  }
  function update(time) {
    if (disposed || !Number.isFinite(time)) return;
    if (time < now.value) reset(time);
    now.value = time;
    mesh.visible = emitted > 0 && latestExpiry > time;
  }
  function stats() {
    let active = 0;
    for (let i = 0; i < capacity; i++) {
      if (motions[i * 4 + 3] > 0 && starts[i * 4 + 3] <= now.value && expires[i] > now.value) active++;
    }
    return {capacity, active, emitted, bursts, overwritten, visible: mesh.visible, disposed};
  }
  function dispose() {
    if (disposed) return;
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    mesh.visible = false;
    disposed = true;
  }
  return {emit, update, reset, stats, dispose};
}
