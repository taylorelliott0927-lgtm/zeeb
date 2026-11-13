// A tiny dependency-free WebGL2 engine: low-poly meshes, one sun, fog and a painted sky.
// Small on purpose so the whole site is self-contained and free to host anywhere.

// ---------- math (column-major 4x4) ----------
export const M4 = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  persp(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(e, t, up = [0, 1, 0]) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
    ]);
  },
  // translate * rotY * rotX * rotZ * scale
  trs(p, r, s) {
    const [x, y, z] = r;
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
    const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
    const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
    return new Float32Array([
      m00 * s[0], m10 * s[0], m20 * s[0], 0,
      m01 * s[1], m11 * s[1], m21 * s[1], 0,
      m02 * s[2], m12 * s[2], m22 * s[2], 0,
      p[0], p[1], p[2], 1,
    ]);
  },
  invert(m) {
    const inv = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.ident();
    det = 1 / det;
    inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return inv;
  },
  apply(m, v) {
    const [x, y, z] = v, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
  },
};

// ---------- geometry (triangle soup, flat shaded) ----------
function quad(out, a, b, c, d) { out.push(...a, ...b, ...c, ...a, ...c, ...d); }

export const Geo = {
  box(w = 1, h = 1, d = 1) {
    const x = w / 2, y = h / 2, z = d / 2, o = [];
    const v = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]];
    quad(o, v[0], v[1], v[2], v[3]); quad(o, v[5], v[4], v[7], v[6]);
    quad(o, v[3], v[2], v[6], v[7]); quad(o, v[4], v[5], v[1], v[0]);
    quad(o, v[1], v[5], v[6], v[2]); quad(o, v[4], v[0], v[3], v[7]);
    return o;
  },
  // Cylinder along Y, centered. rTop 0 makes a cone. arc < 2PI makes a half pipe (hangar roof).
  cyl(rTop = 0.5, rBot = 0.5, h = 1, seg = 12, arc = Math.PI * 2, caps = true) {
    const o = [], y0 = -h / 2, y1 = h / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * arc, a1 = ((i + 1) / seg) * arc;
      const p = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
      quad(o, p(rBot, a1, y0), p(rBot, a0, y0), p(rTop, a0, y1), p(rTop, a1, y1));
      if (caps) {
        if (rTop > 0) o.push(0, y1, 0, ...p(rTop, a1, y1), ...p(rTop, a0, y1));
        if (rBot > 0) o.push(0, y0, 0, ...p(rBot, a0, y0), ...p(rBot, a1, y0));
      }
    }
    return o;
  },
  sphere(r = 0.5, ws = 12, hs = 8) {
    const o = [];
    const p = (i, j) => {
      const th = (i / ws) * Math.PI * 2, ph = (j / hs) * Math.PI;
      return [Math.cos(th) * Math.sin(ph) * r, Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r];
    };
    for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) quad(o, p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1));
    return o;
  },
  ground(size, seg, hfn) {
    const o = [], s = size / seg, h0 = -size / 2;
    for (let j = 0; j < seg; j++)
      for (let i = 0; i < seg; i++) {
        const x0 = h0 + i * s, z0 = h0 + j * s, x1 = x0 + s, z1 = z0 + s;
        const v = (x, z) => [x, hfn(x, z), z];
        quad(o, v(x0, z1), v(x1, z1), v(x1, z0), v(x0, z0));
      }
    return o;
  },
};

function flatNormals(pos) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { n[i + k * 3] = nx; n[i + k * 3 + 1] = ny; n[i + k * 3 + 2] = nz; }
  }
  return n;
}

// ---------- scene nodes ----------
export class Node {
  constructor(mesh = null, opts = {}) {
    this.mesh = mesh;
    this.color = opts.color || [1, 1, 1];
    this.emissive = opts.emissive || 0;
    this.pos = opts.pos || [0, 0, 0];
    this.rot = opts.rot || [0, 0, 0];
    this.scale = opts.scale || [1, 1, 1];
    this.visible = opts.visible ?? true;
    this.children = [];
    this.world = M4.ident();
  }
  add(...kids) { this.children.push(...kids); return this; }
  update(parent) {
    const local = M4.trs(this.pos, this.rot, this.scale);
    this.world = parent ? M4.mul(parent, local) : local;
    for (const c of this.children) c.update(this.world);
  }
}

