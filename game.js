// Flying Roadster Sim: two stunts from the Roadster reveal (the kickflip over five cars, the ramp wall drop) on a limited air tank.
// Plain three.js, no build step. Physics is a simple 2D side model (x forward, y up) plus a barrel-roll angle.
import * as THREE from 'three';

const RED = 0xff3b2f;
const DEBUG = new URLSearchParams(location.search).has('debug');
const $ = (id) => document.getElementById(id);

// ---------------- tuning (numbers echo the reel: 250 kg of air, ~30 kg/s to hover, so ~8 s) ----------------
const G = 9.81;
const AIR0 = 250;            // kg
const LIFT_ACC = 15.5;       // m/s^2 along the car's up axis while LIFT is held
const LIFT_BURN = 30;        // kg/s
const BOOST_ACC = 16;        // m/s^2 forward (the Thrust trim's rear jets are for straight-line punch)
const BOOST_BURN = 16;       // kg/s
const CRUISE = 12;           // m/s the car drives itself to on the ground
const ROLL_TIME = 0.9;       // s for a full barrel roll
const CAR_LEN = 4.4, CAR_H = 1.15, CAR_HALF_W = 1.0;
const LANE_END = 118;        // end of the pad
const LINEUP = [             // parked side by side, lengths across the lane, facing the camera
  { name: 'Model 3', x: 42.0, L: 4.72, W: 1.85, H: 1.44, prof: [[0, .3], [.02, .55], [.22, .68], [.37, .98], [.58, 1], [.86, .82], [1, .68], [1, .3]], col: 0x16181c, wr: .35, bar: .6 },
  { name: 'Model Y', x: 45.6, L: 4.75, W: 1.92, H: 1.62, prof: [[0, .3], [.02, .55], [.2, .66], [.35, .97], [.62, 1], [.9, .86], [1, .7], [1, .3]], col: 0x3a1e22, wr: .36, bar: .58 },
  { name: 'Semi', x: 49.6, L: 6.4, W: 2.6, H: 4.11, prof: [[0, .16], [0, .55], [.06, .9], [.17, 1], [.42, 1], [.44, .36], [1, .36], [1, .16]], col: 0xe4e6e9, wr: .52, bar: .3 },
  { name: 'Cybertruck', x: 53.6, L: 5.68, W: 2.03, H: 1.8, prof: [[0, .3], [0, .6], [.43, 1], [1, .72], [1, .3]], col: 0xb4b8be, wr: .44, bar: .6, metal: .9 },
  { name: 'Cybercab', x: 57.2, L: 4.3, W: 1.9, H: 1.42, prof: [[0, .28], [.02, .52], [.26, .7], [.44, 1], [.6, .98], [1, .6], [1, .28]], col: 0xb8a47a, wr: .34, bar: .6, metal: .75 },
];
const CLEAR_X = LINEUP[LINEUP.length - 1].x + LINEUP[LINEUP.length - 1].W / 2 + CAR_LEN / 2;

// ---------------- renderer, scene, camera ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// ?debug&pr=3 forces a pixel ratio (used to record crisp 1080x1920 footage)
const PR = DEBUG && new URLSearchParams(location.search).has('pr') ? +new URLSearchParams(location.search).get('pr') : Math.min(1.5, window.devicePixelRatio || 1);
renderer.setPixelRatio(PR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050608);
scene.fog = new THREE.Fog(0x050608, 40, 190);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
// viewport size; with ?debug&w=390&h=844 the game renders at a forced phone size for testing on desktop
const QS = new URLSearchParams(location.search);
const FORCE = DEBUG && QS.has('w') ? { w: +QS.get('w'), h: +QS.get('h') } : null;
const view = () => (FORCE ? FORCE : { w: window.innerWidth, h: window.innerHeight });
const isPortrait = () => { const v = view(); return v.w < v.h; };
function resize() {
  const { w, h } = view();
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w < h ? 62 : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------- lights ----------------
scene.add(new THREE.AmbientLight(0xffffff, 0.12));
scene.add(new THREE.HemisphereLight(0x33415a, 0x050506, 0.4));
const moon = new THREE.DirectionalLight(0x9fb4d6, 0.5);
moon.position.set(-40, 60, 50);
scene.add(moon);
function spot(p, t, i, angle = 0.5) {
  const l = new THREE.SpotLight(0xeef3ff, i, 0, angle, 0.55, 1.6);
  l.position.set(...p); l.target.position.set(...t);
  scene.add(l, l.target);
  return l;
}
spot([48, 10, 14], [50, 1, 0], 900, 0.6);
spot([10, 6, 12], [10, 0, 0], 400, 0.6);
spot([85, 7, 12], [85, 0, 0], 500, 0.6);
const carLight = new THREE.PointLight(0xe8eeff, 70, 18);
scene.add(carLight);
for (const x of [20, 70]) { const p = new THREE.PointLight(RED, 40, 22); p.position.set(x, 0.5, 6); scene.add(p); }

// ---------------- materials ----------------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .1, ...o });
const glow = (color) => { const m = new THREE.MeshBasicMaterial({ color }); m.toneMapped = false; return m; };
const M = {
  ground: std(0x0b0c0d, { roughness: .55 }), mark: std(0xc9ccd0, { roughness: .7 }), red: glow(0xff1a10), white: glow(0xffffff),
  plat: std(0x121316, { metalness: .3, roughness: .5 }), steel: std(0x5c6168, { metalness: .75, roughness: .4 }), dark: std(0x0c0d0f),
  pole: std(0x2a2621, { roughness: .9 }), tire: std(0x0f1012, { roughness: .85 }), rim: std(0x26282c, { metalness: .85, roughness: .3 }),
  paint: std(0xedeef0, { metalness: .15, roughness: .28, flatShading: true }), lower: std(0x141518, { metalness: .4, roughness: .45, flatShading: true }),
  glass: std(0x07090c, { metalness: .6, roughness: .05, side: THREE.DoubleSide }), caliper: std(0xd4241c, { roughness: .4 }),
  bronze: std(0xb08a5a, { metalness: .95, roughness: .25 }), port: std(0x0a0a0b, { roughness: .9 }),
};
const box = (w, h, d, m, x, y, z, parent = scene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o; };

// ---------------- the site ----------------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), M.ground);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
for (const z of [6.5, -6.5]) {
  box(LANE_END + 40, .05, .1, M.red, LANE_END / 2 - 10, .03, z);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(LANE_END + 40, 2), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .14, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.rotation.x = -Math.PI / 2; g.position.set(LANE_END / 2 - 10, .02, z); scene.add(g);
}
for (let x = -10; x < LANE_END; x += 5) box(2.2, .01, .12, M.mark, x, .015, 0);
// landing zone and the barrier at the end of the pad
for (const x of [CLEAR_X + 2, LANE_END - 4]) box(.15, .01, 12, M.mark, x, .016, 0);
box(.3, 1.2, 13, M.red, LANE_END + .5, .6, 0);
// lineup platform with red edges
box(20, .12, 8.4, M.plat, 49.6, .06, 0);
for (const z of [4.25, -4.25]) box(20, .05, .08, M.red, 49.6, .13, z);
function lineupCar(v) {
  const sh = new THREE.Shape();
  v.prof.forEach(([a, b], i) => (i ? sh.lineTo(a * v.L - v.L / 2, b * v.H) : sh.moveTo(a * v.L - v.L / 2, b * v.H)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: v.W - .1, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 3 });
  g.translate(0, 0, -(v.W - .1) / 2);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, std(v.col, { metalness: v.metal ?? .5, roughness: .28 })));
  box(.02, .025, v.W * .82, M.white, -v.L / 2 - .035, v.bar * v.H, 0, grp);
  const wh = v.name === 'Semi' ? [.13, .66, .84] : [.18, .8];
  for (const w of wh) for (const s of [1, -1]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(v.wr, v.wr, .27, 24), M.tire);
    t.rotation.x = Math.PI / 2; t.position.set(w * v.L - v.L / 2, v.wr, s * (v.W / 2 - .12)); grp.add(t);
  }
  grp.position.set(v.x, .12, 0); grp.rotation.y = Math.PI / 2;
  scene.add(grp);
  v.grp = grp; v.wob = 0; // wob: knock wobble when the Roadster hits it
}
LINEUP.forEach(lineupCar);
// light rigs with beams in the haze
const beamTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#fff'); gr.addColorStop(.35, '#555'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); return new THREE.CanvasTexture(c); })();
const beamM = new THREE.MeshBasicMaterial({ color: 0xcfe0ff, alphaMap: beamTex, transparent: true, opacity: .05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
function rig(x, z, h, aim) {
  for (const [a, b] of [[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]]) box(.07, h, .07, M.steel, x + a, h / 2, z + b);
  for (let y = .8; y < h; y += 1) box(1.45, .05, 1.45, M.steel, x, y, z);
  const top = new THREE.Vector3(x, h + .4, z), d = new THREE.Vector3(...aim).sub(top), len = d.length() * 1.1;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.clone().normalize());
  for (let i = 0; i < 6; i++) { const l = box(.3, .3, .3, M.white, x + (i - 2.5) * .45, h + .4, z); l.quaternion.copy(q); }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.6, len * .16, len, 32, 1, true), beamM);
  beam.position.copy(top.clone().add(d.normalize().multiplyScalar(len / 2))); beam.quaternion.copy(q); scene.add(beam);
}
rig(40, -16, 5, [48, 2, 0]); rig(62, -16, 5, [52, 2, 0]); rig(12, -18, 4, [5, 0, 0]); rig(92, -18, 4.5, [85, 1, 0]); rig(-10, -30, 3, [0, 40, -40]); rig(120, -34, 3, [100, 40, -50]);
// power poles and wires
const wire = [];
const poles = [-20, 15, 50, 85, 120];
for (const x of poles) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, 11.5, 10), M.pole); p.position.set(x, 5.75, -40); scene.add(p); box(.15, .15, 3.2, M.pole, x, 10.6, -40); }
for (let i = 0; i < poles.length - 1; i++) for (const [dy, dz] of [[10.6, -1.2], [10.6, 1.2], [9.4, 0]]) for (let k = 0; k < 24; k++) {
  const y = (t) => dy - 5.6 * t * (1 - t), x = (t) => poles[i] + (poles[i + 1] - poles[i]) * t;
  wire.push(x(k / 24), y(k / 24), -40 + dz, x((k + 1) / 24), y((k + 1) / 24), -40 + dz);
}
const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x8a8f96, transparent: true, opacity: .55 })));

