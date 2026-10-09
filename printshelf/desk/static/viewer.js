import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

let active = null;

function disposeActive() {
  if (!active) return;
  const { renderer, scene, controls, raf, resizeObs, objectUrl } = active;
  if (raf) cancelAnimationFrame(raf);
  if (resizeObs) resizeObs.disconnect();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  controls?.dispose();
  scene?.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => m.dispose());
    }
  });
  renderer?.dispose();
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  active = null;
}

function meshMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xd5dde6,
    metalness: 0.08,
    roughness: 0.46,
    side: THREE.DoubleSide,
  });
}

function fitCamera(camera, controls, sphere) {
  const center = sphere?.center || new THREE.Vector3();
  const radius = Math.max(sphere?.radius || 1, 0.1);
  controls.target.copy(center);
  camera.position.set(center.x + radius * 1.8, center.y + radius * 0.85, center.z + radius * 1.8);
  camera.near = radius / 200;
  camera.far = radius * 80;
  camera.updateProjectionMatrix();
  controls.update();
  return radius;
}

// STL is Z-up, like a printer. OBJ is usually Y-up already. Sitting a Y-up
// dog on Z rolls him onto his side.
function seatMatrix(box, up) {
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  if (up === "y") {
    return new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz);
  }
  const shift = new THREE.Matrix4().makeTranslation(-cx, -cy, -box.min.z);
  const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  return rot.multiply(shift);
}

function addMesh(parent, geometry) {
  return addPreviewMesh(parent, geometry, "z");
}

function addPreviewMesh(parent, geometry, up) {
  geometry.computeBoundingBox();
  geometry.applyMatrix4(seatMatrix(geometry.boundingBox, up));
  geometry.computeVertexNormals();
  parent.add(new THREE.Mesh(geometry, meshMaterial()));
  geometry.computeBoundingSphere();
  return geometry.boundingSphere;
}

function seatGroup(group) {
  group.updateMatrixWorld(true);
  const baked = [];
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const geometry = obj.geometry.clone();
    geometry.applyMatrix4(obj.matrixWorld);
    baked.push(geometry);
  });
  while (group.children.length) group.remove(group.children[0]);
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.set(1, 1, 1);
  for (const geometry of baked) group.add(new THREE.Mesh(geometry, meshMaterial()));
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return new THREE.Sphere(new THREE.Vector3(), 1);
  const mat = seatMatrix(box, "y");
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    obj.geometry.applyMatrix4(mat);
    obj.geometry.computeVertexNormals();
    obj.geometry.computeBoundingBox();
  });
  return new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
}

// STL files repeat vertices, so a "face" is every coplanar triangle that shares an edge.
function faceGraph(geometry) {
  if (geometry.userData.faceGraph) return geometry.userData.faceGraph;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = Math.floor((index ? index.count : pos.count) / 3);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1e-6);
  const quant = Math.max(span * 1e-4, 1e-6);
  const q = 1 / quant;
  const v = new THREE.Vector3();
  const corner = (tri, slot) => {
    const at = tri * 3 + slot;
    return index ? index.getX(at) : at;
  };
  const vkey = (point) => `${Math.round(point.x * q)}|${Math.round(point.y * q)}|${Math.round(point.z * q)}`;
  const tris = new Array(triCount);
  const edges = new Map();
  const link = (ka, kb, tri) => {
    const key = ka < kb ? `${ka}=${kb}` : `${kb}=${ka}`;
    const list = edges.get(key);
    if (list) list.push(tri);
    else edges.set(key, [tri]);
  };
  for (let t = 0; t < triCount; t++) {
    const a = v.clone().fromBufferAttribute(pos, corner(t, 0));
    const b = new THREE.Vector3().fromBufferAttribute(pos, corner(t, 1));
    const c = new THREE.Vector3().fromBufferAttribute(pos, corner(t, 2));
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (normal.lengthSq() > 1e-20) normal.normalize();
    else normal.set(0, 1, 0);
    const ka = vkey(a);
    const kb = vkey(b);
    const kc = vkey(c);
    tris[t] = { a, b, c, normal };
    link(ka, kb, t);
    link(kb, kc, t);
    link(kc, ka, t);
  }
  const neighbors = Array.from({ length: triCount }, () => []);
  for (const list of edges.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        neighbors[list[i]].push(list[j]);
        neighbors[list[j]].push(list[i]);
      }
    }
  }
  const graph = { tris, neighbors, planeTol: quant, regionOf: new Map(), regions: [] };
  geometry.userData.faceGraph = graph;
  return graph;
}

