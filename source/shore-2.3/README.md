# Shore 2.3 — isolated candidate

This candidate starts from `source/optics-2.2`. The previous published routes remain unchanged.

## Run

Use Node.js 20 or newer: `npm ci`, `npm run build`, then serve `dist` over localhost or HTTPS. Three.js is pinned to 0.186.1. The application selects its existing, separate WebGL2 V9 fallback if WebGPU is unavailable. V9 does not reproduce the new WebGPU effects.

## Implemented stages

1. Nonlinear 256×256 shallow-water simulation on a 32m domain (12.5cm cells): limited reconstruction, Rusanov flux, wet/dry, eight deterministic JONSWAP-shaped incident components, boundary relaxation and side absorption. This is a heightfield hydraulic-bore model, not an overturning 3D fluid surface.
2. Separate fresh/residual foam densities, limited MacCormack advection, two renewed material-coordinate charts, simulation-derived sources and density-controlled cellular coverage. Defaults: 1.5s/30s characteristic decay times; residual density is capped at0.45 so only fresh foam can become fully opaque. Desktop field1024², mobile512²; transport updates at30Hz. Density resolution does not add unresolved flow vortices.
3. 64 capillary/gravity-dispersive micro modes over rotated1.73m and6.31m tiles. The small256² tile resolves the requested2cm band. Flow blending and filtered slope variance drive normals/roughness.
4. Tunable attenuation/inscatter, prefiltered shared sky, active caustic receiver lighting and limited cubic surface reconstruction. Desktop render mesh512², mobile256²; physical grid stays256².
5. Independent moving dispersive ripple window:512² over8×8m on desktop,256² over4×4m on mobile (both1.56cm cells), with body immersion/movement sources, edge damping and integer world-preserving shifts. Idle windows stop updating after residual decay.
6. Player-focused DOF, water-only bloom via MRT, single ACES/output transform and FXAA. Expensive postprocessing defaults off on mobile, with pixel ratio capped at1.25 and FXAA instead of multisampling. GUI controls cover wave/foam/detail/optical/ripple/post parameters and debug views.

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

## October 8 repair

- Fixed-step60Hz simulation clock accepts20–120Hz frames consistently, caps catch-up and explicitly records dropped time after long stalls. At most two GPU frames remain queued; input handlers keep running. Device errors remain visible and route to the existing V9 fallback.
- Batched SWE substeps; foam transport reuses a256² flow/source map and256² material-coordinate charts while density stays1024²/512². Micro detail updates once per rendered frame and caustics at most30Hz. Far subpixel grass uses fewer, wider leaves; nearby grass is unchanged.
- Desktop retains512² water geometry,1024² foam and postprocessing. FXAA is the default; optional4×MSAA is available in the panel or with `?msaa=4`. The former combination paid both costs. Default DOF is gentler for clearer scene detail.
- Caustic coverage and irradiance are normalized separately. Dry-edge projected rays use the neighboring water plane; flat water over the real bed now gives unit irradiance within half-float rounding. Early dry-water fragment discard skips invisible ray tracing.
- Landing events coordinate an elliptical thin crown, smaller ballistic droplets, fresh foam and local ripples. Returning droplets emit bounded secondary ripples only over wet terrain. This is an inexpensive visual approximation, not a volumetric splash solver.
- Immersion HUD now reports displaced-volume fraction rather than immersed centimetres. Performance diagnostics remain local until explicitly copied.

Controlled Dawn/SwiftShader640×426 profiling localized the costs: mobile full render approximately5.03→2.96 seconds; desktop approximately10.76→4.49 seconds after removing extra MSAA, before the final early-discard/DOF changes. These are software queue-completed wall times, not pure GPU timestamps, phone/PC FPS, or a60FPS claim. Visual density and geometry resolutions were retained; edge antialiasing and distant grass coverage may differ.

Repair checks include flat-water caustic neutrality, fixed-clock stall recovery, bounded queue/device-loss fallback, finite SWE/impulse/wet-dry state, repeated water entries/reset, and wet-only secondary droplet returns. A pale dynamic caustic contour remains in some shallow views; the live caustic slider can disable it. Remaining reference matching and real-device performance must be evaluated on the target hardware.