// ---------------- the Roadster (same faceted, white over black body as the reel) ----------------
const PROF = {
  x: [2.22, 2.12, 1.9, 1.5, 1.05, 0.6, 0.15, -0.3, -0.8, -1.3, -1.75, -2.05, -2.22],
  yb: [.22, .17, .14, .13, .13, .13, .13, .13, .13, .14, .17, .24, .3],
  ys: [.58, .63, .66, .68, .68, .68, .69, .71, .74, .77, .8, .82, .82],
  yt: [.62, .68, .74, .8, .86, .99, 1.1, 1.13, 1.08, .98, .9, .86, .84],
  hw: [.8, .92, .98, 1, .98, .96, .96, .98, 1, 1, .98, .95, .9],
  tw: [.62, .74, .8, .78, .68, .52, .46, .48, .62, .8, .87, .87, .83],
};
const pf = (k, x) => { const xs = PROF.x, ys = PROF[k]; if (x >= xs[0]) return ys[0]; for (let i = 0; i < xs.length - 1; i++) if (x >= xs[i + 1]) return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]); return ys[ys.length - 1]; };
const WHEEL_X = [1.4, -1.4];
const arch = (x) => Math.max(...WHEEL_X.map((w) => Math.pow(Math.max(0, 1 - Math.abs(x - w) / .5), .55)));
function half(x) {
  const yb = pf('yb', x), ys = pf('ys', x), yt = pf('yt', x), hw = pf('hw', x), tw = pf('tw', x), a = arch(x);
  const hl = .9 - .24 * a, fl = Math.min(ys - .03, .36 + (ys - .36) * a);
  return [[0, yb], [hl - .05, yb], [hl, yb + .05], [hl, fl], [hw, fl + .005], [hw, ys], [hw - .06, ys + .045], [tw, Math.max(ys + .05, yt - .02)], [0, yt]];
}
function buildCar() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const XS = Array.from({ length: 48 }, (_, i) => 2.22 - 4.44 * i / 47);
  const rings = XS.map((x) => { const h = half(x), pts = h.map(([z, y]) => V(x, y, z)); for (let i = h.length - 2; i >= 1; i--) pts.push(V(x, h[i][1], -h[i][0])); return pts; });
  const white = [], black = [];
  const tri = (a, b, c) => {
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = Math.abs(a.z + b.z + c.z) / 3;
    const line = cx < -1.98 ? .74 : cx > 2 ? .3 : .44;
    const dark = cy < line || (cz < pf('hw', cx) - .03 && cy < pf('ys', cx) - .04 && cz > .2);
    (dark ? black : white).push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
  };
  for (let s = 0; s < rings.length - 1; s++) { const A = rings[s], B = rings[s + 1], n = A.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(A[i], B[i], B[j]); tri(A[i], B[j], A[j]); } }
  for (const [ri, flip] of [[0, false], [rings.length - 1, true]]) { const rg = rings[ri], c = rg.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / rg.length); for (let i = 0; i < rg.length; i++) { const j = (i + 1) % rg.length; flip ? tri(c, rg[j], rg[i]) : tri(c, rg[i], rg[j]); } }
  const mk = (p) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g; };
  const car = new THREE.Group(), body = new THREE.Group();
  body.add(new THREE.Mesh(mk(white), M.paint), new THREE.Mesh(mk(black), M.lower));
  const cp = [];
  const cr = XS.filter((x) => x <= 1.02 && x >= -1.32).map((x) => { const h = half(x), a = h[6], b = h[7], c = h[8], st = [a[0] + (b[0] - a[0]) * .35, a[1] + (b[1] - a[1]) * .35], k = 1.012; return [V(x, st[1] + .012, -st[0] * k), V(x, b[1] + .012, -b[0] * k), V(x, c[1] + .012, 0), V(x, b[1] + .012, b[0] * k), V(x, st[1] + .012, st[0] * k)]; });
  for (let s = 0; s < cr.length - 1; s++) for (let i = 0; i < 4; i++) { const a = cr[s][i], b = cr[s + 1][i], c = cr[s + 1][i + 1], d = cr[s][i + 1]; cp.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z); }
  // the canopy gets its own material so driver view can make just this car's glass see-through
  const canopy = new THREE.Mesh(mk(cp), M.glass.clone());
  body.add(canopy);
  // cabin, seen from the driver's seat: dash, screen, yoke, A-pillars, roof header
  const cabin = new THREE.Group();
  box(.34, .06, 1.5, M.lower, .66, .6, 0, cabin);
  const scr = box(.015, .1, .24, glow(0x163a57), .5, .67, .02, cabin); scr.rotation.z = .4;
  box(.016, .008, .2, glow(0x7fc6ff), .502, .69, .02, cabin).rotation.z = .4;
  const yoke = new THREE.Group(); yoke.position.set(.36, .63, .3); yoke.rotation.z = .4;
  box(.03, .05, .34, M.dark, 0, 0, 0, yoke); box(.03, .16, .05, M.dark, 0, .06, .16, yoke); box(.03, .16, .05, M.dark, 0, .06, -.16, yoke);
  box(.05, .06, .08, M.lower, .03, -.02, 0, yoke);
  cabin.add(yoke);
  const strut = (a, b, r = .025) => { const d = b.clone().sub(a); const m = new THREE.Mesh(new THREE.BoxGeometry(r, d.length(), r), M.dark); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); cabin.add(m); };
  for (const s of [1, -1]) strut(V(.98, .84, .62 * s), V(.18, 1.1, .47 * s), .045);
  box(.06, .04, .94, M.dark, .18, 1.1, 0, cabin);
  box(.05, .04, 1.24, M.dark, .98, .84, 0, cabin);
  car.add(cabin);
  const headbar = box(.03, .022, 1.62, M.white, 2.215, .55, 0, body);
  box(.03, .03, 1.74, M.red, -2.225, .8, 0, body);
  for (const z of [.22, -.22, .58, -.58]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(.06, .016, 10, 28), M.bronze); r.position.set(-2.235, .42, z); r.rotation.y = Math.PI / 2; body.add(r);
  }
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  car.add(body);
  const wheels = [];
  for (const x of WHEEL_X) for (const z of [.86, -.86]) {
    const w = new THREE.Group(); w.position.set(x, .37, z);
    const spin = new THREE.Group(); w.add(spin);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(.37, .37, .3, 32), M.tire); t.rotation.x = Math.PI / 2; spin.add(t);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .31, 32), M.rim); r.rotation.x = Math.PI / 2; spin.add(r);
    for (let i = 0; i < 7; i++) { const s = box(.24, .03, .02, M.steel, 0, 0, Math.sign(z) * .16, spin); s.position.x = Math.cos(i * 2 * Math.PI / 7) * .13; s.position.y = Math.sin(i * 2 * Math.PI / 7) * .13; s.rotation.z = i * 2 * Math.PI / 7; }
    box(.13, .11, .08, M.caliper, .13, .13, -Math.sign(z) * .03, w);
    car.add(w); wheels.push(spin);
  }
  // thrust cones out of the four rear ports: hidden until BOOST fires
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false });
  flameMat.toneMapped = false;
  const flames = [];
  for (const z of [.22, -.22, .58, -.58]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(.09, 1, 14, 1, true), flameMat);
    f.geometry.translate(0, -.5, 0); f.rotation.z = -Math.PI / 2; f.position.set(-2.25, .42, z); f.scale.set(1, 0, 1);
    car.add(f); flames.push(f);
  }
  return { car, wheels, flames, canopy, headbar };
}
const { car, wheels, flames, canopy, headbar } = buildCar();
scene.add(car);
// nozzles in car space: corner jets point down, rear jets point back
const NOZ = {
  corner: [[1.72, .16, .78], [1.72, .16, -.78], [-1.78, .16, .78], [-1.78, .16, -.78]],
  rear: [[-2.2, .42, .22], [-2.2, .42, -.22], [-2.18, .42, .58], [-2.18, .42, -.58]],
};

// ---------------- particles: billowing cold-gas plumes and ground clouds ----------------
function puffTex() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const n2 = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = x / N, py = y / N, r = Math.hypot(px - .5, py - .5) * 2;
    let n = 0, a = .5, f = 3.2; for (let o = 0; o < 4; o++) { n += a * n2(px * f, py * f); f *= 2.07; a *= .5; }
    const t = Math.min(1, Math.max(0, (1 - (r + (n - .5) * 1.1)) / .85)), al = t * t * (3 - 2 * t);
    const k = (y * N + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * (.82 + .36 * n) / 1.18); img.data[k + 3] = Math.round(255 * al);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; return tex;
}
const PMAX = 900;
const pPos = new Float32Array(PMAX * 3), pSize = new Float32Array(PMAX), pAlpha = new Float32Array(PMAX), pSeed = new Float32Array(PMAX), pTint = new Float32Array(PMAX * 3);
const parts = Array.from({ length: PMAX }, (_, i) => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: .3, s1: 2, a: .8, cloud: false, seed: (i * .618) % 1 }));
const pg = new THREE.BufferGeometry();
pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pg.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
pg.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1));
pg.setAttribute('seed', new THREE.BufferAttribute(pSeed, 1));
pg.setAttribute('tint', new THREE.BufferAttribute(pTint, 3));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: { scale: { value: 1 }, puff: { value: puffTex() } },
  vertexShader: `attribute float size; attribute float alpha; attribute float seed; attribute vec3 tint;
    varying float vA; varying float vS; varying vec3 vC; uniform float scale;
    void main(){ vA = alpha; vS = seed; vC = tint; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(1200.0, size * scale / max(0.1, -mv.z)); gl_Position = projectionMatrix * mv; }`,
  // the billow is baked into a texture once; each puff just samples it at a random rotation (cheap on phones)
  fragmentShader: `varying float vA; varying float vS; varying vec3 vC; uniform sampler2D puff;
    void main(){ float c = cos(vS * 6.283), s = sin(vS * 6.283); vec2 d = gl_PointCoord - 0.5;
      vec4 t = texture2D(puff, vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5);
      float shade = mix(0.8, 1.1, 1.0 - gl_PointCoord.y);
      gl_FragColor = vec4(vC * shade * t.r, t.a * vA); }`,
});
const points = new THREE.Points(pg, pMat);
points.frustumCulled = false;
scene.add(points);
let pNext = 0;
function emit(x, y, z, vx, vy, vz, life, s0, s1, a, cloud = false) {
  const p = parts[pNext]; pNext = (pNext + 1) % PMAX;
  Object.assign(p, { alive: true, x, y, z, vx, vy, vz, age: 0, life, s0, s1, a, cloud });
}
const rnd = () => Math.random() - 0.5;
function updateParticles(dt) {
  let n = 0;
  for (const p of parts) {
    if (!p.alive) continue;
    p.age += dt;
    if (p.age > p.life) { p.alive = false; continue; }
    const drag = p.cloud ? 1.2 : 2.4;
    p.vx -= p.vx * drag * dt; p.vz -= p.vz * drag * dt; p.vy -= p.vy * drag * dt;
    p.vy += (p.cloud ? .25 : .5) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < .25 && !p.cloud) {
      // a jet hitting the ground fans out and turns into a rolling cloud
      const sp = Math.hypot(p.vx, p.vy, p.vz) * .55 + 2;
      const ang = Math.random() * Math.PI * 2;
      p.vx = Math.cos(ang) * sp + p.vx * .3; p.vz = Math.sin(ang) * sp; p.vy = .4 + Math.random() * .8;
      p.y = .25; p.cloud = true; p.life = p.age + 2.5 + Math.random() * 2; p.s1 = 3.5 + Math.random() * 2.5;
    }
    const k = p.age / p.life;
    const red = Math.max(0, 1 - Math.abs(Math.abs(p.z) - 6.5) / 4) * Math.max(0, 1 - p.y / 4) * .3;
    pPos[n * 3] = p.x; pPos[n * 3 + 1] = p.y; pPos[n * 3 + 2] = p.z;
    pSize[n] = p.s0 + (p.s1 - p.s0) * Math.sqrt(k);
    pAlpha[n] = p.a * Math.pow(1 - k, 1.2);
    pSeed[n] = p.seed;
    const b = p.cloud ? .82 : .92;
    pTint[n * 3] = b * (1 - red) + red; pTint[n * 3 + 1] = b * (1 - red) + .3 * red; pTint[n * 3 + 2] = b * (1 - red) + .28 * red + (p.cloud ? 0 : .04);
    n++;
  }
  pg.setDrawRange(0, n);
  for (const a of ['position', 'size', 'alpha', 'seed', 'tint']) pg.getAttribute(a).needsUpdate = true;
  pMat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}

