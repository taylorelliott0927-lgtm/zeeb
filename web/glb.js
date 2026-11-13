// Loads .glb 3D models from Zeeb's model library and turns them into flat-shaded meshes
// for the little engine (each triangle painted with its material, texture or vertex colour).
const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(n) {
  if (n.matrix) return new Float32Array(n.matrix);
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], t = n.translation || [0, 0, 0];
  return new Float32Array([(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1]);
}

async function imagePixels(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = Math.min(bmp.width, 512); c.height = Math.min(bmp.height, 512);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}

// Returns { positions, colors } as flat arrays (triangle soup), or null.
export async function loadGLB(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const view = (i) => { const v = gltf.bufferViews[i]; return { off: binStart + (v.byteOffset || 0), len: v.byteLength, stride: v.byteStride || 0 }; };
  const read = (i) => {
    const a = gltf.accessors[i], v = view(a.bufferView), n = TYPES[a.type], T = ARRAYS[a.componentType];
    const out = new Float32Array(a.count * n), start = v.off + (a.byteOffset || 0), size = T.BYTES_PER_ELEMENT;
    const stride = v.stride || n * size, norm = a.normalized && T !== Float32Array ? (T === Uint8Array ? 255 : T === Uint16Array ? 65535 : 1) : 1;
    for (let k = 0; k < a.count; k++) for (let j = 0; j < n; j++) {
      const p = start + k * stride + j * size;
      const val = T === Float32Array ? dv.getFloat32(p, true) : T === Uint16Array ? dv.getUint16(p, true) : T === Uint32Array ? dv.getUint32(p, true) : T === Uint8Array ? dv.getUint8(p) : T === Int16Array ? dv.getInt16(p, true) : dv.getInt8(p);
      out[k * n + j] = val / norm;
    }
    return out;
  };
  // textures, decoded once
  const pix = await Promise.all((gltf.images || []).map(async (im) => {
    if (im.bufferView === undefined) return null;
    const v = view(im.bufferView);
    try { return await imagePixels(new Blob([new Uint8Array(buf, v.off, v.len)], { type: im.mimeType || "image/png" })); } catch { return null; }
  }));
  const texOf = (mat) => { const t = mat?.pbrMetallicRoughness?.baseColorTexture; return t ? pix[gltf.textures?.[t.index]?.source] : null; };
  const sample = (img, u, v) => {
    const x = Math.min(img.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * img.w))), y = Math.min(img.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * img.h)));
    const i = (y * img.w + x) * 4;
    return [img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255];
  };
  // glTF colours are linear; the engine works in screen colours.
  const toScreen = (c) => Math.pow(Math.max(0, c), 1 / 2.2);

  const positions = [], colors = [];
  const visit = (ni, parent) => {
    const n = gltf.nodes[ni], m = mul(parent, trs(n));
    if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined) continue;
      const P = read(p.attributes.POSITION), idx = p.indices !== undefined ? read(p.indices) : null;
      const UV = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : null;
      const VC = p.attributes.COLOR_0 !== undefined ? read(p.attributes.COLOR_0) : null, vcN = VC ? TYPES[gltf.accessors[p.attributes.COLOR_0].type] : 0;
      const mat = gltf.materials?.[p.material], f = mat?.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1], img = texOf(mat);
      const count = idx ? idx.length : P.length / 3;
      for (let t = 0; t + 2 < count; t += 3) {
        const vi = [0, 1, 2].map((k) => (idx ? idx[t + k] : t + k));
        // one colour per triangle, sampled at its middle: keeps the flat low-poly look
        let c = [f[0], f[1], f[2]];
        if (img && UV) { const u = (UV[vi[0] * 2] + UV[vi[1] * 2] + UV[vi[2] * 2]) / 3, v = (UV[vi[0] * 2 + 1] + UV[vi[1] * 2 + 1] + UV[vi[2] * 2 + 1]) / 3; const s = sample(img, u, v); c = [c[0] * s[0] ** 2.2, c[1] * s[1] ** 2.2, c[2] * s[2] ** 2.2]; }
        if (VC) { const avg = (o) => (VC[vi[0] * vcN + o] + VC[vi[1] * vcN + o] + VC[vi[2] * vcN + o]) / 3; c = [c[0] * avg(0), c[1] * avg(1), c[2] * avg(2)]; }
        const sc = c.map(toScreen);
        for (const i of vi) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
          positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          colors.push(...sc);
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const scene = gltf.scenes?.[gltf.scene || 0];
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const ni of scene?.nodes || []) visit(ni, I);
  return positions.length ? { positions, colors } : null;
}
