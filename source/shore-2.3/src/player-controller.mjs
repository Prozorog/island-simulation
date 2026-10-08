import {createLandingEvents} from './landing-events.mjs';
import {ALFRED_BODY_PROFILE, bodyFloorAt, bodyFootprintExtents, ellipsoidImmersion, submergedFluidRadius} from './body-profile.mjs';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function entryPulse(remaining, dt) {
  const next = remaining * Math.exp(-dt / .20);
  return {remaining: next, rate: (remaining - next) / dt};
}
export {ellipsoidImmersion};

export function createPlayerController(shore) {
  const profile = ALFRED_BODY_PROFILE, landingEvents = createLandingEvents();
  let sampleTime = 0, vy = 0, water = {eta: 0, h: 0, u: 0, v: 0, etaDt: 0};
  let pending = null, sampleClock = 0, generation = 0, lastImmersion = 0, grounded = true;
  let heading = shore.player.rotation?.y || 0;
  const floorSample = (x, z) => shore.tracks.floorAt(x, z);

  function floorAt(x, z) {
    return bodyFloorAt(floorSample, x, z, heading);
  }

  function requestWater() {
    if (pending) return pending;
    const stamp = generation, requestedAt = shore.sim.time.value;
    const request = Promise.resolve(shore.sim.sample(shore.player.position.x, shore.player.position.z)).then(value => {
      if (stamp === generation) {
        water = {eta: value[0], h: value[1], u: value[2], v: value[3], etaDt: value[4] || 0};
        sampleTime = requestedAt;
      }
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  }

  function reset() {
    landingEvents.reset(shore.sim.time.value);
    shore.spray?.reset(shore.sim.time.value);
    generation++;
    pending = null;
    vy = 0;
    water = {eta: 0, h: 0, u: 0, v: 0, etaDt: 0};
    sampleTime = shore.sim.time.value;
    sampleClock = 0;
    lastImmersion = 0;
    // Face the follow camera after a reset; movement subsequently sets heading.
    heading = shore.orbit.yaw || 0;
    if (shore.player.rotation) shore.player.rotation.y = heading;
    grounded = shore.player.position.y <= floorAt(shore.player.position.x, shore.player.position.z) + .015;
    shore.sim.body.value.set(1000, 1000, 0, profile.fluidRadius);
    shore.sim.bodyMotion.value.set(0, 0, 0, 0);
  }

  function step(dt, {forward = 0, right = 0, jump = false, yaw = shore.orbit.yaw, run = false} = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const p = shore.player.position, px = p.x, pz = p.z;
    const len = Math.max(1, Math.hypot(forward, right));
    const surface = water.eta + water.etaDt * clamp(shore.sim.time.value - sampleTime, 0, .06);
    const immersion = water.h > .003 ? ellipsoidImmersion(surface - (p.y - profile.halfHeight)) : 0;
    const speed = (run ? 4.2 : 3) * (1 - immersion * .42);
    const vx = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) / len * speed;
    const vz = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) / len * speed;
    if (Math.hypot(vx, vz) > .001) {
      heading = Math.atan2(vx, vz);
      if (shore.player.rotation) shore.player.rotation.y = heading;
    }
    const extents = bodyFootprintExtents(heading);
    p.x = clamp(p.x + (vx + water.u * immersion * .10) * dt, -16 + extents.x, 16 - extents.x);
    p.z = clamp(p.z + (vz + water.v * immersion * .10) * dt, -16 + extents.z, 16 - extents.z);

    let floor = floorAt(p.x, p.z);
    const stickToGround = grounded && !jump && vy <= 0 && p.y - floor < .18 && immersion < .68;
    grounded = p.y <= floor + .015;
    if (jump && (grounded || immersion > .15)) {
      vy = 4.2 * (1 - immersion * .3);
      grounded = false;
    }
    // Gravity, jump and damping stay unchanged. Buoyancy uses Alfred's fitted
    // density and ellipsoid volume instead of the old capsule's constant.
    vy += (-9.81 + profile.buoyancyAcceleration * immersion - vy * immersion * 2.6) * dt;
    p.y += vy * dt;
    const fallingVelocity = vy;
    if (stickToGround || p.y <= floor) {
      p.y = floor;
      vy = Math.max(0, vy);
      grounded = true;
    } else grounded = false;
    if (grounded) {
      shore.tracks.stampSegment(px, pz, p.x, p.z, {grounded: true, ...(water.h > .003 ? {waterEta: water.eta} : {})});
      floor = floorAt(p.x, p.z);
      p.y = floor;
    }

    const bottom = p.y - profile.halfHeight;
    const immersedHeight = water.h > .003 ? Math.max(0, surface - bottom) : 0;
    const columnOverlap = clamp(immersedHeight / Math.max(water.h, .025), 0, 1);
    const event = landingEvents.update({
      x: p.x, z: p.z, bottom, surface, surfaceVelocity: water.etaDt,
      verticalVelocity: fallingVelocity, radius: profile.landingRadius,
      wet: water.h > .004, time: shore.sim.time.value + dt,
    }, dt);
    if (event) shore.onLanding?.(event);
    lastImmersion = immersedHeight;
    const bodyVX = (p.x - px) / dt, bodyVZ = (p.z - pz) / dt;
    const radius = Math.max(.10, submergedFluidRadius(immersedHeight));
    shore.sim.body.value.set(p.x, p.z, 0, radius);
    shore.sim.bodyMotion.value.set(bodyVX, bodyVZ, columnOverlap, 0);
    shore.step(dt);
    sampleClock -= dt;
    if (sampleClock <= 0 && !pending) {
      sampleClock = .025;
      requestWater().catch(console.error);
    }
  }

  return {
    step, reset, floorAt, requestWater,
    get pending() { return pending; },
    get diagnostics() {
      const bottom = shore.player.position.y - profile.halfHeight;
      return {
        vy, water: {...water}, grounded, entry: 0, lastImmersion, heading,
        profile, eyeClearance: bottom + profile.eyeHeight - water.eta,
        eyeTopClearance: bottom + profile.eyeTopHeight - water.eta,
        bodyMotion: shore.sim.bodyMotion.value.toArray(),
        landing: landingEvents.stats(), spray: shore.spray?.stats(),
      };
    },
  };
}