// ---------------- crash effects: sparks, flying body panels ----------------
const SMAX = 260;
const sPos = new Float32Array(SMAX * 3), sparks = Array.from({ length: SMAX }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1 }));
const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
const sMat = new THREE.PointsMaterial({ color: 0xffb35c, size: 5, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
sMat.toneMapped = false;
const sparkPts = new THREE.Points(sg, sMat); sparkPts.frustumCulled = false; scene.add(sparkPts);
let sNext = 0;
function sparkBurst(x, y, z, n, power = 9) {
  for (let i = 0; i < n; i++) {
    const p = sparks[sNext]; sNext = (sNext + 1) % SMAX;
    const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = power * (.4 + Math.random());
    Object.assign(p, { alive: true, x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 2, vz: Math.sin(a) * Math.cos(e) * sp, age: 0, life: .4 + Math.random() * .6 });
  }
}
const debris = Array.from({ length: 18 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(.15 + Math.random() * .45, .03, .12 + Math.random() * .35), i % 3 ? M.paint : i % 2 ? M.lower : M.glass);
  m.visible = false; m.castShadow = true; scene.add(m);
  return { m, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, on: false };
});
function shatter(x, y, power) {
  for (const d of debris) {
    d.on = true; d.m.visible = true;
    d.m.position.set(x + rnd() * 3, y + .5 + Math.random() * .6, rnd() * 1.6);
    Object.assign(d, { vx: rnd() * power + 2, vy: 3 + Math.random() * power * .8, vz: rnd() * power, wx: rnd() * 18, wy: rnd() * 18, wz: rnd() * 18 });
  }
}
function updateEffects(dt) {
  let n = 0;
  for (const p of sparks) {
    if (!p.alive) continue;
    p.age += dt; if (p.age > p.life) { p.alive = false; continue; }
    p.vy -= G * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0) { p.y = 0; p.vy *= -.3; p.vx *= .6; p.vz *= .6; }
    sPos[n * 3] = p.x; sPos[n * 3 + 1] = p.y; sPos[n * 3 + 2] = p.z; n++;
  }
  sg.setDrawRange(0, n); sg.getAttribute('position').needsUpdate = true;
  for (const d of debris) {
    if (!d.on) continue;
    d.vy -= G * dt;
    d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
    d.m.rotation.x += d.wx * dt; d.m.rotation.y += d.wy * dt; d.m.rotation.z += d.wz * dt;
    if (d.m.position.y < .03) { d.m.position.y = .03; d.vy *= -.25; d.vx *= .55; d.vz *= .55; d.wx *= .5; d.wy *= .5; d.wz *= .5; }
  }
  for (const v of LINEUP) { v.wob *= Math.exp(-dt * 3); v.grp.rotation.z = Math.sin(performance.now() / 45) * v.wob; }
}

// drones and a little haze in the sky
const dg = new THREE.BufferGeometry();
const dp = []; for (let i = 0; i < 40; i++) dp.push(-20 + Math.random() * 160, 30 + Math.random() * 25, -60 + Math.random() * 40);
dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
scene.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false })));

// ---------------- level 2 world: the curved ramp wall (same shape as the reel, from Tesla's footage) ----------------
const RX = -70; // the ramp foot sits at x = RX; the wall rises toward -x and leans back over the top
const RAMP = { R1: 9, top: 16, R2: 7, phiMax: 40 * Math.PI / 180, apron: 14, half: 2.5 };
const S1 = RAMP.apron, S2 = S1 + RAMP.R1 * Math.PI / 2, S3 = S2 + (RAMP.top - RAMP.R1), S4 = S3 + RAMP.R2 * RAMP.phiMax;
const HANG_S = S4 - 1.6;
// point, travel tangent and surface normal (toward the car) at arc length s, in world space
function rampAt(s) {
  const V = (x, y) => new THREE.Vector2(x, y);
  if (s < S1) return { p: V(RX + RAMP.apron - s, 0), t: V(-1, 0), n: V(0, 1) };
  if (s < S2) { const th = (s - S1) / RAMP.R1; return { p: V(RX - RAMP.R1 * Math.sin(th), RAMP.R1 - RAMP.R1 * Math.cos(th)), t: V(-Math.cos(th), Math.sin(th)), n: V(Math.sin(th), Math.cos(th)) }; }
  if (s < S3) return { p: V(RX - RAMP.R1, RAMP.R1 + (s - S2)), t: V(0, 1), n: V(1, 0) };
  const ph = Math.min(RAMP.phiMax, (s - S3) / RAMP.R2);
  return { p: V(RX - RAMP.R1 + RAMP.R2 - RAMP.R2 * Math.cos(ph), RAMP.top + RAMP.R2 * Math.sin(ph)), t: V(Math.sin(ph), Math.cos(ph)), n: V(Math.cos(ph), -Math.sin(ph)) };
}
// x of the wall's driving surface at height y (to catch a car that drifts back into it)
function wallX(y) {
  if (y < RAMP.R1) { const c = (RAMP.R1 - y) / RAMP.R1; return RX - RAMP.R1 * Math.sqrt(Math.max(0, 1 - c * c)); }
  if (y < RAMP.top) return RX - RAMP.R1;
  const ph = Math.asin(Math.min(1, (y - RAMP.top) / RAMP.R2));
  return ph > RAMP.phiMax ? -Infinity : RX - RAMP.R1 + RAMP.R2 - RAMP.R2 * Math.cos(ph);
}
(function buildRamp() {
  const N = 200, hw = RAMP.half, th = .6, pos = [], back = [];
  const at = (r, z, off) => new THREE.Vector3(r.p.x + r.n.x * off, r.p.y + r.n.y * off, z);
  const S = S4;
  const pts = Array.from({ length: N + 1 }, (_, i) => rampAt(i / N * S));
  const q = (arr, a, b, c, d) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  for (let i = 0; i < N; i++) {
    const A = pts[i], B = pts[i + 1];
    q(pos, at(A, -hw, 0), at(B, -hw, 0), at(B, hw, 0), at(A, hw, 0));
    q(back, at(A, -hw, -th), at(A, hw, -th), at(B, hw, -th), at(B, -hw, -th));
    q(back, at(A, hw, -th), at(A, hw, 0), at(B, hw, 0), at(B, hw, -th));
    q(back, at(A, -hw, -th), at(B, -hw, -th), at(B, -hw, 0), at(A, -hw, 0));
  }
  const mk = (p) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g; };
  scene.add(new THREE.Mesh(mk(pos), std(0x7a7e83, { roughness: .92, side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(mk(back), std(0x4a4d52, { roughness: .9 })));
  const tube = (z, off, r, m) => scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.filter((_, i) => i % 4 === 0).map((p) => at(p, z, off))), 160, r, 6), m));
  tube(hw - .06, .05, .05, M.red); tube(-hw + .06, .05, .05, M.red); tube(.85, .01, .035, M.mark); tube(-.85, .01, .035, M.mark);
  // lattice tower behind the wall
  const beam = (a, b, r) => { const d = b.clone().sub(a); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), M.steel); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); scene.add(m); };
  const TX = [RX - 11.8, RX - 14.6], TZ = [-2.9, 2.9], TH = 22.5, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const x of TX) for (const z of TZ) beam(V3(x, 0, z), V3(x, TH, z), .16);
  for (let y = 1.5; y < TH; y += 2.4) {
    for (const z of TZ) { beam(V3(TX[0], y, z), V3(TX[1], y, z), .06); beam(V3(TX[0], y, z), V3(TX[1], y + 2.4, z), .04); if (y > 6 && Number.isFinite(wallX(y))) beam(V3(TX[0], y, z), V3(Math.min(RX - 9.65, wallX(y) - .6), y, z * .8), .06); }
    for (const x of TX) { beam(V3(x, y, TZ[0]), V3(x, y, TZ[1]), .06); beam(V3(x, y, TZ[0]), V3(x, y + 2.4, TZ[1]), .04); }
  }
  spot([RX + 24, 4.4, 12], [RX - 6, 12, 0], 900, .4);
  spot([RX + 10, 4.4, 14], [RX - 8, 6, 0], 500, .5);
  const p = new THREE.PointLight(RED, 30, 14); p.position.set(RX - 9, 1.2, 3); scene.add(p);
  rig(RX + 20, -14, 4.5, [RX - 6, 12, 0]); rig(RX + 32, 10, 4, [RX + 4, 0, 0]);
  for (let x = RX + 2; x < RX + 40; x += 5) box(2.2, .01, .12, M.mark, x, .015, 0);
})();

// ---------------- ghost car (your best run, stored on this device) ----------------
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: .32, depthWrite: false });
const ghostBuilt = buildCar(); ghostBuilt.flames.forEach((f) => (f.visible = false));
const ghost = ghostBuilt.car;
ghost.traverse((o) => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
ghost.visible = false;
scene.add(ghost);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: no saving, game still works */ } },
};

// ---------------- sound: everything is synthesized with Web Audio, no files ----------------
const sfx = (() => {
  let ctx = null, master, jetGain, roadGain, fanGain, fanOsc, noise;
  let muted = store.get('rs-muted') === true;
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : .8; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (filters, gain) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; let n = s; for (const f of filters) { n.connect(f); n = f; } n.connect(gain); gain.connect(master); s.start(); };
    // cold-gas hiss: band of noise, rolled off on top so it stays soft
    jetGain = ctx.createGain(); jetGain.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = .5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    loop([bp, lp], jetGain);
    // tyre and air rumble that rises with speed
    roadGain = ctx.createGain(); roadGain.gain.value = 0;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 160;
    loop([lp2], roadGain);
    // suction fan whine for the wall climb
    fanGain = ctx.createGain(); fanGain.gain.value = 0;
    fanOsc = ctx.createOscillator(); fanOsc.type = 'sawtooth'; fanOsc.frequency.value = 300;
    const lp3 = ctx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 900;
    fanOsc.connect(lp3); lp3.connect(fanGain); fanGain.connect(master); fanOsc.start();
  }
  const env = (node, t0, a, peak, dur) => { node.gain.setValueAtTime(0, t0); node.gain.linearRampToValueAtTime(peak, t0 + a); node.gain.exponentialRampToValueAtTime(.0001, t0 + dur); };
  function burst(dur, freq, type = 'lowpass', peak = .6, q = .7, sweepTo = null) {
    if (!ctx) return; const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noise; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); env(g, t, .01, peak, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + .05);
  }
  function tone(freq, dur, peak = .4, type = 'sine', toFreq = null, delay = 0) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    const g = ctx.createGain(); env(g, t, .005, peak, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .05);
  }
  return {
    init,
    get muted() { return muted; },
    toggle() { muted = !muted; store.set('rs-muted', muted); if (master) master.gain.setTargetAtTime(muted ? 0 : .8, ctx.currentTime, .05); return muted; },
    update(jet, speed, fan) {
      if (!ctx) return; const t = ctx.currentTime;
      jetGain.gain.setTargetAtTime(Math.min(.55, jet), t, .06);
      roadGain.gain.setTargetAtTime(Math.min(.35, speed / 40), t, .1);
      fanGain.gain.setTargetAtTime(fan * .06, t, .15); fanOsc.frequency.setTargetAtTime(260 + fan * 120, t, .2);
    },
    crash() { burst(.9, 2400, 'lowpass', .9, .7, 300); tone(55, .5, .9, 'sine', 32); tone(900, .22, .12, 'square', 600); tone(1340, .18, .1, 'square', 900, .05); burst(.25, 5000, 'highpass', .25); },
    thump(k = 1) { tone(80, .28, .55 * k, 'sine', 40); burst(.18, 400, 'lowpass', .25 * k); },
    whoosh() { burst(.5, 400, 'bandpass', .35, 1.2, 2200); },
    clang() { tone(420, .3, .25, 'triangle', 300); burst(.12, 1800, 'bandpass', .2, 2); },
    ding() { tone(880, .5, .25); tone(1320, .6, .18, 'sine', null, .08); },
    click() { tone(1600, .05, .12, 'square'); },
  };
})();
$('mute').addEventListener('click', (e) => { e.stopPropagation(); $('mute').textContent = sfx.toggle() ? 'Sound off' : 'Sound on'; });
$('mute').textContent = sfx.muted ? 'Sound off' : 'Sound on';

