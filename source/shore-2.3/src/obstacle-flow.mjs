// Static CPU bake: depth-weighted harmonic coordinates on the mean-water domain.
// There is no per-frame solve and no velocity limiter hidden in this module.
const WET_LEVEL = -.006;

/**
 * Solve div(H grad Phi)=0 with identity coordinates on wet outer cell centres.
 * Bed is interleaved RGBA; its red channel is the actual bed, including rocks.
 * Cell centres are origin+(index+.5)*dx, with origin=-n*dx/2 on both axes.
 *
 * coordinates: [PhiX,PhiZ]; jacobian: [dX(PhiX),dZ(PhiX),dX(PhiZ),dZ(PhiZ)].
 * faceFluxes: [H*dX(PhiX) east,H*dZ(PhiX) north,
 *              H*dX(PhiZ) east,H*dZ(PhiZ) north].
 * faceDepths: [H east,H north], harmonic-mean depths on connected fluid faces.
 * External east/north slots are zero sentinels, not physical closed boundaries.
 * Closed ponds have a constant centroid gauge and exactly zero flow.
 * Dry coordinate extension is for rendering only: its mask and Jacobian stay zero.
 */
export function bakeObstacleFlow({ n, dx, bedArray, maxIterations = Math.min(2400, 8 * n), tolerance = 1e-6 } = {}) {
  const started = performance.now();
  if (!Number.isInteger(n) || n < 3 || !Number.isFinite(dx) || dx <= 0)
    throw new RangeError('bakeObstacleFlow requires integer n >= 3 and positive finite dx');
  if (!bedArray || bedArray.length !== n * n * 4)
    throw new RangeError('bedArray must contain n*n interleaved RGBA bed cells');
  if (!Number.isInteger(maxIterations) || maxIterations < 0 || !Number.isFinite(tolerance) || tolerance <= 0)
    throw new RangeError('maxIterations must be a nonnegative integer and tolerance positive');

  const count = n * n, origin = -.5 * n * dx;
  const wetMask = new Uint8Array(count), fluidMask = new Uint8Array(count), pondMask = new Uint8Array(count);
  const boundaryMask = new Uint8Array(count), depth = new Float64Array(count), queue = new Int32Array(count);
  const phiX = new Float64Array(count), phiZ = new Float64Array(count);
  let wetCells = 0, boundaryCells = 0, head = 0, tail = 0;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = z * n + x, bed = bedArray[4 * i];
    if (!Number.isFinite(bed)) throw new RangeError(`Non-finite bed height at cell ${i}`);
    phiX[i] = origin + (x + .5) * dx;
    phiZ[i] = origin + (z + .5) * dx;
    if (bed < WET_LEVEL) {
      depth[i] = -bed; wetMask[i] = 1; wetCells++;
      if (x === 0 || z === 0 || x === n - 1 || z === n - 1) {
        fluidMask[i] = 1; boundaryMask[i] = 1; boundaryCells++; queue[tail++] = i;
      }
    }
  }
  function floodPush(j, mask) {
    if (wetMask[j] && !mask[j]) { mask[j] = 1; queue[tail++] = j; }
  }
  while (head < tail) {
    const i = queue[head++], x = i % n;
    if (x) floodPush(i - 1, fluidMask);
    if (x + 1 < n) floodPush(i + 1, fluidMask);
    if (i >= n) floodPush(i - n, fluidMask);
    if (i < count - n) floodPush(i + n, fluidMask);
  }
  const fluidCells = tail;
  let pondCells = 0, pondComponents = 0;
  for (let seed = 0; seed < count; seed++) if (wetMask[seed] && !fluidMask[seed] && !pondMask[seed]) {
    head = 0; tail = 1; queue[0] = seed; pondMask[seed] = 1;
    let sumX = 0, sumZ = 0;
    while (head < tail) {
      const i = queue[head++], x = i % n;
      sumX += phiX[i]; sumZ += phiZ[i];
      if (x && !fluidMask[i - 1]) floodPush(i - 1, pondMask);
      if (x + 1 < n && !fluidMask[i + 1]) floodPush(i + 1, pondMask);
      if (i >= n && !fluidMask[i - n]) floodPush(i - n, pondMask);
      if (i < count - n && !fluidMask[i + n]) floodPush(i + n, pondMask);
    }
    const cx = sumX / tail, cz = sumZ / tail;
    for (let j = 0; j < tail; j++) { phiX[queue[j]] = cx; phiZ[queue[j]] = cz; }
    pondCells += tail; pondComponents++;
  }

  // An edge exists only after domain membership is established. In particular,
  // no epsilon depth can turn a dry rock/shore face into a conducting edge.
  const east = new Float64Array(count), north = new Float64Array(count), diag = new Float64Array(count);
  const harmonic = (a, b) => 2 * Math.min(a, b) / (1 + Math.min(a, b) / Math.max(a, b));
  for (let i = 0; i < count; i++) if (fluidMask[i]) {
    if (i % n < n - 1 && fluidMask[i + 1]) {
      east[i] = harmonic(depth[i], depth[i + 1]); diag[i] += east[i]; diag[i + 1] += east[i];
    }
    if (i < count - n && fluidMask[i + n]) {
      north[i] = harmonic(depth[i], depth[i + n]); diag[i] += north[i]; diag[i + n] += north[i];
    }
  }
  const unknowns = new Int32Array(Math.max(0, fluidCells - boundaryCells));
  for (let i = 0, j = 0; i < count; i++) if (fluidMask[i] && !boundaryMask[i]) unknowns[j++] = i;

  // Jacobi-preconditioned conjugate gradients on the SPD Dirichlet submatrix.
  // Solve corrections to the affine coordinates, avoiding a large boundary RHS.
  // All solves and residuals use the same face conductances (dx^-2 cancels in
  // relative residuals). Explicit operator residuals verify convergence.
  function solve(phi) {
    const residual = new Float64Array(count), direction = new Float64Array(count), applied = new Float64Array(count);
    const correction = new Float64Array(count), seed = phi.slice();
    function exactResidual() {
      let norm2 = 0, maximum = 0;
      for (let k = 0; k < unknowns.length; k++) {
        const i = unknowns[k], c = phi[i];
        const r = east[i] * (phi[i + 1] - c) + east[i - 1] * (phi[i - 1] - c)
          + north[i] * (phi[i + n] - c) + north[i - n] * (phi[i - n] - c);
        residual[i] = r; norm2 += r * r; maximum = Math.max(maximum, Math.abs(r));
      }
      return { norm: Math.sqrt(norm2), maximum };
    }
    let exact = exactResidual();
    const initialNorm = exact.norm;
    // The affine seed is an exact solution on uniform unobstructed domains.
    // The floor only removes cancellation at machine precision, never a real
    // obstacle or depth-gradient defect.
    let scale2 = 0;
    for (let k = 0; k < unknowns.length; k++) scale2 += (diag[unknowns[k]] * dx) ** 2;
    const roundoffFloor = Math.sqrt(scale2) * 64 * Number.EPSILON;
    const normalizer = Math.max(initialNorm, roundoffFloor, Number.MIN_VALUE);
    const target = Math.max(tolerance * initialNorm, roundoffFloor);
    let iterations = 0, rho = 0, breakdown = null;
    for (let k = 0; k < unknowns.length; k++) {
      const i = unknowns[k]; direction[i] = residual[i] / diag[i]; rho += residual[i] * direction[i];
    }
    while (exact.norm > target && iterations < maxIterations) {
      let pAp = 0;
      for (let k = 0; k < unknowns.length; k++) {
        const i = unknowns[k];
        const ap = diag[i] * direction[i] - east[i] * direction[i + 1] - east[i - 1] * direction[i - 1]
          - north[i] * direction[i + n] - north[i - n] * direction[i - n];
        applied[i] = ap; pAp += direction[i] * ap;
      }
      if (!(pAp > 0) || !Number.isFinite(pAp) || !Number.isFinite(rho)) { breakdown = 'non-positive or non-finite PCG curvature'; break; }
      const alpha = rho / pAp;
      let nextRho = 0, recursiveNorm2 = 0;
      for (let k = 0; k < unknowns.length; k++) {
        const i = unknowns[k]; correction[i] += alpha * direction[i]; phi[i] = seed[i] + correction[i];
        residual[i] -= alpha * applied[i]; recursiveNorm2 += residual[i] ** 2;
        nextRho += residual[i] ** 2 / diag[i];
      }
      iterations++;
      // The recursive residual is cheap but never sufficient for convergence.
      if (Math.sqrt(recursiveNorm2) <= target || iterations === maxIterations || iterations % 64 === 0) {
        exact = exactResidual(); nextRho = 0;
        for (let k = 0; k < unknowns.length; k++) { const i = unknowns[k]; nextRho += residual[i] ** 2 / diag[i]; }
        if (exact.norm <= target) break;
      }
      const beta = nextRho / rho;
      for (let k = 0; k < unknowns.length; k++) {
        const i = unknowns[k]; direction[i] = residual[i] / diag[i] + beta * direction[i];
      }
      rho = nextRho;
    }
    exact = exactResidual();
    return {
      iterations, converged: exact.norm <= target && !breakdown, relativeResidual: exact.norm / normalizer,
      initialResidualL2: initialNorm / (dx * dx), residualL2: exact.norm / (dx * dx),
      residualMax: exact.maximum / (dx * dx), roundoffLimited: initialNorm <= roundoffFloor,
      breakdown, _normalizer: normalizer,
    };
  }
  const xSolve = solve(phiX), zSolve = solve(phiZ);
  const faceFluxes = new Float32Array(count * 4), faceDepths = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    faceDepths[2 * i] = east[i]; faceDepths[2 * i + 1] = north[i];
    if (east[i] > 0) {
      faceFluxes[4 * i] = east[i] * (phiX[i + 1] - phiX[i]) / dx;
      faceFluxes[4 * i + 2] = east[i] * (phiZ[i + 1] - phiZ[i]) / dx;
    }
    if (north[i] > 0) {
      faceFluxes[4 * i + 1] = north[i] * (phiX[i + n] - phiX[i]) / dx;
      faceFluxes[4 * i + 3] = north[i] * (phiZ[i + n] - phiZ[i]) / dx;
    }
  }
  function exportedFluxResidual(axis, normalizer) {
    let norm2 = 0, maximum = 0;
    for (let k = 0; k < unknowns.length; k++) {
      const i = unknowns[k], o = 4 * i + axis * 2;
      const divTimesDx = faceFluxes[o] - faceFluxes[o - 4] + faceFluxes[o + 1] - faceFluxes[o - 4 * n + 1];
      norm2 += divTimesDx ** 2; maximum = Math.max(maximum, Math.abs(divTimesDx) / dx);
    }
    return { relativeResidual: Math.sqrt(norm2) * dx / normalizer, residualMax: maximum };
  }
  const exportedXResidual = exportedFluxResidual(0, xSolve._normalizer), exportedZResidual = exportedFluxResidual(1, zSolve._normalizer);
  delete xSolve._normalizer; delete zSolve._normalizer;

  // Multi-source extension followed by bounded harmonic smoothing. Wet values
  // (including each pond's gauge) stay fixed. These dry values are phase data,
  // never a claim that dry terrain contains water or carries a velocity.
  let extensionSweeps = 0;
  if (wetCells && wetCells < count) {
    const distance = new Int32Array(count); distance.fill(-1); head = 0; tail = 0;
    for (let i = 0; i < count; i++) if (wetMask[i]) { distance[i] = 0; queue[tail++] = i; }
    function extend(i, j) {
      if (distance[j] < 0) { distance[j] = distance[i] + 1; queue[tail++] = j; }
    }
    while (head < tail) {
      const i = queue[head++], x = i % n;
      if (distance[i] > 0) {
        // Average all equally near predecessors, so queue ordering cannot
        // introduce a preferred direction or a seam through a symmetric rock.
        let sx = 0, sz = 0, neighbors = 0;
        const level = distance[i] - 1;
        if (x && distance[i - 1] === level) { sx += phiX[i - 1]; sz += phiZ[i - 1]; neighbors++; }
        if (x + 1 < n && distance[i + 1] === level) { sx += phiX[i + 1]; sz += phiZ[i + 1]; neighbors++; }
        if (i >= n && distance[i - n] === level) { sx += phiX[i - n]; sz += phiZ[i - n]; neighbors++; }
        if (i < count - n && distance[i + n] === level) { sx += phiX[i + n]; sz += phiZ[i + n]; neighbors++; }
        phiX[i] = sx / neighbors; phiZ[i] = sz / neighbors;
      }
      if (x) extend(i, i - 1);
      if (x + 1 < n) extend(i, i + 1);
      if (i >= n) extend(i, i - n);
      if (i < count - n) extend(i, i + n);
    }
    const dry = new Int32Array(count - wetCells);
    for (let i = 0, k = 0; i < count; i++) if (!wetMask[i]) dry[k++] = i;
    const nextX = new Float64Array(dry.length), nextZ = new Float64Array(dry.length);
    for (let sweep = 0; sweep < 48; sweep++) {
      // Jacobi smoothing preserves reflection symmetry and creates no extrema.
      for (let k = 0; k < dry.length; k++) {
        const i = dry[k], x = i % n, z = Math.floor(i / n);
        let sx = 0, sz = 0, neighbors = 0;
        if (x) { sx += phiX[i - 1]; sz += phiZ[i - 1]; neighbors++; }
        if (x + 1 < n) { sx += phiX[i + 1]; sz += phiZ[i + 1]; neighbors++; }
        if (z) { sx += phiX[i - n]; sz += phiZ[i - n]; neighbors++; }
        if (z + 1 < n) { sx += phiX[i + n]; sz += phiZ[i + n]; neighbors++; }
        nextX[k] = sx / neighbors; nextZ[k] = sz / neighbors;
      }
      for (let k = 0; k < dry.length; k++) { phiX[dry[k]] = nextX[k]; phiZ[dry[k]] = nextZ[k]; }
      extensionSweeps++;
    }
  }
  const coordinates = new Float32Array(count * 2), jacobian = new Float32Array(count * 4);
  const result = { n, count, dx, origin, coordinates, jacobian, faceFluxes, faceDepths, fluidMask, wetMask, pondMask, boundaryMask };
  let maxBasisSpeed = 0, maxJacobianNorm = 0, nonFiniteValues = 0;
  for (let i = 0; i < count; i++) {
    coordinates[2 * i] = phiX[i]; coordinates[2 * i + 1] = phiZ[i];
    if (fluidMask[i]) {
      const basis = sampleObstacleBasis(result, origin + (i % n + .5) * dx, origin + (Math.floor(i / n) + .5) * dx);
      jacobian.set(basis, 4 * i);
      maxBasisSpeed = Math.max(maxBasisSpeed, Math.hypot(basis[0], basis[1]), Math.hypot(basis[2], basis[3]));
      maxJacobianNorm = Math.max(maxJacobianNorm, Math.hypot(...basis));
    }
  }
  for (const array of [coordinates, jacobian, faceFluxes, faceDepths]) for (const value of array) if (!Number.isFinite(value)) nonFiniteValues++;
  result.diagnostics = {
    backend: 'CPU', solver: 'Jacobi-preconditioned conjugate gradients', tolerance, maxIterations,
    converged: xSolve.converged && zSolve.converged && nonFiniteValues === 0,
    x: xSolve, z: zSolve, exportedFluxResidual: { x: exportedXResidual, z: exportedZResidual },
    wetCells, fluidCells, boundaryCells, unknownCells: unknowns.length, pondCells, pondComponents,
    dryExtensionSweeps: extensionSweeps, maxBasisSpeed, maxJacobianNorm, nonFiniteValues,
    isolatedPondPolicy: 'zero flow; each component has constant centroid coordinates',
    boundaryCondition: 'identity Dirichlet on open-water outer cell centres; zero flux at blocked faces',
    coordinateQuantization: 'Float32 output; operator convergence uses Float64 solve, exported flux residual is also reported',
    elapsedMs: performance.now() - started,
  };
  return result;
}

