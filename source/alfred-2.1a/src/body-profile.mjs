const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Bounds measured from the approved, unmodified Alfred_Runtime.glb. Its front
// is +Z and its feet are at Y=0. One uniform scale preserves every proportion.
export const ALFRED_SOURCE_BOUNDS = Object.freeze({
  min: Object.freeze([-1.1278314590454102, -5.109751555210096e-8, -.6701353788375854]),
  max: Object.freeze([1.127914309501648, 2.025343656539917, .7522823290843093]),
});
const sourceSize = ALFRED_SOURCE_BOUNDS.max.map((value, axis) => value - ALFRED_SOURCE_BOUNDS.min[axis]);
const height = 1.10, scale = height / sourceSize[1];
const width = sourceSize[0] * scale, depth = sourceSize[2] * scale;
const radiusX = width / 2, radiusZ = depth / 2;
const volume = 4 / 3 * Math.PI * radiusX * radiusZ * height / 2;
const densityRatio = .5;

export const ALFRED_BODY_PROFILE = Object.freeze({
  height, halfHeight: height / 2, width, depth, scale, radiusX, radiusZ,
  // Area-equivalent circular coupling for the existing radial fluid solver.
  fluidRadius: Math.sqrt(radiusX * radiusZ),
  landingRadius: Math.sqrt(radiusX * radiusZ),
  volume, densityRatio,
  // Archimedes acceleration: g * displaced volume / (body volume * density ratio).
  // This fitted density leaves the eyes above the calm equilibrium swim line.
  buoyancyAcceleration: 9.81 * volume / (volume * densityRatio),
  // Bead-eye center and upper edge from the source model, in feet coordinates.
  eyeHeight: (1.28 - .04038524627685547 - ALFRED_SOURCE_BOUNDS.min[1]) * scale,
  eyeTopHeight: (1.28 - .04038524627685547 + .078 * .92 - ALFRED_SOURCE_BOUNDS.min[1]) * scale,
});

/** Volume fraction below a plane for an upright ellipsoid. */
export function ellipsoidImmersion(immersedHeight, profile = ALFRED_BODY_PROFILE) {
  const q = clamp(immersedHeight / profile.height, 0, 1);
  return q * q * (3 - 2 * q);
}

/** Radius of the widest wetted section, expressed as an equal-area circle. */
export function submergedFluidRadius(immersedHeight, profile = ALFRED_BODY_PROFILE) {
  const q = clamp(immersedHeight / profile.height, 0, .5);
  return profile.fluidRadius * Math.sqrt(4 * q * (1 - q));
}

// A bounded set samples both the curved underside and the outer footprint.
// Each ordinate is the actual ellipsoid lower-surface offset below its center.
export const ALFRED_SUPPORT_SAMPLES = Object.freeze([
  Object.freeze([0, 0, ALFRED_BODY_PROFILE.halfHeight]),
  ...[[.45, 8], [.75, 16], [.95, 16], [1, 16]].flatMap(([r, count]) =>
    Array.from({length: count}, (_, index) => {
      const angle = index * Math.PI * 2 / count;
      return Object.freeze([
        Math.cos(angle) * ALFRED_BODY_PROFILE.radiusX * r,
        Math.sin(angle) * ALFRED_BODY_PROFILE.radiusZ * r,
        ALFRED_BODY_PROFILE.halfHeight * Math.sqrt(1 - r * r),
      ]);
    })),
]);

export function bodyFloorAt(sampleFloor, x, z, heading = 0) {
  const c = Math.cos(heading), s = Math.sin(heading);
  let floor = -Infinity;
  for (const [dx, dz, supportHeight] of ALFRED_SUPPORT_SAMPLES) {
    floor = Math.max(floor, sampleFloor(x + c * dx + s * dz, z - s * dx + c * dz) + supportHeight);
  }
  return floor;
}

/** World-axis extents of the rotated ellipse, for domain-edge contact. */
export function bodyFootprintExtents(heading = 0, profile = ALFRED_BODY_PROFILE) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return {
    x: Math.hypot(profile.radiusX * c, profile.radiusZ * s),
    z: Math.hypot(profile.radiusX * s, profile.radiusZ * c),
  };
}