// ---------------- control icons: each button shows what it does (and the key, on desktop) ----------------
// side view of the Roadster, nose to the right, about 38 x 12 units
const CAR_SVG = '<path d="M4 18 L7 14 L16 12.5 L22 9.5 L31 9.5 L37 12.5 L41 14 L41 18 Z" fill="#edeef0"/><path d="M17 12.5 L22.5 10 L30.5 10 L35 12.5 Z" fill="#0b0d10"/><rect x="4" y="16.4" width="37" height="2.2" fill="#2a2c31"/><rect x="3.2" y="14.5" width="1.7" height="1.5" fill="#ff2a1f"/><rect x="40.4" y="15" width="1.4" height="1" fill="#fff"/><circle cx="11" cy="18.8" r="2.7" fill="#0d0d0f" stroke="#5a5e66" stroke-width=".9"/><circle cx="34" cy="18.8" r="2.7" fill="#0d0d0f" stroke="#5a5e66" stroke-width=".9"/>';
const ICE = '#bfe2ff';
const arrowArc = (d, head) => `<path d="${d}" fill="none" stroke="#ff3b2f" stroke-width="2.4" stroke-linecap="round"/><path d="${head}" fill="#ff3b2f"/>`;
const ICONS = {
  // car hovering on two jets pushing down into a cloud
  lift: `<g transform="translate(9 0)">${CAR_SVG}</g><path d="M18 22 L14.5 32 L23.5 32 Z M41 22 L37.5 32 L46.5 32 Z" fill="${ICE}" opacity=".85"/><g fill="#d9dde2" opacity=".9"><ellipse cx="19" cy="34.5" rx="7" ry="3"/><ellipse cx="42" cy="34.5" rx="7" ry="3"/><ellipse cx="30.5" cy="35.5" rx="8" ry="2.6"/></g>`,
  // rear jets firing backwards, speed lines
  boost: `<g transform="translate(17 6)">${CAR_SVG}</g><path d="M20 20 L4 17.5 L4 23.5 Z M20 23 L7 23 L7 26.5 Z" fill="${ICE}" opacity=".9"/><path d="M2 12 H12 M5 30 H15" stroke="#7d828a" stroke-width="1.6" stroke-linecap="round"/>`,
  // barrel roll: the car inside a spin arrow
  roll: `<g transform="translate(9.5 5)">${CAR_SVG}</g>${arrowArc('M8 30 A 24 15 0 1 0 14 7', 'M10 3 L18 6.5 L11.5 11.5 Z')}`,
  // flip upright: car on its roof with a turn-over arrow
  flip: `<g transform="translate(9.5 35) scale(1 -1)">${CAR_SVG}</g>${arrowArc('M54 26 C 62 14, 50 3, 38 5', 'M40 1 L33 5.5 L40.5 9.5 Z')}`,
  // face front: the car turning its nose around (mirrored car plus a U-turn arrow)
  turn: `<g transform="translate(54.5 8) scale(-1 1)">${CAR_SVG}</g>${arrowArc('M14 33 C 24 39, 44 39, 52 31', 'M55 26.5 L54.5 35 L47 32 Z')}`,
};
const iconSvg = (k) => `<svg class="ico" viewBox="0 0 64 40" aria-hidden="true">${ICONS[k]}</svg>`;
const KEYS = { lift: ['SPACE', 'wide'], boost: ['→', ''], roll: ['R', ''], flip: ['R', ''], turn: ['E', ''] };
function paintButton(id, ico, name, hint) {
  const [k, cls] = KEYS[ico];
  $(id).innerHTML = `${iconSvg(ico)}<span class="nm">${name}</span>${DESK ? `<kbd class="kc ${cls}">${k}</kbd>` : `<small>${hint}</small>`}`;
}
document.querySelectorAll('.how b[data-ico]').forEach((b) => b.insertAdjacentHTML('afterbegin', iconSvg(b.dataset.ico)));
// ---------------- input ----------------
const input = { lift: false, boost: false, rollQueued: false, turnQueued: false, any: false };
function hold(el, key) {
  const on = (e) => { e.preventDefault(); input[key] = true; input.any = true; el.classList.add('on'); };
  const off = (e) => { e.preventDefault(); input[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
hold($('bLift'), 'lift'); hold($('bBoost'), 'boost');
const DESK = matchMedia('(hover: hover) and (pointer: fine)').matches;
if (DESK) document.body.classList.add('desk');
$('bTurn').addEventListener('pointerdown', (e) => { e.preventDefault(); input.turnQueued = true; input.any = true; $('bTurn').classList.add('on'); setTimeout(() => $('bTurn').classList.remove('on'), 160); });
$('bRoll').addEventListener('pointerdown', (e) => { e.preventDefault(); input.rollQueued = true; input.any = true; $('bRoll').classList.add('on'); setTimeout(() => $('bRoll').classList.remove('on'), 160); });
const keys = { Space: 'lift', ArrowUp: 'lift', KeyW: 'lift', ArrowRight: 'boost', KeyD: 'boost', ShiftLeft: 'boost' };
window.addEventListener('keydown', (e) => {
  if (keys[e.code]) { input[keys[e.code]] = true; input.any = true; e.preventDefault(); }
  if (e.code === 'KeyR' || e.code === 'ArrowDown') { input.rollQueued = true; input.any = true; }
  if (e.code === 'KeyE' || e.code === 'KeyT') { input.turnQueued = true; input.any = true; }
  if (e.code === 'Digit3' && state.phase !== 'play') start(3);
  if (e.code === 'Enter' && state.phase !== 'play') start(state.level || 1);
  if (e.code === 'Digit1' && state.phase !== 'play') start(1);
  if (e.code === 'Digit2' && state.phase !== 'play') start(2);
});
window.addEventListener('keyup', (e) => { if (keys[e.code]) input[keys[e.code]] = false; });
function labelButtons(level) {
  paintButton('bRoll', level === 2 ? 'flip' : 'roll', level === 2 ? 'FLIP' : 'ROLL', level === 2 ? 'UPRIGHT' : 'STYLE');
  paintButton('bTurn', 'turn', 'ROLL', 'FACE FRONT');
  paintButton('bLift', 'lift', 'LIFT', 'HOLD');
  paintButton('bBoost', 'boost', 'BOOST', 'HOLD');
  $('bTurn').style.display = level === 2 ? 'flex' : 'none';
  $('ctrl').classList.toggle('four', level === 2);
}

// ---------------- game state ----------------
const LEVEL_NAME = { 1: 'The Kickflip', 2: 'The Ramp', 3: 'Endless' };
let state;
const V2 = (x, y) => new THREE.Vector2(x, y);
// 2D orientation used by level 2: up vector angle a; the frame is mirrored (forward = up rotated +90), as when hanging off the wall
// m = +1 mirrored (as when hanging off the wall, nose pointing at the wall once upright), m = -1 normal (nose pointing away)
const qFromUp = (a, m = 1) => { const u = new THREE.Vector3(Math.cos(a), Math.sin(a), 0), f = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(m), z = new THREE.Vector3().crossVectors(f, u); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, u, z)); };
function reset(level) {
  for (const p of parts) p.alive = false;
  for (const d of debris) { d.on = false; d.m.visible = false; }
  for (const p of sparks) p.alive = false;
  state = { level, phase: 'play', t: 0, x: 0, y: 0, vx: 0, vy: 0, roll: 0, rollT: -1, rolls: 0, rollsBank: 0, air: AIR0, maxH: 0, ground: true, cleared: false, landed: null, wheel: 0, q: new THREE.Quaternion(), rec: [], recAcc: 0, cr: null, jet: 0 };
  if (level === 2) {
    const r = rampAt(0);
    Object.assign(state, { stage: 'climb', s: 0, hangT: 0, a: Math.PI / 2, m: 1, flipT: -1, flipFrom: 0, flipped: false, releaseT: 0, trollT: -1 });
    state.x = r.p.x; state.y = r.p.y;
  }
  if (level === 3) { endlessReset(); state.x = XE; }
  const g = store.get(`rs-ghost-${level}`);
  state.ghost = g && g.path && g.path.length ? g : null;
  ghost.visible = false;
  $('best').textContent = g ? `Best ${g.score.toLocaleString('en-IN')}${state.ghost ? ' · ghost on' : ''}` : 'No best yet';
}
function toast(text, ms = 1100) {
  const el = $('toast'); el.textContent = text; el.style.opacity = 1;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.style.opacity = 0), ms);
}
function start(level) {
  sfx.init(); sfx.click();
  reset(level);
  labelButtons(level);
  $('start').classList.add('hide'); $('end').classList.add('hide');
  $('credits').classList.add('hide'); $('card').classList.remove('open');
  $('hud').style.display = 'block'; $('ctrl').style.display = 'grid';
  toast(level === 1 ? 'Jump all five. Land it soft.' : level === 2 ? 'Climb the wall. Tap LIFT to let go.' : 'How far can you go? Grab the blue air cans.', 1800);
}
$('play').addEventListener('click', () => start(1));
$('play2').addEventListener('click', () => start(2));
$('again').addEventListener('click', () => start(state.level));
$('play3').addEventListener('click', () => start(3));
document.querySelectorAll('.pickl').forEach((b) => b.addEventListener('click', () => start(+b.dataset.l)));
$('share').addEventListener('click', shareCard);
// credits: the avatar opens a small contact card; tapping anywhere else closes it
$('me').addEventListener('click', (e) => { e.stopPropagation(); const o = $('card').classList.toggle('open'); $('me').setAttribute('aria-expanded', o); });
$('card').addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { $('card').classList.remove('open'); $('me').setAttribute('aria-expanded', false); });
function refreshBests() {
  for (const l of [1, 2, 3]) { const g = store.get(`rs-ghost-${l}`); if (g) $(`best${l}`).textContent = `Your best ${g.score.toLocaleString('en-IN')}`; }
}
refreshBests();

let lastResult = null;
function finish(kind, title, scoreLines = null, score = 0) {
  if (state.phase !== 'play') return;
  state.phase = 'end';
  const s = state;
  let newBest = false;
  const scored = kind === 'ok' || s.level === 3;
  if (scored) {
    const prev = store.get(`rs-ghost-${s.level}`);
    if (!prev || score > prev.score) { store.set(`rs-ghost-${s.level}`, { score, path: s.rec }); newBest = true; }
    if (kind === 'ok') sfx.ding();
  }
  const lines = scored ? scoreLines : [['Distance', `${Math.round(Math.abs(s.x - (s.level === 2 ? RX : 0)))} m`], ['Air used', `${Math.round(AIR0 - s.air)} kg`]];
  lastResult = { kind, title, score, lines, level: s.level, newBest, stats: cardStats(s, kind) };
  $('eKick').textContent = `${LEVEL_NAME[s.level]} · ${newBest ? 'New best' : kind === 'ok' ? 'Stuck the landing' : s.level === 3 ? 'Run over' : 'Crashed'}`;
  $('eTitle').textContent = title;
  $('eScore').textContent = score.toLocaleString('en-IN');
  $('eLines').innerHTML = lines.map(([a, b]) => `${a}<span>${b}</span>`).join('<br>');
  document.querySelectorAll('.pickl').forEach((b) => b.classList.toggle('cur', +b.dataset.l === s.level));
  refreshBests();
  // the card is the result screen: draw it while the crash or landing plays out, then show it
  lastResult.blob = null; $('cardImg').removeAttribute('src'); $('cardWait').style.display = 'flex';
  const cardReady = makeCard().then((b) => { lastResult.blob = b; $('cardImg').src = URL.createObjectURL(b); $('cardWait').style.display = 'none'; });
  setTimeout(() => { $('end').classList.remove('hide'); $('ctrl').style.display = 'none'; $('hud').style.display = 'none'; $('credits').classList.remove('hide'); }, kind === 'ok' ? 1300 : 2600);
  return cardReady;
}