const VS = `#version 300 es
in vec3 a_pos; in vec3 a_nrm; in vec3 a_col;
uniform mat4 u_model, u_vp;
out vec3 v_n; out vec3 v_w; out vec3 v_c;
void main(){ vec4 w = u_model * vec4(a_pos,1.0); v_w = w.xyz; v_n = mat3(u_model) * a_nrm; v_c = a_col; gl_Position = u_vp * w; }`;
const FS = `#version 300 es
precision highp float;
in vec3 v_n; in vec3 v_w; in vec3 v_c;
uniform vec3 u_color, u_sun, u_sunCol, u_amb, u_sky, u_gnd, u_fog, u_cam;
uniform float u_emis, u_fogD;
out vec4 o;
void main(){
  vec3 n = normalize(v_n); if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, u_sun), 0.0);
  vec3 hemi = mix(u_gnd, u_sky, n.y*0.5+0.5);
  vec3 base = u_color * v_c;
  vec3 c = base * (u_amb + hemi*0.55 + u_sunCol*d);
  c = mix(c, base*1.4, u_emis);
  float dist = length(v_w - u_cam);
  float f = 1.0 - exp(-pow(dist*u_fogD, 1.6));
  o = vec4(mix(c, u_fog, clamp(f,0.0,1.0)), 1.0);
}`;
const SKY_VS = `#version 300 es
in vec2 a_p; out vec2 v_p;
void main(){ v_p = a_p; gl_Position = vec4(a_p, 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_p;
uniform mat4 u_ivp;
uniform vec3 u_top, u_hor, u_sunA, u_sunB, u_sunCol, u_fog;
uniform float u_stars, u_haze;
out vec4 o;
float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec4 a = u_ivp * vec4(v_p, -1.0, 1.0); vec4 b = u_ivp * vec4(v_p, 1.0, 1.0);
  vec3 dir = normalize(b.xyz/b.w - a.xyz/a.w);
  float h = clamp(dir.y, -0.2, 1.0);
  vec3 c = mix(u_hor, u_top, pow(max(h,0.0), 0.55));
  float sa = max(dot(dir, u_sunA), 0.0), sb = max(dot(dir, u_sunB), 0.0);
  c += u_sunCol * (pow(sa, 900.0)*3.0 + pow(sa, 12.0)*0.35);
  c += u_sunCol * vec3(1.0,0.75,0.6) * (pow(sb, 1400.0)*2.2 + pow(sb, 16.0)*0.22);
  if (u_stars > 0.0 && dir.y > 0.0) {
    vec3 q = floor(dir*220.0);
    float s = step(0.985, hash(q));
    c += vec3(s) * u_stars * smoothstep(0.0, 0.25, dir.y);
  }
  c = mix(c, u_fog, u_haze * (1.0 - smoothstep(0.0, 0.5, h)));
  o = vec4(c, 1.0);
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: true });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl; this.canvas = canvas;
    this.prog = compile(gl, VS, FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);
    this.skyVao = gl.createVertexArray();
    gl.bindVertexArray(this.skyVao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.sky.p, "a_p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    this.cache = new Map();
  }
  // colors (optional): one RGB per vertex, for models that carry their own paint; plain meshes are white and tinted by node color.
  mesh(positions, colors = null) {
    const gl = this.gl, pos = new Float32Array(positions), nrm = flatNormals(pos);
    const col = colors ? new Float32Array(colors) : new Float32Array(pos.length).fill(1);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [name, data] of [["a_pos", pos], ["a_nrm", nrm], ["a_col", col]]) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.prog.p, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
    return { vao, count: pos.length / 3 };
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }
  render(root, cam, env) {
    const gl = this.gl;
    const aspect = this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...env.fog, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = M4.persp(cam.fov, aspect, 0.1, 400), view = M4.lookAt(cam.eye, cam.target);
    this.vp = M4.mul(proj, view);
    // sky
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    const su = this.sky.u;
    gl.uniformMatrix4fv(su.u_ivp, false, M4.invert(this.vp));
    gl.uniform3fv(su.u_top, env.skyTop); gl.uniform3fv(su.u_hor, env.skyHorizon);
    gl.uniform3fv(su.u_sunA, env.sunA); gl.uniform3fv(su.u_sunB, env.sunB); gl.uniform3fv(su.u_sunCol, env.sunSky);
    gl.uniform3fv(su.u_fog, env.fog); gl.uniform1f(su.u_stars, env.stars); gl.uniform1f(su.u_haze, env.haze);
    gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    // meshes
    gl.useProgram(this.prog.p);
    const u = this.prog.u;
    gl.uniformMatrix4fv(u.u_vp, false, this.vp);
    gl.uniform3fv(u.u_sun, env.light); gl.uniform3fv(u.u_sunCol, env.lightColor); gl.uniform3fv(u.u_amb, env.ambient);
    gl.uniform3fv(u.u_sky, env.skyTop); gl.uniform3fv(u.u_gnd, env.groundBounce); gl.uniform3fv(u.u_fog, env.fog);
    gl.uniform3fv(u.u_cam, cam.eye); gl.uniform1f(u.u_fogD, env.fogDensity);
    root.update(null);
    const draw = (n) => {
      if (!n.visible) return;
      if (n.mesh) {
        gl.uniformMatrix4fv(u.u_model, false, n.world);
        gl.uniform3fv(u.u_color, n.color); gl.uniform1f(u.u_emis, n.emissive);
        gl.bindVertexArray(n.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, n.mesh.count);
      }
      for (const c of n.children) draw(c);
    };
    draw(root);
  }
  // world point -> CSS pixels, or null when behind the camera
  project(p) {
    if (!this.vp) return null;
    const [x, y, z, w] = M4.apply(this.vp, p);
    if (w <= 0 || z > 1) return null;
    return { x: (x * 0.5 + 0.5) * this.canvas.clientWidth, y: (1 - (y * 0.5 + 0.5)) * this.canvas.clientHeight };
  }
}
