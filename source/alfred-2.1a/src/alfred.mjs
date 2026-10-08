import * as THREE from 'three/webgpu';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ALFRED_GLB_BASE64, ALFRED_ASSET_SHA256} from './alfred-asset-data.mjs';
import {ALFRED_BODY_PROFILE, ALFRED_SOURCE_BOUNDS} from './body-profile.mjs';

export {ALFRED_BODY_PROFILE, ALFRED_ASSET_SHA256};

function embeddedGLB() {
  const binary = atob(ALFRED_GLB_BASE64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Native-render QA can supply a PNG decoder without replacing GLTFLoader or
// altering the browser texture path. The approved asset has embedded RGBA PNG.
function nativeTexturePlugin(parser, decode) {
  const filters = {
    9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
    9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
    9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter,
  };
  const wraps = {33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping};
  return {
    name: 'SHORE_native_embedded_texture',
    async loadTexture(index) {
      const definition = parser.json.textures[index], source = parser.json.images[definition.source];
      if (source.bufferView === undefined) throw new Error('Alfred native texture must be embedded');
      const bytes = new Uint8Array(await parser.getDependency('bufferView', source.bufferView));
      const decoded = await decode(bytes);
      if (!Number.isInteger(decoded?.width) || !Number.isInteger(decoded?.height)
          || decoded.width <= 0 || decoded.height <= 0 || !(decoded.data instanceof Uint8Array)
          || decoded.data.length !== decoded.width * decoded.height * 4) {
        throw new Error('shoreNativeTextureDecoder must return RGBA8 data, width and height');
      }
      const texture = new THREE.DataTexture(decoded.data, decoded.width, decoded.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      const sampler = parser.json.samplers?.[definition.sampler] || {};
      texture.name = definition.name || source.name || '';
      texture.flipY = false;
      texture.magFilter = filters[sampler.magFilter] || THREE.LinearFilter;
      texture.minFilter = filters[sampler.minFilter] || THREE.LinearMipmapLinearFilter;
      texture.wrapS = wraps[sampler.wrapS] || THREE.RepeatWrapping;
      texture.wrapT = wraps[sampler.wrapT] || THREE.RepeatWrapping;
      texture.generateMipmaps = texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
      texture.userData.mimeType = source.mimeType;
      texture.needsUpdate = true;
      parser.associations.set(texture, {textures: index});
      return texture;
    },
  };
}

/** Feet-at-zero visual. Place this group at -profile.halfHeight in the player. */
export async function createAlfredVisual() {
  const loader = new GLTFLoader();
  if (typeof globalThis.shoreNativeTextureDecoder === 'function') {
    const decode = globalThis.shoreNativeTextureDecoder;
    loader.register(parser => nativeTexturePlugin(parser, decode));
  }
  const gltf = await loader.parseAsync(embeddedGLB(), '');
  const visual = new THREE.Group();
  visual.name = 'Alfred';
  const model = gltf.scene, {scale} = ALFRED_BODY_PROFILE;
  model.scale.setScalar(scale);
  model.position.set(
    -(ALFRED_SOURCE_BOUNDS.min[0] + ALFRED_SOURCE_BOUNDS.max[0]) * .5 * scale,
    -ALFRED_SOURCE_BOUNDS.min[1] * scale,
    -(ALFRED_SOURCE_BOUNDS.min[2] + ALFRED_SOURCE_BOUNDS.max[2]) * .5 * scale,
  );
  visual.add(model);
  visual.traverse(object => {
    object.layers.set(1);
    if (!object.isMesh) return;
    object.castShadow = object.name !== 'Alfred_Fur_Tufts';
    object.receiveShadow = true;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.transparent = false;
      material.opacity = 1;
    }
  });
  visual.userData.alfred = {
    sourceSha256: ALFRED_ASSET_SHA256,
    bodyProfile: ALFRED_BODY_PROFILE,
    origin: 'feet at y=0, centered x/z, +Z front',
    triangles: 71666,
    basePassDraws: 3,
  };
  return visual;
}