// a crash turns the car into a tumbling rigid body: hit-stop slow motion, sparks, panels, the tanks venting, shake and flash
function crash(title, hit) {
  const s = state;
  if (s.phase !== 'play') return;
  const impact = Math.hypot(s.vx, s.vy);
  s.cr = { t: 0, q0: s.q.clone(), rx: 0, rz: 0, wx: (Math.random() < .5 ? -1 : 1) * (5 + impact * .5), wz: (hit ? -1 : 1) * (3 + Math.random() * 4), shake: 1 };
  if (hit) { s.vx = -Math.sign(s.vx || 1) * Math.abs(s.vx) * .35; s.vy = Math.max(s.vy, 0) + 4.5; if (hit.wob !== undefined) hit.wob = .09; }
  else { s.vy = Math.min(9, Math.abs(s.vy) * .45 + 2.5); s.vx *= .7; }
  s.y = Math.max(s.y, .6);
  sparkBurst(s.x, Math.max(.3, s.y - .3), 0, 120, 7 + impact * .4);
  shatter(s.x, s.y, 5 + impact * .35);
  for (let i = 0; i < 60; i++) emit(s.x + rnd() * 2, s.y + rnd(), rnd() * 1.5, rnd() * 9, Math.random() * 5, rnd() * 9, 2.5 + Math.random() * 2, 1, 4.5 + Math.random() * 2, .7, true);
  const f = $('flash'); f.style.transition = 'none'; f.style.opacity = .6; requestAnimationFrame(() => { f.style.transition = 'opacity .9s'; f.style.opacity = 0; });
  navigator.vibrate?.([70, 40, 160]);
  sfx.crash();
  finish('crash', title, s.level === 3 ? eLines(s) : null, s.level === 3 ? eScore(s) : 0);
}
const qx = new THREE.Quaternion(), qz = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
function crashStep(dt) {
  const s = state, c = s.cr;
  c.t += dt;
  s.vy -= G * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;
  c.rx += c.wx * dt; c.rz += c.wz * dt;
  if (s.y < .55 && s.vy < 0) {
    if (s.vy < -2.5) { sparkBurst(s.x, .2, 0, 40, 5 + Math.abs(s.vy) * .4); sfx.thump(.6); }
    s.y = .55; s.vy = Math.abs(s.vy) < 1.5 ? 0 : -s.vy * .38;
    s.vx *= .6; c.wx *= .55; c.wz *= .55;
  }
  if (s.y <= .56) { s.vx *= Math.exp(-dt * 2.5); c.wx *= Math.exp(-dt * 3); c.wz *= Math.exp(-dt * 3); }
  c.shake *= Math.exp(-dt * 2.8);
  s.q.copy(c.q0).multiply(qx.setFromAxisAngle(X, c.rx)).multiply(qz.setFromAxisAngle(Z, c.rz));
}

// shared: jets, emitting plumes, recording the run for the ghost
const NOZ_DIR = { corner: new THREE.Vector3(0, -1, 0), rear: new THREE.Vector3(-1, 0, 0) };
function jets(dt, lifting, boosting) {
  const s = state;
  s.jet = (lifting ? .45 : 0) + (boosting ? .4 : 0);
  s.boosting = boosting;
  s.emitAcc = (s.emitAcc || 0) + dt;
  if (s.emitAcc < 1 / 45) return; // about 45 puffs per second per nozzle
  s.emitAcc = 0;
  const emitFrom = (list, dirLocal, speed) => {
    const d = dirLocal.clone().applyQuaternion(s.q);
    for (const p of list) {
      const o = new THREE.Vector3(...p).applyQuaternion(s.q);
      emit(s.x + o.x, s.y + o.y, o.z, s.vx * .25 + d.x * speed + rnd() * 1.6, s.vy * .2 + d.y * speed + rnd() * 1.6, d.z * speed + rnd() * 1.6, .9 + Math.random() * .4, .25, 2.6, .78);
    }
  };
  if (lifting) emitFrom(NOZ.corner, NOZ_DIR.corner, 15);
  if (boosting) { emitFrom(NOZ.rear, NOZ_DIR.rear, 18); emitFrom(NOZ.rear, NOZ_DIR.rear, 12); }
}
function record(dt) {
  const s = state;
  s.recAcc += dt;
  if (s.recAcc < 1 / 30) return;
  s.recAcc = 0;
  const r = (v) => Math.round(v * 1000) / 1000;
  if (s.rec.length < 30 * 60) s.rec.push([r(s.x), r(s.y), r(s.q.x), r(s.q.y), r(s.q.z), r(s.q.w)]);
}

// ---------------- level 1: the kickflip ----------------
function step1(dt) {
  const s = state;
  if (input.rollQueued) { input.rollQueued = false; if (!s.ground && s.rollT < 0 && s.y > 1.2) { s.rollT = 0; toast('Barrel roll', 700); sfx.whoosh(); } }
  if (s.rollT >= 0) { s.rollT += dt; s.roll = 2 * Math.PI * Math.min(1, s.rollT / ROLL_TIME); if (s.rollT >= ROLL_TIME) { s.rollT = -1; s.roll = 0; s.rolls++; } }
  const upY = Math.cos(s.roll);
  let ax = 0, ay = -G;
  const lifting = input.lift && s.air > 0, boosting = input.boost && s.air > 0;
  if (lifting) { ay += LIFT_ACC * upY; s.air -= LIFT_BURN * dt; }
  if (boosting) { ax += BOOST_ACC; s.air -= BOOST_BURN * dt; }
  s.air = Math.max(0, s.air);
  if (s.ground) {
    // auto-cruise only before the final landing; it never fights a boost, and only eases back down afterwards
    if (!s.landed && !boosting) ax += (CRUISE - s.vx) * (s.vx > CRUISE ? .35 : 1.4);
    if (ay <= 0) { ay = 0; s.vy = 0; }
  }
  ax -= s.vx * s.vx * 0.0025;
  s.vx += ax * dt; s.vy += ay * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;
  if (s.y > .02) s.ground = false;
  s.maxH = Math.max(s.maxH, s.y);
  s.wheel -= s.vx * dt / .37;
  s.q.setFromAxisAngle(X, s.roll);

  const low = s.y + Math.min(0, upY) * CAR_H - Math.abs(Math.sin(s.roll)) * CAR_HALF_W;
  for (const v of LINEUP) if (Math.abs(s.x - v.x) < v.W / 2 + CAR_LEN / 2 - .3 && low < v.H + .12) { crash(`Hit the ${v.name}`, v); return; }
  if (!s.cleared && s.x > CLEAR_X) { s.cleared = true; toast('Cleared all five', 900); sfx.ding(); }

  if (s.y <= 0 && !s.ground) {
    const imp = -s.vy;
    s.y = 0; s.vy = 0; s.ground = true;
    if (s.rollT >= 0 || upY < .8) { s.vy = -imp; crash(s.rollT >= 0 ? 'Landed mid-roll' : 'Landed on the roof'); return; }
    s.rollsBank = s.rolls;
    if (imp > 7.5) { s.vy = -imp; crash(`Slammed down at ${Math.round(imp * 2.237)} mph`); return; }
    sfx.thump(Math.min(1, imp / 5));
    if (s.cleared) { s.landed = imp < 3.5 ? 'soft' : 'hard'; toast(s.landed === 'soft' ? 'Soft landing' : 'Hard landing', 900); }
  }
  if (s.landed && s.ground) {
    s.vx = Math.max(0, s.vx - 11 * dt);
    if (s.vx < .3) {
      const cleared = 1000, soft = s.landed === 'soft' ? 600 : 200, air = Math.round(s.air * 4), style = s.rollsBank * 400, height = Math.round(s.maxH * 3.281) * 5;
      finish('ok', s.landed === 'soft' ? 'Stuck it' : 'Landed, barely', [['Cleared all five cars', cleared], [s.landed === 'soft' ? 'Soft landing' : 'Hard landing', soft], [`Air left ${Math.round(s.air)} kg`, air], [`Barrel rolls x${s.rollsBank}`, style], [`Peak ${Math.round(s.maxH * 3.281)} ft`, height]], cleared + soft + air + style + height);
    }
  }
  if (s.x > LANE_END - 2) crash(s.ground ? 'Ran out of runway' : 'Flew off the pad', null);
  if (s.air <= 0 && !s.ground && !s.airToast) { s.airToast = true; toast('Out of air', 900); }
  jets(dt, lifting, boosting);
}

// ---------------- level 2: the ramp ----------------
const FLIP_TIME = .8;
function step2(dt) {
  const s = state;
  if (s.stage === 'climb') {
    // suction fans hold it to the wall while it drives up, past vertical
    s.t2 = (s.t2 || 0) + dt;
    s.s = HANG_S * Math.min(1, 1 - Math.pow(1 - Math.min(1, s.t2 / 5.2), 2.2));
    const r = rampAt(s.s);
    s.x = r.p.x; s.y = r.p.y; s.a = Math.atan2(r.n.y, r.n.x);
    s.q.copy(qFromUp(s.a)); s.wheel -= 4 * dt;
    s.fan = 1; s.vx = 0; s.vy = 0;
    if (s.t2 >= 5.2) { s.stage = 'hang'; toast(DESK ? 'Hanging past vertical. Space to let go.' : 'Hanging past vertical. Tap LIFT to let go.', 2400); input.any = false; }
    return;
  }
  if (s.stage === 'hang') {
    s.hangT += dt;
    if (input.any || s.hangT > 4) {
      // let go: drop off the wall, pushed clear along the surface normal
      const r = rampAt(s.s);
      s.vx = r.n.x * 3 + 1.5; s.vy = r.n.y * 3; s.stage = 'fly'; s.fan = 0; s.releaseT = 0; s.ground = false;
      sfx.clang(); toast(DESK ? 'R to flip. Space while flipping pushes you off the wall' : 'FLIP, and LIFT while flipping pushes you off the wall', 2200);
    }
    return;
  }
  s.releaseT += dt;
  // flip: rotate the up vector to point at the sky
  if (input.rollQueued) { input.rollQueued = false; if (s.flipT < 0 && s.trollT < 0 && Math.abs(angDiff(s.a, Math.PI / 2)) > .1) { s.flipT = 0; s.flipFrom = s.a; sfx.whoosh(); if (!s.flipped && s.releaseT < 1.5) s.quickFlip = true; } }
  if (s.flipT >= 0) {
    s.flipT += dt; const k = Math.min(1, s.flipT / FLIP_TIME), e = k * k * (3 - 2 * k);
    s.a = s.flipFrom + angDiff(Math.PI / 2, s.flipFrom) * e;
    if (k >= 1) { s.flipT = -1; s.flipped = true; }
  }
  // roll: a 180 degree barrel roll about the nose. Afterwards the car faces forward (away from the wall), so BOOST pushes it clear
  if (input.turnQueued) { input.turnQueued = false; if (s.trollT < 0) { s.trollT = 0; sfx.whoosh(); } }
  s.q.copy(qFromUp(s.a, s.m));
  if (s.trollT >= 0) {
    s.trollT += dt; const k = Math.min(1, s.trollT / .6), e = k * k * (3 - 2 * k);
    if (k >= 1) { s.trollT = -1; s.a += Math.PI; s.m = -s.m; s.q.copy(qFromUp(s.a, s.m)); toast(s.m < 0 ? 'Facing forward' : 'Facing the wall', 700); }
    else s.q.multiply(qx.setFromAxisAngle(X, Math.PI * e));
  }
  const lifting = input.lift && s.air > 0, boosting = input.boost && s.air > 0;
  let ax = 0, ay = -G;
  const u3 = new THREE.Vector3(0, 1, 0).applyQuaternion(s.q), f3 = new THREE.Vector3(1, 0, 0).applyQuaternion(s.q);
  const up = V2(u3.x, u3.y), fwd = V2(f3.x, f3.y);
  if (lifting) { ax += LIFT_ACC * up.x; ay += LIFT_ACC * up.y; s.air -= LIFT_BURN * dt; }
  if (boosting) { ax += BOOST_ACC * fwd.x; ay += BOOST_ACC * fwd.y; s.air -= BOOST_BURN * dt; }
  s.air = Math.max(0, s.air);
  if (s.ground) {
    s.vx *= Math.exp(-dt * 3);
    if (ay <= 0) { ay = 0; s.vy = 0; }
  }
  s.vx += ax * dt; s.vy += ay * dt; s.vx -= s.vx * .05 * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;
  if (s.y > .02) s.ground = false;
  // the car's centre must stay clear of the wall
  const cx = s.x + up.x * .6, cy = s.y + up.y * .6;
  if (cy > .5 && cx < wallX(cy) + .35 && cx > RX - 12) { crash('Hit the wall', { wob: undefined }); return; }
  if (s.y <= 0 && !s.ground) {
    const imp = -s.vy, upright = u3.y > Math.cos(.35) && s.trollT < 0;
    s.y = 0; s.vy = 0; s.ground = true;
    if (s.x < RX + .8) { s.vy = -imp; crash('Landed on the ramp foot'); return; }
    if (!upright) { s.vy = -imp; crash(u3.y < -.3 ? 'Landed on the roof' : 'Landed on its side'); return; }
    if (imp > 7.5) { s.vy = -imp; crash(`Slammed down at ${Math.round(imp * 2.237)} mph`); return; }
    sfx.thump(Math.min(1, imp / 5));
    s.landed = imp < 3.5 ? 'soft' : 'hard'; toast(s.landed === 'soft' ? 'Soft landing' : 'Hard landing', 900);
  }
  if (s.landed && s.ground && Math.abs(s.vx) < .3) {
    const base = 1000, soft = s.landed === 'soft' ? 600 : 200, air = Math.round(s.air * 4), flip = s.quickFlip ? 300 : 0, front = s.m < 0 ? 300 : 0;
    finish('ok', s.landed === 'soft' ? 'Stuck it' : 'Landed, barely', [['Off the wall and down', base], [s.landed === 'soft' ? 'Soft landing' : 'Hard landing', soft], [`Air left ${Math.round(s.air)} kg`, air], [s.quickFlip ? 'Quick flip' : 'Flip', flip], [s.m < 0 ? 'Landed facing forward' : 'Landed facing the wall', front]], base + soft + air + flip + front);
  }
  if (s.air <= 0 && !s.ground && !s.airToast) { s.airToast = true; toast('Out of air', 900); }
  jets(dt, lifting, boosting);
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

function step(dt) {
  const s = state;
  if (s.phase !== 'play') { if (s.cr) crashStep(dt); else if (s.fall) { s.vy -= G * dt; s.y += s.vy * dt; s.x += s.vx * dt * .6; } else { s.vx *= Math.exp(-dt * 2); s.x += s.vx * dt; } s.jet = 0; return; }
  s.t += dt;
  if (s.level === 1) step1(dt); else if (s.level === 2) step2(dt); else step3(dt);
  if (s.phase === 'play') { s.maxH = Math.max(s.maxH, s.y); if (s.level !== 3) record(dt); }
  input.any = false;
}

// ---------------- level 3: endless ----------------
// An endless lane far down the site (x >= XE). Obstacles are generated ahead of the car and removed behind it.
const XE = 1000;
const E = { group: new THREE.Group(), obs: [], nextX: 0, cleared: 0, cans: 0 };
scene.add(E.group);
for (const z of [6.5, -6.5]) {
  box(40000, .05, .1, M.red, XE + 20000, .03, z);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(40000, 2), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .14, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.rotation.x = -Math.PI / 2; g.position.set(XE + 20000, .02, z); scene.add(g);
}
// lane dashes and light posts are recycled around the car so the lane never ends
const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, .01, .12), M.mark, 50);
scene.add(dashes);
const posts = Array.from({ length: 8 }, () => {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, 7, 8), M.steel); pole.position.y = 3.5; g.add(pole);
  box(1.6, .12, .12, M.steel, .7, 7, 0, g);
  const lamp = box(.5, .12, .3, M.white, 1.3, 6.92, 0, g);
  const len = 9, cone = new THREE.Mesh(new THREE.CylinderGeometry(.2, 2.2, len, 24, 1, true), beamM);
  cone.position.set(1.3, 6.9 - len / 2, 0); g.add(cone);
  g.position.z = -9; g.visible = false; scene.add(g);
  return g;
});
const eKey = new THREE.SpotLight(0xeef3ff, 1100, 0, .62, .55, 1.6);
scene.add(eKey, eKey.target);
const eRed = new THREE.PointLight(RED, 40, 22); scene.add(eRed);
// a second key light further down the lane, so obstacles are lit before you reach them
const eAhead = new THREE.SpotLight(0xeef3ff, 1600, 0, .5, .6, 1.6);
scene.add(eAhead, eAhead.target);
eKey.visible = eRed.visible = eAhead.visible = false;
const dm = new THREE.Object3D();
function laneDressing(x) {
  const on = state && state.level === 3;
  dashes.visible = on; eKey.visible = eRed.visible = eAhead.visible = on;
  for (const p of posts) p.visible = on;
  if (!on) return;
  const d0 = Math.floor(x / 5) * 5 - 60;
  for (let i = 0; i < 50; i++) { dm.position.set(d0 + i * 5, .015, 0); dm.updateMatrix(); dashes.setMatrixAt(i, dm.matrix); }
  dashes.instanceMatrix.needsUpdate = true;
  const p0 = Math.floor(x / 32) * 32 - 64;
  posts.forEach((p, i) => (p.position.x = p0 + i * 32));
  eKey.position.set(x + 4, 13, 12); eKey.target.position.set(x + 12, 0, 0);
  eRed.position.set(x + 8, .6, 6.2);
  eAhead.position.set(x + 30, 14, 12); eAhead.target.position.set(x + 42, 0, 0);
}