function faceRegion(geometry, start) {
  const graph = faceGraph(geometry);
  if (graph.regionOf.has(start)) return graph.regions[graph.regionOf.get(start)];
  const seed = graph.tris[start];
  if (!seed) return [];
  const n = seed.normal;
  // About 40 degrees from the clicked spot. Flat sides stay whole.
  // A smooth nose grows into a patch and stops at a sharp crease.
  const sameWay = Math.cos(40 * Math.PI / 180);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const tri = stack.pop();
    for (const next of graph.neighbors[tri]) {
      if (seen.has(next)) continue;
      if (graph.tris[next].normal.dot(n) < sameWay) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  const id = graph.regions.length;
  const region = [];
  seen.forEach((tri) => {
    graph.regionOf.set(tri, id);
    region.push(tri);
  });
  graph.regions.push(region);
  return region;
}

export async function mountViewer(container, { url, kind } = {}) {
  disposeActive();
  if (!container || !url) return;
  container.innerHTML = "";
  const status = document.createElement("div");
  status.className = "viewer-status";
  status.textContent = "Opening model…";
  container.appendChild(status);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1f27);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "viewer-canvas";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x243044, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 5, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9eb6d4, 0.35);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  const grid = new THREE.GridHelper(10, 10, 0x6d8299, 0x3d4c63);
  const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
  mats.forEach((mat) => {
    mat.transparent = true;
    mat.opacity = 0.85;
  });
  scene.add(grid);

  const resize = () => {
    const w = Math.max(200, container.clientWidth);
    const h = Math.max(200, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  resize();
  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(container);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (active) active.raf = raf;
    controls.update();
    renderer.render(scene, camera);
  };
  const model = new THREE.Group();
  scene.add(model);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const highlightMat = new THREE.MeshBasicMaterial({
    color: 0xf0a040,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  let highlight = null;
  let press = null;

  function modelMeshes() {
    const meshes = [];
    model.traverse((obj) => {
      if (obj.isMesh) meshes.push(obj);
    });
    return meshes;
  }

  function hitAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(modelMeshes(), false);
    return hits[0] || null;
  }

  function clearHighlight() {
    if (!highlight) return;
    scene.remove(highlight);
    highlight.geometry.dispose();
    highlight = null;
  }

  function facingNormal(hit) {
    const graph = hit.object.geometry.userData.faceGraph;
    const region = graph && hit.faceIndex != null ? faceRegion(hit.object.geometry, hit.faceIndex) : null;
    const normal = new THREE.Vector3();
    if (region?.length && graph) {
      for (const index of region) normal.add(graph.tris[index].normal);
    } else if (hit.face) {
      normal.copy(hit.face.normal);
    }
    if (normal.lengthSq() < 1e-8) return null;
    normal.normalize().transformDirection(hit.object.matrixWorld);
    if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
    return normal;
  }

  function showFace(hit) {
    if (hit?.faceIndex == null) return;
    const region = faceRegion(hit.object.geometry, hit.faceIndex);
    const graph = hit.object.geometry.userData.faceGraph;
    const regionId = graph?.regionOf.get(hit.faceIndex);
    const key = `${hit.object.uuid}:${regionId}`;
    if (!region.length || highlight?.userData.key === key) return;
    clearHighlight();
    const normal = facingNormal(hit);
    if (!normal) return;
    const span = new THREE.Box3().setFromObject(hit.object).getSize(new THREE.Vector3()).length();
    const lift = Math.max(span, 1) * 0.0015;
    const flat = new Float32Array(region.length * 9);
    const world = hit.object.matrixWorld;
    let offset = 0;
    for (const triIndex of region) {
      const tri = graph.tris[triIndex];
      for (const point of [tri.a, tri.b, tri.c]) {
        const placed = point.clone().applyMatrix4(world).addScaledVector(normal, lift);
        flat[offset++] = placed.x;
        flat[offset++] = placed.y;
        flat[offset++] = placed.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    highlight = new THREE.Mesh(geometry, highlightMat);
    highlight.userData.key = key;
    scene.add(highlight);
  }

  function layOnFace(worldNormal) {
    const down = new THREE.Vector3(0, -1, 0);
    const turn = new THREE.Quaternion().setFromUnitVectors(worldNormal.clone().normalize(), down);
    model.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.applyQuaternion(turn);
    model.position.add(center);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const mid = box.getCenter(new THREE.Vector3());
    model.position.x -= mid.x;
    model.position.z -= mid.z;
    model.position.y -= box.min.y;
    model.updateMatrixWorld(true);
    controls.target.copy(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1) * 1.6;
    grid.scale.setScalar(span / 10);
    clearHighlight();
  }

  const onPointerDown = (event) => {
    press = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    if (press) return;
    const hit = hitAt(event);
    if (hit) showFace(hit);
    else clearHighlight();
  };
  const onPointerUp = (event) => {
    if (!press) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    press = null;
    if (moved > 6) return;
    const hit = hitAt(event);
    if (!hit?.face) return;
    const normal = facingNormal(hit);
    if (!normal) return;
    layOnFace(normal);
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);

  active = {
    renderer, scene, controls, raf: 0, resizeObs, objectUrl: null, model,
  };
  tick();

  try {
    let sphere;
    let shortStl = null;
    if (kind === "3mf" || kind === "gcode.3mf") {
      const meshUrl = url.replace("/api/file?", "/api/mesh?");
      const meshRes = await fetch(meshUrl);
      if (!meshRes.ok) throw new Error("This 3MF has no model to show");
      sphere = addMesh(model, previewGeometry(await meshRes.arrayBuffer()));
    } else {
    const res = await fetch(url);
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error || "";
      } catch {
        detail = "";
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      throw new Error("This file is a picture named like a model");
    }
    const objectUrl = URL.createObjectURL(new Blob([buf]));
    active.objectUrl = objectUrl;
    if (kind === "obj") {
      const group = await new OBJLoader().loadAsync(objectUrl);
      model.add(group);
      sphere = seatGroup(group);
    } else {
      const geometry = await new STLLoader().loadAsync(objectUrl);
      sphere = addMesh(model, geometry);
      shortStl = geometry.userData?.stlShort || null;
    }
    }
    const radius = fitCamera(camera, controls, sphere);
    const span = Math.max(radius * 2.4, 1);
    grid.scale.setScalar(span / 10);
    status.remove();
    const tip = document.createElement("div");
    tip.className = "viewer-tip";
    if (shortStl) {
      const have = Number(shortStl.have).toLocaleString();
      const claimed = Number(shortStl.claimed).toLocaleString();
      tip.textContent = `Opened ${have} of ${claimed} triangles. This copy looks cut off.`;
    } else {
      tip.textContent = "Click a face to lay it on the bed";
    }
    container.appendChild(tip);
  } catch (err) {
    status.textContent = `Could not open this model: ${err?.message || err}`;
    status.classList.add("error");
  }
}

export function unmountViewer() {
  disposeActive();
}

let thumbRig = null;

function previewGeometry(buf) {
  if (buf.byteLength < 4) throw new Error("empty preview");
  const count = new DataView(buf).getUint32(0, true);
  const need = 4 + count * 9 * 4;
  if (!count || buf.byteLength < need) throw new Error("empty preview");
  const positions = new Float32Array(buf.slice(4, need));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function clearThumbMeshes(scene) {
  const drop = [];
  scene.traverse((obj) => {
    if (obj.isMesh) drop.push(obj);
  });
  for (const obj of drop) {
    obj.parent?.remove(obj);
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => mat?.dispose());
  }
}

function ensureThumbRig() {
  if (thumbRig) return thumbRig;
  const width = 480;
  const height = 360;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3038);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 5000);
  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x243044, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 5, 2);
  scene.add(key);
  thumbRig = { renderer, scene, camera };
  return thumbRig;
}

export async function renderThumb(url, kind) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("preview failed");
  const geometry = previewGeometry(await res.arrayBuffer());
  const { renderer, scene, camera } = ensureThumbRig();
  clearThumbMeshes(scene);
  const sphere = addPreviewMesh(scene, geometry, kind === "obj" ? "y" : "z");
  const center = sphere?.center || new THREE.Vector3();
  const radius = Math.max(sphere?.radius || 1, 0.1);
  camera.position.set(center.x + radius * 1.55, center.y + radius * 0.95, center.z + radius * 1.7);
  camera.lookAt(center);
  camera.near = radius / 100;
  camera.far = radius * 40;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/jpeg", 0.8);
}

window.MeshFinderViewer = { mountViewer, unmountViewer, renderThumb };
