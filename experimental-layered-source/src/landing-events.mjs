const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * Detect one water entry per airborne excursion. `surface` is the composed
 * rendered water height, and `surfaceVelocity` is its vertical dEta/dt.
 * Supply velocity before a collision solver clamps it. Optional `time` uses
 * the simulation clock; without it, the detector accumulates dt from reset.
 * Start/teleport below water silently. Pass wet:false while over dry ground.
 */
export function createLandingEvents({
  minRelativeSpeed = .35,
  rearmHeight = .075,
  rearmRadiusScale = .32,
  fullImpactSpeed = 5,
} = {}) {
  if (![minRelativeSpeed, rearmHeight, rearmRadiusScale, fullImpactSpeed].every(Number.isFinite)
      || minRelativeSpeed < 0 || rearmHeight <= 0 || rearmRadiusScale < 0
      || fullImpactSpeed <= minRelativeSpeed) throw new RangeError('Invalid water-entry thresholds');

  let clock = 0, initialized = false, armed = false, events = 0;
  let previousX = 0, previousZ = 0, previousSurface = 0, previousClearance = 0, previousTime = 0;

  function reset(time = 0) {
    clock = Number.isFinite(time) ? time : 0;
    initialized = false;
    armed = false;
    events = 0;
  }

  function update(sample, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return null;
    const {x, z, bottom, surface} = sample;
    const nextTime = Number.isFinite(sample.time) ? sample.time : clock + dt;
    // Resetting the simulation clock must not turn the old location into a
    // crossing at the newly teleported location.
    if (nextTime < clock) reset(nextTime);
    clock = nextTime;
    if (sample.wet === false || !Number.isFinite(x) || !Number.isFinite(z)
        || !Number.isFinite(bottom) || !Number.isFinite(surface)) {
      initialized = false;
      armed = false;
      return null;
    }

    const radius = clamp(Number.isFinite(sample.radius) ? sample.radius : .32, .05, 2);
    const clearance = bottom - surface;
    const releaseHeight = Math.max(rearmHeight, radius * rearmRadiusScale);
    let event = null;
    if (initialized) {
      const crossed = previousClearance > 0 && clearance <= 0;
      if (crossed) {
        const wasArmed = armed;
        // A gentle entry also consumes this excursion. Bobbing about zero
        // cannot defer that entry and turn it into a later, stronger impact.
        armed = false;
        const interval = Math.max(nextTime - previousTime, dt * .001);
        const measuredSpeed = (previousClearance - clearance) / interval;
        const relativeSpeed = Number.isFinite(sample.verticalVelocity) && Number.isFinite(sample.surfaceVelocity)
          ? sample.surfaceVelocity - sample.verticalVelocity : measuredSpeed;
        if (wasArmed && relativeSpeed >= minRelativeSpeed) {
          const fraction = clamp(previousClearance / (previousClearance - clearance), 0, 1);
          const impact = clamp(relativeSpeed / fullImpactSpeed, 0, 1);
          event = {
            id: ++events,
            time: previousTime + (nextTime - previousTime) * fraction,
            position: {
              x: previousX + (x - previousX) * fraction,
              y: previousSurface + (surface - previousSurface) * fraction,
              z: previousZ + (z - previousZ) * fraction,
            },
            radius,
            relativeSpeed,
            impact,
          };
        }
      }
    }
    // This spatial hysteresis requires actually leaving the composed surface.
    // It deliberately does not use a timer that could fire again while idle.
    if (clearance >= releaseHeight) armed = true;
    previousX = x;
    previousZ = z;
    previousSurface = surface;
    previousClearance = clearance;
    previousTime = nextTime;
    initialized = true;
    return event;
  }

  return {update, reset, stats: () => ({armed, initialized, events, time: clock})};
}