const vehGeo = new Map();
function vehicleMesh(v) {
  if (!vehGeo.has(v.name)) {
    const sh = new THREE.Shape();
    v.prof.forEach(([a, b], i) => (i ? sh.lineTo(a * v.L - v.L / 2, b * v.H) : sh.moveTo(a * v.L - v.L / 2, b * v.H)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: v.W - .1, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2 });
    g.translate(0, 0, -(v.W - .1) / 2);
    vehGeo.set(v.name, { g, m: std(v.col, { metalness: v.metal ?? .5, roughness: .28 }) });
  }
  const { g, m } = vehGeo.get(v.name);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, m));
  box(.02, .025, v.W * .82, M.white, -v.L / 2 - .035, v.bar * v.H, 0, grp);
  const wh = v.name === 'Semi' ? [.13, .66, .84] : [.18, .8];
  for (const w of wh) for (const s of [1, -1]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(v.wr, v.wr, .27, 18), M.tire); t.rotation.x = Math.PI / 2; t.position.set(w * v.L - v.L / 2, v.wr, s * (v.W / 2 - .12)); grp.add(t); }
  grp.rotation.y = Math.PI / 2;
  return grp;
}
const CONT = [0x8c2f22, 0x1f4e79, 0xb58a1f, 0x3b6e3b, 0x5b5f66].map((c) => std(c, { roughness: .6, metalness: .3 }));
const canMat = std(0x26282c, { metalness: .35, roughness: .22 }), canGlow = glow(0x9fd3ff);
const SEMI = LINEUP.find((v) => v.name === 'Semi');
const SMALL = LINEUP.filter((v) => v.name !== 'Semi');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// one obstacle "set" at x; returns how much lane it used
function spawn(x, dist) {
  const add = (o) => { E.obs.push(o); if (o.mesh) E.group.add(o.mesh); };
  const kinds = ['cars'];
  if (dist > 120) kinds.push('semi');
  if (dist > 220) kinds.push('containers', 'bridge');
  if (dist > 350) kinds.push('trench', 'trench');
  if (dist > 600) kinds.push('combo');
  const kind = pick(kinds);
  if (kind === 'cars' || kind === 'semi' || kind === 'combo') {
    const list = kind === 'semi' ? [SEMI] : kind === 'combo' ? [pick(SMALL), SEMI, pick(SMALL)] : Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => pick(SMALL));
    let cx = x;
    for (const v of list) {
      cx += v.W / 2;
      const mesh = vehicleMesh(v); mesh.position.set(cx, 0, 0);
      add({ x0: cx - v.W / 2, x1: cx + v.W / 2, y0: 0, y1: v.H, name: `the ${v.name}`, mesh, wob: 0, v });
      cx += v.W / 2 + .5;
    }
    return cx - x;
  }
  if (kind === 'containers') {
    const n = 1 + (Math.random() < .5 ? 1 : 0), g = new THREE.Group();
    for (let i = 0; i < n; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.59, 6.06), pick(CONT)); c.position.set(0, 1.3 + i * 2.59, (i % 2 ? .3 : -.2)); g.add(c); for (let k = -2; k <= 2; k++) box(2.46, 2.4, .04, M.dark, 0, 1.3 + i * 2.59, k * 1.1, g).material = M.lower; }
    g.position.set(x + 1.22, 0, 0);
    add({ x0: x, x1: x + 2.44, y0: 0, y1: n * 2.59, name: n > 1 ? 'a container stack' : 'a container', mesh: g });
    return 2.44;
  }
  if (kind === 'bridge') {
    const g = new THREE.Group(), y0 = 3.5;
    box(.8, .7, 14, M.steel, 0, y0 + .35, 0, g);
    box(.82, .08, 14, M.red, 0, y0 + .04, 0, g);
    for (const z of [-7, 7]) box(.4, y0 + .7, .4, M.steel, 0, (y0 + .7) / 2, z, g);
    g.position.set(x + .4, 0, 0);
    add({ x0: x, x1: x + .8, y0, y1: y0 + .7, name: 'the low bridge', mesh: g });
    return .8;
  }
  // trench: the ground drops away; land short of it or jump it
  const L = 7 + Math.random() * 5 + Math.min(6, dist / 300);
  const g = new THREE.Group();
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(L, 13), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.rotation.x = -Math.PI / 2; hole.position.y = .02; g.add(hole);
  for (const e of [-L / 2, L / 2]) box(.12, .06, 13, M.red, e, .04, 0, g);
  for (let k = -5; k <= 5; k += 2) box(L, .02, .3, M.lower, 0, .03, k, g);
  g.position.set(x + L / 2, 0, 0);
  add({ x0: x, x1: x + L, pit: true, mesh: g });
  return L;
}
function spawnCan(x) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .9, 6, 16), canMat); c.rotation.z = Math.PI / 2; g.add(c);
  for (const k of [-.3, .3]) { const r = new THREE.Mesh(new THREE.TorusGeometry(.34, .04, 8, 24), canGlow); r.rotation.y = Math.PI / 2; r.position.x = k; g.add(r); }
  const y = 2.4 + Math.random() * 4;
  g.position.set(x, y, 0); E.group.add(g);
  E.obs.push({ can: true, x0: x - .8, x1: x + .8, y, mesh: g });
}
function endlessReset() {
  for (const o of E.obs) E.group.remove(o.mesh);
  E.obs = []; E.cleared = 0; E.cans = 0; E.nextX = XE + 70;
}
function endlessGen(s) {
  const dist = s.x - XE;
  while (E.nextX < s.x + 240) {
    const d = E.nextX - XE;
    E.nextX += spawn(E.nextX, d);
    const gap = Math.max(16, (24 + Math.random() * 18) * (1 - Math.min(.35, d / 4000)));
    if (Math.random() < .55) spawnCan(E.nextX + gap * (.35 + Math.random() * .3));
    E.nextX += gap;
  }
  E.obs = E.obs.filter((o) => {
    if (o.x1 < s.x - 40) { E.group.remove(o.mesh); return false; }
    if (!o.can && !o.pit && !o.passed && o.x1 < s.x - CAR_LEN / 2) { o.passed = true; E.cleared++; }
    return true;
  });
  return dist;
}
const eScore = (s) => Math.round(s.x - XE) + E.cleared * 25 + E.cans * 50 + s.rollsBank * 300;
const eLines = (s) => [[`Distance ${Math.round(s.x - XE)} m`, Math.round(s.x - XE)], [`Obstacles cleared ${E.cleared}`, E.cleared * 25], [`Air cans ${E.cans}`, E.cans * 50], [`Barrel rolls ${s.rollsBank}`, s.rollsBank * 300]];
function fallOut(title) {
  const s = state;
  s.fall = true;
  const f = $('flash'); f.style.transition = 'none'; f.style.opacity = .6; requestAnimationFrame(() => { f.style.transition = 'opacity .9s'; f.style.opacity = 0; });
  navigator.vibrate?.([70, 40, 160]); sfx.crash();
  finish('crash', title, eLines(s), eScore(s));
}

