// CPU-owned, cell-centred sand displacement. RGBA = signed height (metres),
// compression, positive bank height (metres), reserved. The original bed is
// copied once; composing solver or mesh heights must never modify this copy.
export const SAND_RESOLUTION = 1024;
const RADIUS = .225, DEPTH = .082, BANK_RADIUS = .34, LIMIT = .54;
const MAX_BANK_HEIGHT = Math.fround(.12), MIN_TRAVEL = .0015, MAX_TRAVEL = .6;
export const SAND_LIMITS = Object.freeze({ radius: RADIUS, maxDepth: DEPTH,
  maxBankHeight: MAX_BANK_HEIGHT, influenceRadius: LIMIT, minSegmentLength: MIN_TRAVEL, maxSegmentLength: MAX_TRAVEL });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
function noise(x, z) {
  const hash = (i, j) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const i = Math.floor(x), j = Math.floor(z);
  const u = smooth(0, 1, x - i), v = smooth(0, 1, z - j);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/**
 * baseBed: RGBA array (height, grass, rock, other), or (x,z)=>RGBA function.
 * waterEta: optional surface height in metres, or (x,z,bedHeight)=>height.
 * immersion: fallback water depth in metres, or (x,z,bedHeight)=>depth.
 * Neither water input present means dry sand. Grounded must be explicitly true.
 * consumeDirty(): null, or {rect, rows, tiles, reset, revision}. Row offsets and
 * counts are Float32 element units; tiles are row-major 2 m terrain tile IDs.
 * Tiles include a two-cell halo: boundary vertices' +/- one-texel normal
 * samples reach 1.5 texels into the cell-centred, bilinearly filtered field.
 * Read data/baseBed directly for uploads, but treat both arrays as read-only.
 */
export function createSandDeformation({ baseBed, bedResolution = 256, worldSize = 32 } = {}) {
  if (!Number.isInteger(bedResolution) || bedResolution < 2 || !Number.isFinite(worldSize) || worldSize <= 0) {
    throw new RangeError('Sand requires bedResolution >= 2 and a positive worldSize.');
  }
  const n = SAND_RESOLUTION, cellSize = worldSize / n, half = worldSize / 2;
  const cellArea = cellSize * cellSize, tileSize = 2, tilesPerSide = Math.ceil(worldSize / tileSize);
  const originalBed = new Float32Array(bedResolution * bedResolution * 4);
  if (typeof baseBed === 'function') {
    for (let z = 0; z < bedResolution; z++) for (let x = 0; x < bedResolution; x++) {
      const value = baseBed((x + .5) * worldSize / bedResolution - half, (z + .5) * worldSize / bedResolution - half);
      if (!value || value.length < 3) throw new TypeError('baseBed function must return height, grass and rock channels.');
      const k = (z * bedResolution + x) * 4;
      for (let ch = 0; ch < 4; ch++) originalBed[k + ch] = value[ch] ?? 0;
    }
  } else {
    if (!baseBed || baseBed.length !== originalBed.length) throw new RangeError('baseBed must be a bedResolution² RGBA array.');
    originalBed.set(baseBed);
  }
  if (!originalBed.every(Number.isFinite)) throw new TypeError('baseBed values must be finite.');

  const data = new Float32Array(n * n * 4), active = new Set(), dirtyTiles = new Set();
  const rowLeft = new Int32Array(n).fill(n), rowRight = new Int32Array(n).fill(-1);
  let left = n, right = -1, top = n, bottom = -1, resetPending = false, revision = 0;
  let removedVolume = 0, depositedVolume = 0, stampedSegments = 0, rejectedSegments = 0;
  let visitedCells = 0, lastVisitedCells = 0, lastChangedCells = 0;
  // Local footprint scratch is reused. Even a diagonal maximum-length stroke
  // visits a bounded rectangle; no stamp regenerates the million-cell field.
  const scratchSide = Math.ceil((MAX_TRAVEL + LIMIT * 2) / cellSize) + 4;
  const capacity = Math.min(n * n, scratchSide * scratchSide);
  const cuts = new Int32Array(capacity), takes = new Float64Array(capacity), edges = new Float64Array(capacity);
  const banks = new Int32Array(capacity), weights = new Float64Array(capacity), spaces = new Float64Array(capacity);
  const deposits = new Float64Array(capacity);

  function interpolate(array, resolution, x, z, channel) {
    const px = clamp((x + half) / worldSize * resolution - .5, 0, resolution - 1);
    const pz = clamp((z + half) / worldSize * resolution - .5, 0, resolution - 1);
    const i = Math.min(resolution - 2, Math.floor(px)), j = Math.min(resolution - 2, Math.floor(pz));
    const u = px - i, v = pz - j, a = (j * resolution + i) * 4 + channel, b = a + resolution * 4;
    return (array[a] * (1 - u) + array[a + 4] * u) * (1 - v) + (array[b] * (1 - u) + array[b + 4] * u) * v;
  }
  const sample = (x, z, channel = 0) => interpolate(data, n, x, z, channel);
  const sampleBase = (x, z, channel = 0) => interpolate(originalBed, bedResolution, x, z, channel);

  function mark(cell) {
    const i = cell % n, j = Math.floor(cell / n);
    left = Math.min(left, i); right = Math.max(right, i);
    top = Math.min(top, j); bottom = Math.max(bottom, j);
    rowLeft[j] = Math.min(rowLeft[j], i); rowRight[j] = Math.max(rowRight[j], i);
    const x0 = clamp(Math.floor((i - 2) * cellSize / tileSize), 0, tilesPerSide - 1);
    const x1 = clamp(Math.floor((i + 2) * cellSize / tileSize), 0, tilesPerSide - 1);
    const z0 = clamp(Math.floor((j - 2) * cellSize / tileSize), 0, tilesPerSide - 1);
    const z1 = clamp(Math.floor((j + 2) * cellSize / tileSize), 0, tilesPerSide - 1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) dirtyTiles.add(z * tilesPerSide + x);
  }

  function stampSegment(ax, az, bx, bz, { grounded = false, waterEta, immersion } = {}) {
    lastVisitedCells = 0; lastChangedCells = 0;
    const reject = reason => {
      rejectedSegments++;
      return { changed: false, reason, changedCells: 0, removedVolume: 0, depositedVolume: 0 };
    };
    if (grounded !== true) return reject('not-grounded');
    if (![ax, az, bx, bz].every(Number.isFinite)) return reject('invalid-segment');
    const vx = bx - ax, vz = bz - az, length = Math.hypot(vx, vz);
    if (length < MIN_TRAVEL || length > MAX_TRAVEL + 1e-10) return reject('travel-limit');
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - LIMIT + half) / cellSize));
    const x1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + LIMIT + half) / cellSize));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz) - LIMIT + half) / cellSize));
    const z1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + LIMIT + half) / cellSize));
    let cutCount = 0, bankCount = 0, requested = 0, available = 0;
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      lastVisitedCells++;
      const x = (i + .5) * cellSize - half, z = (j + .5) * cellSize - half;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / (length * length), 0, 1);
      const dx = x - ax - t * vx, dz = z - az - t * vz, dist = Math.hypot(dx, dz);
      if (dist > LIMIT) continue;
      const rock = clamp(sampleBase(x, z, 2), 0, 1), grass = clamp(sampleBase(x, z, 1), 0, 1);
      if (rock > .12 || grass > .35) continue;
      const cell = j * n + i, k = cell * 4, oldHeight = data[k];
      const bedHeight = sampleBase(x, z) + oldHeight;
      let wetDepth = 0;
      if (waterEta !== undefined && waterEta !== null) {
        const eta = typeof waterEta === 'function' ? waterEta(x, z, bedHeight) : waterEta;
        // Unknown/non-finite water is not evidence of a dry substrate.
        if (!Number.isFinite(eta)) continue;
        wetDepth = Math.max(0, eta - bedHeight);
      } else if (immersion !== undefined && immersion !== null) {
        const depth = typeof immersion === 'function' ? immersion(x, z, bedHeight) : immersion;
        if (!Number.isFinite(depth)) continue;
        wetDepth = Math.max(0, depth);
      }
      const material = (1 - rock) * (1 - smooth(.03, .35, grass)) * (1 - smooth(.10, .35, wetDepth));
      if (material < .03) continue;
      if (dist < RADIUS) {
        const edge = 1 - smooth(RADIUS * .5, RADIUS, dist), target = -DEPTH * edge * material;
        if (oldHeight > target + 1e-9) {
          cuts[cutCount] = cell; takes[cutCount] = oldHeight - target; edges[cutCount] = edge * material;
          requested += takes[cutCount++];
        }
      } else if (oldHeight > -.012 && oldHeight < MAX_BANK_HEIGHT - 1e-8) {
        const side = Math.abs(dx * vz - dz * vx) / Math.max(length * dist, 1e-12);
        const roughness = .85 + .30 * noise(x * 29.4, z * 29.4);
        const weight = Math.exp(-(((dist - BANK_RADIUS) / .102) ** 2)) * roughness * material * side ** 4;
        if (weight > .005) {
          banks[bankCount] = cell; weights[bankCount] = weight;
          spaces[bankCount] = MAX_BANK_HEIGHT - oldHeight; deposits[bankCount] = 0;
          available += spaces[bankCount++];
        }
      }
    }
    visitedCells += lastVisitedCells;
    if (requested <= 0) return reject('no-erodible-sand');
    // Plan both sides of the transfer before changing any cell. A rock-bound
    // groove with nowhere to deposit cannot silently destroy its sediment.
    if (available <= 1e-9 || bankCount === 0) return reject('no-bank-capacity');
    const amount = Math.min(requested, available), fraction = amount / requested;
    let removed = 0;
    for (let a = 0; a < cutCount; a++) {
      const cell = cuts[a], k = cell * 4, before = data[k];
      data[k] = before - takes[a] * fraction;
      removed += before - data[k];
      if (data[k] === before) continue;
      data[k + 1] = Math.max(data[k + 1], edges[a] * fraction);
      data[k + 2] = Math.max(data[k], 0);
      active.add(cell); mark(cell); lastChangedCells++;
    }
    // Capped weighted distribution preserves the two side shoulders. Repeated
    // crossings cannot build arbitrarily tall banks. Saturated cells drop out
    // of subsequent rounds; the final capacity pass bounds pathological work.
    let remainder = removed;
    for (let pass = 0; pass < 16 && remainder > 1e-12; pass++) {
      let totalWeight = 0;
      for (let b = 0; b < bankCount; b++) if (spaces[b] - deposits[b] > 1e-12) totalWeight += weights[b];
      if (!totalWeight) break;
      const budget = remainder;
      for (let b = 0; b < bankCount; b++) {
        const room = spaces[b] - deposits[b];
        if (room <= 1e-12) continue;
        const deposit = Math.min(room, budget * weights[b] / totalWeight);
        deposits[b] += deposit; remainder -= deposit;
      }
    }
    for (let b = 0; b < bankCount && remainder > 1e-12; b++) {
      const deposit = Math.min(spaces[b] - deposits[b], remainder);
      deposits[b] += deposit; remainder -= deposit;
    }
    let deposited = 0;
    for (let b = 0; b < bankCount; b++) {
      if (deposits[b] <= 0) continue;
      const cell = banks[b], k = cell * 4, before = data[k];
      data[k] = Math.min(MAX_BANK_HEIGHT, before + deposits[b]);
      deposited += data[k] - before;
      if (data[k] === before) continue;
      data[k + 1] = Math.max(data[k + 1], .22 * weights[b]);
      data[k + 2] = Math.max(data[k], 0);
      active.add(cell); mark(cell); lastChangedCells++;
    }
    // Account using actual Float32 deltas. Correct representable rounding
    // residue in a shoulder; the remaining error is below a cell's ULP.
    let residue = removed - deposited;
    for (let b = 0; b < bankCount && Math.abs(residue) > 1e-12; b++) {
      const cell = banks[b], k = cell * 4, before = data[k];
      const corrected = Math.fround(clamp(before + residue, before - deposits[b], MAX_BANK_HEIGHT));
      const delta = corrected - before;
      if (!delta || Math.abs(residue - delta) >= Math.abs(residue)) continue;
      data[k] = corrected; data[k + 2] = Math.max(corrected, 0);
      deposited += delta; residue -= delta;
      active.add(cell); mark(cell);
    }
    // If every shoulder is at its representable cap, return any rounding
    // excess to a cut instead of counting sand that had nowhere to settle.
    for (let a = 0; a < cutCount && residue > 1e-12; a++) {
      const cell = cuts[a], k = cell * 4, before = data[k];
      const corrected = Math.fround(before + Math.min(residue, takes[a] * fraction));
      const refund = corrected - before;
      if (!refund || Math.abs(residue - refund) >= Math.abs(residue)) continue;
      data[k] = corrected; data[k + 2] = Math.max(corrected, 0);
      removed -= refund; residue -= refund; mark(cell);
    }
    removedVolume += removed * cellArea; depositedVolume += deposited * cellArea;
    stampedSegments++; revision++;
    return { changed: lastChangedCells > 0, changedCells: lastChangedCells,
      removedVolume: removed * cellArea, depositedVolume: deposited * cellArea };
  }

  function consumeDirty() {
    if (right < left) return null;
    const rect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    const rows = [];
    for (let y = top; y <= bottom; y++) {
      if (rowRight[y] < rowLeft[y]) continue;
      const x = rowLeft[y], width = rowRight[y] - x + 1;
      rows.push({ x, y, width, offset: (y * n + x) * 4, count: width * 4 });
      rowLeft[y] = n; rowRight[y] = -1;
    }
    const tiles = [...dirtyTiles].sort((a, b) => a - b), reset = resetPending;
    dirtyTiles.clear(); left = top = n; right = bottom = -1; resetPending = false;
    return { rect, rows, tiles, reset, revision };
  }

  function reset() {
    // Clear only touched texels and retain their upload/mesh invalidations.
    if (active.size) {
      for (const cell of active) { data.fill(0, cell * 4, cell * 4 + 4); mark(cell); }
      active.clear(); resetPending = true; revision++;
    }
    removedVolume = depositedVolume = stampedSegments = rejectedSegments = visitedCells = 0;
    lastVisitedCells = lastChangedCells = 0;
  }

  function stats() {
    let minHeight = 0, maxHeight = 0, netVolume = 0, maxCompression = 0;
    for (const cell of active) {
      const k = cell * 4, height = data[k];
      minHeight = Math.min(minHeight, height); maxHeight = Math.max(maxHeight, height);
      maxCompression = Math.max(maxCompression, data[k + 1]); netVolume += height * cellArea;
    }
    return { resolution: n, cellSize, activeCells: active.size, minHeight, maxHeight, maxCompression,
      removedVolume, depositedVolume, netVolume, sedimentError: depositedVolume - removedVolume,
      stampedSegments, rejectedSegments, visitedCells, lastVisitedCells, lastChangedCells, revision };
  }

  return { data, baseBed: originalBed, resolution: n, bedResolution, worldSize, cellSize,
    tileSize, tilesPerSide, limits: SAND_LIMITS, sample, sampleBase, stampSegment, consumeDirty, reset, stats };
}
