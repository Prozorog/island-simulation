# Shore 2.3 — isolated candidate

This candidate starts from `source/optics-2.2`. The previous published routes remain unchanged.

## Run

Use Node.js 20 or newer: `npm ci`, `npm run build`, then serve `dist` over localhost or HTTPS. Three.js is pinned to 0.186.1. The application selects its existing, separate WebGL2 V9 fallback if WebGPU is unavailable. V9 does not reproduce the new WebGPU effects.

## Implemented stages

1. Nonlinear 256×256 shallow-water simulation on a 32m domain (12.5cm cells): limited reconstruction, Rusanov flux, wet/dry, eight deterministic JONSWAP-shaped incident components, boundary relaxation and side absorption. This is a heightfield hydraulic-bore model, not an overturning 3D fluid surface.
2. Separate fresh/residual foam densities, limited MacCormack advection, two renewed material-coordinate charts, simulation-derived sources and density-controlled cellular coverage. Defaults: 1.5s/30s characteristic decay times; residual density is capped at0.45 so only fresh foam can become fully opaque. Desktop field1024², mobile512²; transport updates at30Hz. Density resolution does not add unresolved flow vortices.
3. 64 capillary/gravity-dispersive micro modes over rotated1.73m and6.31m tiles. The small256² tile resolves the requested2cm band. Flow blending and filtered slope variance drive normals/roughness.
4. Tunable attenuation/inscatter, prefiltered shared sky, active caustic receiver lighting and limited cubic surface reconstruction. Desktop render mesh512², mobile256²; physical grid stays256².
5. Independent moving8×8m dispersive ripple window,512² desktop/256² mobile, with body immersion/movement sources, edge damping and integer world-preserving shifts. Idle windows stop updating after residual decay.
6. Player-focused DOF, water-only bloom via MRT, single ACES/output transform and FXAA. Expensive postprocessing defaults off on mobile, with pixel ratio capped at1 and FXAA instead of multisampling. GUI controls cover wave/foam/detail/optical/ripple/post parameters and debug views.

`?preset=mobile` or `?preset=high` explicitly selects field/mesh quality. Changing the preset reloads; scalar settings update live. Physics grid resolution is not reduced.

## Verification boundaries

- Actual native Dawn/Vulkan/SwiftShader compute and pixel captures; not hardware GPU or phone FPS measurements.
- Lake-at-rest, body impulse, forced-wave positivity, reset and local ripple stability checks included in `qa`.
- The forced open-boundary test does not require constant total water volume. Numerical clipping of negative depth is audited separately.
- Software-rendered diagnostic video records simulated time at24fps; it is not a realtime performance claim.
- Screenshots alone do not prove bore propagation, long foam lifetime, mobile input behavior or60fps.
- Reference color coefficients required adjustment in this scene because the suggested starting values produced excessively pale water. All are exposed for tuning.
- Current target remains experimental. Do not claim visual parity with external references or guaranteed60fps.

## Useful diagnostics

`window.shoreDemoGPU` exposes `setView('shore'|'water'|'wide')`, pause/reset, telemetry and the scene. The water material exposes `userData.shoreDebug` including velocity, Froude, wet/dry, foam source/density/charts, micro normals, roughness, slope variance, ripple, depth and Fresnel.