function step3(dt) {
  const s = state;
  endlessGen(s);
  if (input.rollQueued) { input.rollQueued = false; if (!s.ground && s.rollT < 0 && s.y > 1.2) { s.rollT = 0; toast('Barrel roll', 700); sfx.whoosh(); } }
  if (s.rollT >= 0) { s.rollT += dt; s.roll = 2 * Math.PI * Math.min(1, s.rollT / ROLL_TIME); if (s.rollT >= ROLL_TIME) { s.rollT = -1; s.roll = 0; s.rolls++; } }
  const upY = Math.cos(s.roll);
  const cruise = 13 + Math.min(11, (s.x - XE) / 220);
  let ax = 0, ay = -G;
  const lifting = input.lift && s.air > 0, boosting = input.boost && s.air > 0;
  if (lifting) { ay += LIFT_ACC * upY; s.air -= LIFT_BURN * dt; }
  if (boosting) { ax += BOOST_ACC; s.air -= BOOST_BURN * dt; }
  const pit = E.obs.find((o) => o.pit && s.x > o.x0 + .9 && s.x < o.x1 - .9);
  if (s.ground && pit) s.ground = false;
  if (s.ground) {
    if (!boosting) ax += (cruise - s.vx) * (s.vx > cruise ? .35 : 1.4);
    if (ay <= 0) { ay = 0; s.vy = 0; }
    s.air = Math.min(AIR0, s.air + 6 * dt); // the onboard compressor tops the tanks up while driving
  }
  s.air = Math.max(0, s.air);
  ax -= s.vx * s.vx * .002;
  s.vx += ax * dt; s.vy += ay * dt;
  s.x += s.vx * dt; s.y += s.vy * dt;
  if (s.y > .02) s.ground = false;
  s.wheel -= s.vx * dt / .37;
  s.q.setFromAxisAngle(X, s.roll);
  // collisions against everything solid in the lane
  const low = s.y + Math.min(0, upY) * CAR_H - Math.abs(Math.sin(s.roll)) * CAR_HALF_W;
  const top = s.y + Math.max(0, upY) * CAR_H + Math.abs(Math.sin(s.roll)) * CAR_HALF_W;
  for (const o of E.obs) {
    if (o.pit || o.x1 < s.x - 3 || o.x0 > s.x + 3) continue;
    if (o.can) {
      if (Math.abs(s.x - (o.x0 + o.x1) / 2) < 2.4 && Math.abs(s.y + .6 - o.y) < 1.4) { o.x1 = -1e9; E.group.remove(o.mesh); E.cans++; s.air = Math.min(AIR0, s.air + 70); sfx.ding(); toast('+70 kg air', 700); }
      continue;
    }
    if (s.x + CAR_LEN / 2 - .3 > o.x0 && s.x - CAR_LEN / 2 + .3 < o.x1 && top > o.y0 + .05 && low < o.y1 + .1) {
      crash(`Hit ${o.name}`, o.v ? o : null);
      return;
    }
  }
  if (s.y <= 0 && !s.ground) {
    if (pit) { if (s.y < -1.4) { fallOut('Fell into the trench'); return; } }
    else {
      const imp = -s.vy;
      s.y = 0; s.vy = 0; s.ground = true;
      if (s.rollT >= 0 || upY < .8) { s.vy = -imp; crash(s.rollT >= 0 ? 'Landed mid-roll' : 'Landed on the roof'); return; }
      if (imp > 7.5) { s.vy = -imp; crash(`Slammed down at ${Math.round(imp * 2.237)} mph`); return; }
      if (s.rolls > s.rollsBank) { s.rollsBank = s.rolls; toast('Roll landed', 700); }
      sfx.thump(Math.min(1, imp / 5));
    }
  }
  if (s.air <= 0 && !s.ground && !s.airToast) { s.airToast = true; toast('Out of air', 900); }
  if (s.air > 20) s.airToast = false;
  jets(dt, lifting, boosting);
}

// ---------------- share card: a 1080x1920 story image built to be shown off ----------------
const snap = document.createElement('canvas');
function snapshot() { renderer.render(scene, camera); snap.width = renderer.domElement.width; snap.height = renderer.domElement.height; snap.getContext('2d').drawImage(renderer.domElement, 0, 0); }

// stats worth bragging about (no air figures; those mean nothing to someone scrolling)
function cardStats(s, kind) {
  const ft = Math.round(s.maxH * 3.281);
  if (s.level === 3) return [[`${Math.round(s.x - XE)} m`, 'Distance'], [`${E.cleared}`, 'Obstacles cleared'], [`${E.cans}`, 'Air cans grabbed']];
  if (s.level === 2) return [[`${ft} ft`, 'Dropped from'], [kind === 'ok' ? (s.landed === 'soft' ? 'Soft' : 'Hard') : 'Wrecked', 'Landing'], [s.m < 0 ? 'Forward' : 'At the wall', 'Faced']];
  return [[`${ft} ft`, 'Peak height'], [`${s.rollsBank}`, 'Barrel rolls'], [kind === 'ok' ? (s.landed === 'soft' ? 'Soft' : 'Hard') : 'Wrecked', 'Landing']];
}
function rank(r) {
  if (r.kind !== 'ok' && r.level !== 3) return 'WRECKED IT';
  if (r.level === 3) { const d = r.stats ? parseInt(r.stats[0][0]) : 0; return d < 300 ? 'ROOKIE' : d < 800 ? 'ROAD RUNNER' : d < 1500 ? 'JET JOCKEY' : 'ENDLESS LEGEND'; }
  return r.score < 1700 ? 'TEST DRIVER' : r.score < 2300 ? 'TEST PILOT' : r.score < 2900 ? 'THRUSTER ACE' : 'SPACEX GRADE';
}

