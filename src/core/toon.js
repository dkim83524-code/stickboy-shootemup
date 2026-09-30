import * as THREE from 'three';

/*
 * Cel shading + "shell" outlines.
 * - toonMat(): MeshToonMaterial with a hard 3-step light ramp.
 * - outlineMat(): back-face hull pushed out along vertex normals and drawn in flat ink,
 *   the classic inverted-hull outline. Boxes use an enlarged back-face box instead,
 *   because their split normals would tear the hull apart at the edges.
 */

export const INK = 0x14121a;

let gradient = null;
export function toonGradient() {
  if (!gradient) {
    const data = new Uint8Array([70, 160, 255]);
    gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map();
/** Shared toon material (cached by color). Pass {unique:true} for a private copy. */
export function toonMat(color, { unique = false, ...opts } = {}) {
  if (!unique) {
    const key = `${color}|${JSON.stringify(opts)}`;
    let m = toonCache.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
      toonCache.set(key, m);
    }
    return m;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

const outlineVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float thickness;
  void main() {
    vec3 transformed = position + normal * thickness;
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const outlineFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 color;
  uniform float opacity;
  void main() {
    gl_FragColor = vec4(color, opacity);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function outlineMat({ thickness = 0.03, color = INK, opacity = 1, depthTest = true, fog = true } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      thickness: { value: thickness },
      color: { value: new THREE.Color(color) },
      opacity: { value: opacity },
    },
  ]);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    fog,
    transparent: opacity < 1 || !depthTest,
    depthTest,
    depthWrite: depthTest,
  });
}

const outlineCache = new Map();
export function sharedOutline(thickness = 0.03) {
  let m = outlineCache.get(thickness);
  if (!m) {
    m = outlineMat({ thickness });
    outlineCache.set(thickness, m);
  }
  return m;
}

/** Adds an inverted-hull outline child to `mesh` (sharing its geometry). */
export function addOutline(mesh, thickness = 0.03, material = null) {
  const o = new THREE.Mesh(mesh.geometry, material || sharedOutline(thickness));
  o.name = 'outline';
  o.userData.isOutline = true;
  o.castShadow = false;
  o.receiveShadow = false;
  mesh.add(o);
  return o;
}

/** Convenience: toon mesh with outline. */
export function inked(geometry, color, thickness = 0.03, { cast = true, receive = false, mat = null } = {}) {
  const m = new THREE.Mesh(geometry, mat || toonMat(color));
  m.castShadow = cast;
  m.receiveShadow = receive;
  addOutline(m, thickness);
  return m;
}