/**
 * Face-normal reconstruction of the two coordinate-gradient velocity bases.
 * Within a cell, x components interpolate west/east faces and z components
 * south/north faces. No transverse interpolation can leak flow through a wall.
 * At an open outer face, extrapolate the adjacent interior face derivative.
 * Dry cells, closed ponds, non-finite queries, and out-of-domain queries return 0.
 * Returns [dX(PhiX),dZ(PhiX),dX(PhiZ),dZ(PhiZ)] in out (optional length >= 4).
 */
export function sampleObstacleBasis(bake, x, z, out = new Float32Array(4)) {
  if (out.length < 4) throw new RangeError('sampleObstacleBasis output needs four entries');
  out[0] = out[1] = out[2] = out[3] = 0;
  const { n, dx, origin, fluidMask, faceFluxes: flux, faceDepths: depth } = bake;
  const gx = (x - origin) / dx, gz = (z - origin) / dx;
  if (!Number.isFinite(gx) || !Number.isFinite(gz) || gx < 0 || gz < 0 || gx > n || gz > n) return out;
  const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz)), i = iz * n + ix;
  if (!fluidMask[i]) return out;
  const tx = gx - ix, tz = gz - iz;
  const eastCell = ix < n - 1 ? i : i - 1, westCell = ix > 0 ? i - 1 : i;
  const northCell = iz < n - 1 ? i : i - n, southCell = iz > 0 ? i - n : i;
  const he = depth[2 * eastCell], hw = depth[2 * westCell], hn = depth[2 * northCell + 1], hs = depth[2 * southCell + 1];
  for (let axis = 0; axis < 2; axis++) {
    const offset = 2 * axis;
    const e = he > 0 ? flux[4 * eastCell + offset] / he : 0, w = hw > 0 ? flux[4 * westCell + offset] / hw : 0;
    const up = hn > 0 ? flux[4 * northCell + offset + 1] / hn : 0, down = hs > 0 ? flux[4 * southCell + offset + 1] / hs : 0;
    out[offset] = (1 - tx) * w + tx * e;
    out[offset + 1] = (1 - tz) * down + tz * up;
  }
  return out;
}