// the hero: a clean studio render of the Roadster on its jets, from its own small renderer
let hero = null;
function heroCanvas(crashed) {
  const N = 1080;
  if (!hero) {
    const r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r2.setPixelRatio(1); r2.setSize(N, N, false);
    r2.toneMapping = THREE.ACESFilmicToneMapping; r2.toneMappingExposure = 1.2;
    const sc2 = new THREE.Scene();
    const built = buildCar(); sc2.add(built.car);
    built.flames.forEach((f) => f.scale.set(1.7, 2.8, 1.7));
    const jm = new THREE.MeshBasicMaterial({ color: 0xd6ecff, alphaMap: beamTex, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); jm.toneMapped = false;
    for (const p of NOZ.corner) { const g = new THREE.ConeGeometry(.3, 2.8, 18, 1, true); g.translate(0, -1.4, 0); const c = new THREE.Mesh(g, jm); c.position.set(...p); built.car.add(c); }
    sc2.add(new THREE.AmbientLight(0xffffff, .35), new THREE.HemisphereLight(0x8aa3c8, 0x110808, .6));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(4, 6, 8); sc2.add(key);
    const rim = new THREE.DirectionalLight(RED, 3.5); rim.position.set(-6, 2, -5); sc2.add(rim);
    const under = new THREE.PointLight(0xcfe6ff, 30, 6); under.position.set(0, -1, 1); sc2.add(under);
    const cam = new THREE.PerspectiveCamera(26, 1, .1, 100);
    cam.position.set(7.4, 2.4, 11.4); cam.lookAt(0, -.35, 0);
    hero = { r2, sc2, cam, car: built.car };
  }
  hero.car.rotation.set(crashed ? 2.5 : .1, crashed ? -.2 : -.35, crashed ? .5 : .07);
  hero.r2.setClearColor(0x000000, 0); hero.r2.render(hero.sc2, hero.cam);
  return hero.r2.domElement;
}

async function makeCard() {
  const r = lastResult; if (!r) return null;
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  await Promise.all([document.fonts.ready, document.fonts.load('700 90px Caveat'), document.fonts.load('700 60px "IBM Plex Sans"'), document.fonts.load('500 30px "IBM Plex Mono"')]);
  const mono = (s, w = 500) => `${w} ${s}px "IBM Plex Mono", monospace`, sans = (s, w = 700) => `${w} ${s}px "IBM Plex Sans", sans-serif`;
  const RED_ = '#ff3b2f', INK = '#eceef1', GREY = '#a3a8b0';
  const crashed = r.kind !== 'ok' && r.level !== 3;
  const right = (t, x, y) => g.fillText(t, x - g.measureText(t).width, y);

  // night sky, haze and two searchlight beams
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0c0f15'); bg.addColorStop(.55, '#07080b'); bg.addColorStop(1, '#030304');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (const [x0, x1] of [[80, 420], [1000, 660]]) {
    const b = g.createLinearGradient(x0, 0, x1, 1100); b.addColorStop(0, 'rgba(210,225,255,.16)'); b.addColorStop(1, 'rgba(210,225,255,0)');
    g.fillStyle = b; g.beginPath(); g.moveTo(x0 - 30, 0); g.lineTo(x0 + 30, 0); g.lineTo(x1 + 160, 1100); g.lineTo(x1 - 160, 1100); g.fill();
  }
  // giant outlined stage word behind the car
  g.save(); g.font = sans(230, 700); g.strokeStyle = 'rgba(236,238,241,.07)'; g.lineWidth = 3;
  const word = { 1: 'KICKFLIP', 2: 'THE RAMP', 3: 'ENDLESS' }[r.level];
  g.strokeText(word, (W - g.measureText(word).width) / 2, 560); g.restore();

  // red LED floor line with glow, and a cloud bank the jets are pushing into
  const fy = 1060;
  const glowG = g.createLinearGradient(0, fy - 60, 0, fy + 60); glowG.addColorStop(0, 'rgba(255,40,30,0)'); glowG.addColorStop(.5, 'rgba(255,40,30,.35)'); glowG.addColorStop(1, 'rgba(255,40,30,0)');
  g.fillStyle = glowG; g.fillRect(0, fy - 60, W, 120); g.fillStyle = '#ff2a1f'; g.fillRect(0, fy - 2, W, 4);
  const puff = puffTex().image;
  for (let i = 0; i < 70; i++) {
    const t = i / 70, x = 140 + 800 * ((i * .618) % 1), y = fy - 40 - 140 * Math.random() * (1 - Math.abs(t - .5)), s = 160 + 260 * Math.random();
    g.globalAlpha = .22 + .25 * Math.random(); g.drawImage(puff, x - s / 2, y - s / 2, s, s);
  }
  g.globalAlpha = 1;
  // the car
  const hc = heroCanvas(crashed);
  g.drawImage(hc, 0, 110, W, W);
  if (crashed) { g.save(); g.translate(W / 2, 640); g.rotate(-.12); g.font = sans(120, 700); g.strokeStyle = RED_; g.lineWidth = 6; const t = 'WRECKED'; const tw = g.measureText(t).width; g.strokeRect(-tw / 2 - 30, -110, tw + 60, 140); g.fillStyle = RED_; g.fillText(t, -tw / 2, 0); g.restore(); }

  // header
  g.fillStyle = RED_; g.fillRect(80, 96, 90, 8);
  g.font = mono(30); g.fillStyle = INK; g.fillText('FLYING ROADSTER SIM', 80, 156);
  g.fillStyle = GREY; g.fillText(`STAGE ${r.level} · ${LEVEL_NAME[r.level].toUpperCase()}`, 80, 200);
  if (r.newBest) { g.font = mono(26); const t = 'NEW PERSONAL BEST'; const tw = g.measureText(t).width; g.fillStyle = RED_; g.fillRect(W - 80 - tw - 36, 128, tw + 36, 52); g.fillStyle = '#fff'; g.fillText(t, W - 80 - tw - 18, 164); }

  // rank badge, score, result
  let y = 1170;
  g.font = mono(30, 500); const rk = rank(r), rw = g.measureText(rk).width;
  g.fillStyle = RED_; g.beginPath(); g.roundRect(80, y - 44, rw + 56, 62, 31); g.fill();
  g.fillStyle = '#fff'; g.fillText(rk, 108, y);
  y += 205; g.fillStyle = INK; g.font = sans(230, 700); const sc = r.score.toLocaleString('en-IN'); g.fillText(sc, 70, y);
  g.font = mono(34); g.fillStyle = GREY; g.fillText('PTS', 70 + ctxWidth(g, sc, sans(230, 700)) + 18, y);
  y += 78; g.font = sans(58, 600); g.fillStyle = INK; g.fillText(r.title, 80, y);

  // stat chips
  y += 42; const cw = (W - 160 - 2 * 20) / 3;
  (r.stats || []).slice(0, 3).forEach(([v, l], i) => {
    const x = 80 + i * (cw + 20);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(x, y, cw, 140, 22); g.fill(); g.stroke();
    g.fillStyle = INK; g.font = sans(v.length > 7 ? 40 : 56, 700); g.fillText(v, x + 26, y + 76);
    g.fillStyle = GREY; g.font = mono(20); g.fillText(l.toUpperCase(), x + 26, y + 114);
  });

  // signature footer: mascot, handwritten name, handle, challenge
  const fy2 = 1790;
  g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(80, fy2 - 70, W - 160, 2);
  const av = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'mascot.png'; });
  if (av) { g.save(); g.beginPath(); g.arc(130, fy2 + 20, 50, 0, Math.PI * 2); g.clip(); g.drawImage(av, 80, fy2 - 30, 100, 100); g.restore(); g.strokeStyle = RED_; g.lineWidth = 3; g.beginPath(); g.arc(130, fy2 + 20, 51, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = INK; g.font = '700 64px Caveat, cursive'; g.fillText('Made by Dewashish', 205, fy2 + 24);
  g.fillStyle = GREY; g.font = mono(24); g.fillText('@dewashish.ai', 210, fy2 + 72);
  g.textAlign = 'left'; g.fillStyle = RED_; g.font = sans(40, 700); right('Beat my score', W - 80, fy2 + 14);
  g.fillStyle = GREY; g.font = mono(22); right(location.hostname && !/localhost|127\.0\.0\.1/.test(location.hostname) ? (location.host + location.pathname).replace(/index\.html$/, '').replace(/\/$/, '') : 'comment FLY on the reel', W - 80, fy2 + 60);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
const ctxWidth = (g, t, font) => { const f = g.font; g.font = font; const w = g.measureText(t).width; g.font = f; return w; };
if (DEBUG) window.__card = makeCard; // test hook
async function shareCard() {
  const r = lastResult; if (!r) return;
  sfx.click();
  const blob = r.blob || await makeCard();
  const file = new File([blob], `roadster-sim-${r.score}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: `I scored ${r.score.toLocaleString('en-IN')} on the Flying Roadster Sim. ${location.href}` }); return; } catch { /* cancelled: fall through to download */ }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Card saved. Post it and tag @dewashish.ai', 2200);
}

// ---------------- speed streaks overlay ----------------
const sc = $('streaks'), sx = sc.getContext('2d');
const lines = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), l: .08 + Math.random() * .2, v: .8 + Math.random() * 1.6 }));
function streaks(k, dt) {
  const w = sc.width = window.innerWidth, h = sc.height = window.innerHeight;
  if (k < .03) return;
  sx.strokeStyle = `rgba(220,235,255,${(.35 * k).toFixed(3)})`; sx.lineWidth = 1.5;
  for (const L of lines) {
    L.x -= L.v * dt * (1.5 + 3 * k); if (L.x < -L.l) { L.x = 1 + Math.random() * .3; L.y = Math.random(); }
    if (Math.abs(L.y - .5) < .12) continue; // keep the car clear
    sx.beginPath(); sx.moveTo(L.x * w, L.y * h); sx.lineTo((L.x + L.l * k) * w, L.y * h); sx.stroke();
  }
}

// ---------------- HUD + camera + render ----------------
const camPos = new THREE.Vector3(-4, 4, 17), camLook = new THREE.Vector3();
// driver POV (experimental): the camera sits at the driver's head and turns with the car, rolls and all
let pov = store.get('rs-pov') === true;
const HEAD = new THREE.Vector3(-.05, 1.03, .3);
const POV_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.05));
const povOn = (s) => pov && s.phase !== 'idle' && !(s.cr && s.cr.t > .35);
function setPov(v) { pov = v; store.set('rs-pov', v); $('cam').textContent = v ? 'Chase view' : 'Driver view'; toast(v ? 'Driver view' : 'Chase view', 700); }
$('cam').addEventListener('click', (e) => { e.stopPropagation(); setPov(!pov); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyC') setPov(!pov); });
$('cam').textContent = pov ? 'Chase view' : 'Driver view';
function frame(dt) {
  const s = state;
  car.position.set(s.x, s.y, 0);
  car.quaternion.copy(s.q);
  for (const w of wheels) w.rotation.z = s.wheel;
  carLight.position.set(s.x + 3, s.y + 4, 5);
  // ghost: replay the best run at the same moment in time
  if (s.ghost && s.phase === 'play') {
    const i = Math.min(s.ghost.path.length - 1, Math.floor(s.t * 30)), p = s.ghost.path[i];
    ghost.visible = true; ghost.position.set(p[0], p[1], 0); ghost.quaternion.set(p[2], p[3], p[4], p[5]);
  } else if (s.phase !== 'play') ghost.visible = false;
  const portrait = isPortrait();
  let want, off;
  if (s.level === 2 && s.phase !== 'idle') {
    want = new THREE.Vector3(s.x * .55 + (RX - 3) * .45, Math.max(3, s.y * .7 + 3), 0);
    off = portrait ? new THREE.Vector3(10, 2, 30) : new THREE.Vector3(12, 3, 30);
  } else if (portrait) {
    // phones: a 3/4 chase camera down the lane, so obstacles show up far ahead instead of popping in at the screen edge
    want = new THREE.Vector3(s.x + 14, Math.max(1.4, s.y * .75 + 1.1), 0);
    off = new THREE.Vector3(-24.5, 4.2 + s.y * .25, 5.2); // camera sits about 10 m behind the car
  } else if (s.level === 3 && s.phase !== 'idle') {
    want = new THREE.Vector3(s.x + (portrait ? 5 : 9), Math.max(2.8, s.y * .6 + 2.4), 0);
    off = portrait ? new THREE.Vector3(-4, 3.4 + s.y * .2, 21) : new THREE.Vector3(-6, 3.6, 23);
  } else {
    want = new THREE.Vector3(s.x + (portrait ? 2.5 : 5), Math.max(2.6, s.y * .65 + 2.2), 0);
    off = portrait ? new THREE.Vector3(-3, 3.2 + s.y * .25, 20) : new THREE.Vector3(-5, 3.5 + s.y * .2, 22);
  }
  camLook.lerp(want, 1 - Math.exp(-dt * 6));
  // boost: the camera lags so the car surges ahead in the frame, the thrust cones flare, streaks fly past
  s.bAmt = (s.bAmt || 0) + (((s.boosting && s.phase === 'play') ? 1 : 0) - (s.bAmt || 0)) * (1 - Math.exp(-dt * 6));
  want.x -= s.bAmt * 3.5;
  flames.forEach((f, i) => f.scale.set(1 + s.bAmt * .8, s.bAmt * (2.2 + .5 * Math.sin(performance.now() / 23 + i * 1.7)), 1 + s.bAmt * .8));
  streaks(s.bAmt, dt);
  $('boostTag').style.opacity = s.bAmt > .05 ? 1 : 0;
  $('sv').style.color = s.bAmt > .3 ? 'var(--red)' : '';
  camPos.lerp(want.clone().add(off), 1 - Math.exp(-dt * 4));
  camera.position.copy(camPos);
  if (s.cr && s.cr.shake > .02) camera.position.add(new THREE.Vector3(rnd(), rnd(), rnd() * .5).multiplyScalar(s.cr.shake * 1.1));
  camera.lookAt(camLook);
  const inside = povOn(s);
  headbar.visible = !inside; // the nose light bar would glare across the view from inside
  canopy.material.transparent = inside; canopy.material.opacity = inside ? .12 : 1; canopy.material.depthWrite = !inside;
  if (inside) {
    camera.quaternion.copy(s.q).multiply(POV_Q);
    camera.position.copy(HEAD).applyQuaternion(s.q).add(new THREE.Vector3(s.x, s.y, 0));
  }
  // boost kick: the view widens while the rear jets fire, so the speed reads
  s.fovKick = (s.fovKick || 0) + ((s.boosting && s.phase === 'play' ? 9 : 0) - (s.fovKick || 0)) * (1 - Math.exp(-dt * 5));
  const baseFov = inside ? (portrait ? 76 : 62) : (portrait ? 62 : 40);
  if (Math.abs(camera.fov - baseFov - s.fovKick) > .05) { camera.fov = baseFov + s.fovKick; camera.updateProjectionMatrix(); }
  $('airv').textContent = `${Math.round(s.air)} kg`;
  $('hv').textContent = `${Math.round(Math.max(0, s.y) * 3.281)} ft`;
  $('sv').textContent = `${Math.round(Math.hypot(s.vx, s.vy) * 2.237)} mph`;
  const f = $('airfill'); f.style.width = `${(s.air / AIR0) * 100}%`; f.classList.toggle('low', s.air < 60);
  laneDressing(s.x);
  for (const o of E.obs) if (o.can) o.mesh.rotation.x += dt * 2;
  if (s.level === 3 && s.phase === 'play') $('best').textContent = `${Math.round(s.x - XE)} m · score ${eScore(s).toLocaleString('en-IN')}`;
  const speed = s.phase === 'play' && s.ground ? Math.abs(s.vx) : 0;
  sfx.update(s.phase === 'play' ? s.jet : 0, speed, s.phase === 'play' && s.level === 2 && s.stage !== 'fly' ? 1 : 0);
}

reset(1);
state.phase = 'idle';
let last = performance.now(), acc = 0;
function loop(now) {
  if (DEBUG && window.__paused) { last = now; requestAnimationFrame(loop); return; } // recording drives frames itself
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  acc += dt;
  // hit-stop: the first moments of a crash play in slow motion
  const ts = state.cr && state.cr.t < .9 ? .3 : 1;
  while (acc >= 1 / 120) { if (state.phase !== 'idle') step(ts / 120); acc -= 1 / 120; }
  if (state.phase === 'idle') { state.x = 20 + Math.sin(now / 4000) * 2; }
  updateEffects(dt * ts);
  updateParticles(dt * ts);
  frame(dt);
  renderer.render(scene, camera);
  if (DEBUG && window.__probe) { renderer.getContext().finish(); window.__ms = performance.now() - now; } // test hook: real cost of one frame
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// test hooks, only with ?debug in the URL
if (DEBUG) {
  // test hook: run the sim for a fixed time with given inputs, independent of frame rate
  // frame-step for recording: advance exactly one 30 fps frame with these inputs, with smooth camera and effects
  window.__tick = (inp = {}) => { input.lift = !!inp.lift; input.boost = !!inp.boost; if (inp.roll) input.rollQueued = true; if (inp.turn) input.turnQueued = true; if (inp.any) input.any = true; const ts = state.cr && state.cr.t < .9 ? .3 : 1; for (let i = 0; i < 4; i++) if (state.phase !== 'idle') step(ts / 120); updateEffects(ts / 30); updateParticles(ts / 30); frame(1 / 30); renderer.render(scene, camera); const s = state; return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, phase: s.phase, stage: s.stage, landed: s.landed, ground: s.ground }; };
  window.__pause = () => { window.__paused = true; };
  window.__sim = (sec, lift = false, boost = false, roll = false, any = false) => { input.lift = lift; input.boost = boost; if (roll) input.rollQueued = true; if (any) input.any = true; for (let i = 0; i < sec * 120 && state.phase === 'play'; i++) { step(1 / 120); if (i % 4 === 0) updateParticles(1 / 30); } input.lift = input.boost = false; frame(1); renderer.render(scene, camera); const s = state; return { x: +s.x.toFixed(1), y: +s.y.toFixed(2), vx: +s.vx.toFixed(1), vy: +s.vy.toFixed(1), a: +(s.a ?? 0).toFixed(2), stage: s.stage, air: Math.round(s.air), phase: s.phase, landed: s.landed, title: document.getElementById('eTitle').textContent, score: document.getElementById('eScore').textContent }; };
  window.__state = () => state;
  window.__E = E; // test hook
}
// self-check of the air budget: hovering burns the full tank in about 8 s, as in the reel
console.assert(Math.abs(AIR0 / LIFT_BURN - 8.33) < .1, 'air budget drifted from the reel');
console.assert(Math.abs(angDiff(.1, 2 * Math.PI) - .1) < 1e-9, 'angDiff wrap');
