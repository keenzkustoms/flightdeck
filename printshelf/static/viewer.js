import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

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
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
  renderer?.dispose();
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  active = null;
}

export async function mountOrbitViewer(container, { url, noteEl } = {}) {
  disposeActive();
  if (!container || !url) return;

  container.innerHTML = "";
  const status = document.createElement("div");
  status.className = "viewer-status";
  status.textContent = "Loading 3D preview…";
  container.appendChild(status);

  const width = Math.max(280, container.clientWidth || 320);
  const height = Math.max(240, Math.round(width * 0.85));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141c28);

  const camera = new THREE.PerspectiveCamera(40, width / height, 0.01, 5000);
  camera.position.set(2.2, 1.6, 2.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.domElement.className = "viewer-canvas";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;

  scene.add(new THREE.HemisphereLight(0xfff2dd, 0x1a2433, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(2.5, 4, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8d4ff, 0.35);
  fill.position.set(-2.5, 0.5, -1.5);
  scene.add(fill);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (active) active.raf = raf;
    controls.update();
    renderer.render(scene, camera);
  };

  const resizeObs = new ResizeObserver(() => {
    const w = Math.max(240, container.clientWidth || 320);
    const h = Math.max(220, Math.round(w * 0.85));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  resizeObs.observe(container);

  active = { renderer, scene, controls, raf: 0, resizeObs, objectUrl: null };

  try {
    const res = await fetch(url);
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.detail || JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const simplified = res.headers.get("X-PrintShelf-Simplified") === "1";
    const blob = await res.blob();
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Thingiverse (etc.) often ships PNG card previews with a .stl extension.
    if (
      bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    ) {
      throw new Error("This file is a PNG image named like an STL (Thingiverse card preview), not a mesh");
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      throw new Error("This file is a JPEG image named like an STL, not a mesh");
    }
    // ASCII STL starts with "solid" + facet lines — skip binary header sanity check
    // (bytes 80–84 are text and look like a huge triangle count).
    const headText = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 200))).toLowerCase();
    const looksAscii = headText.trimStart().startsWith("solid") && headText.includes("facet");
    if (!looksAscii && bytes.length >= 84) {
      const view = new DataView(buf);
      const nTri = view.getUint32(80, true);
      const expected = 84 + nTri * 50;
      // Binary STL header lies → Three.js tries to allocate a multi-GB TypedArray.
      if (nTri > 50_000_000 || (nTri > 0 && expected > bytes.length + 512)) {
        throw new Error("Not a valid STL mesh (bad triangle count in header)");
      }
    }
    const objectUrl = URL.createObjectURL(new Blob([buf], { type: blob.type || "application/octet-stream" }));
    active.objectUrl = objectUrl;

    const loader = new STLLoader();
    const geometry = await loader.loadAsync(objectUrl);
    geometry.computeVertexNormals();
    geometry.center();
    // Z-up print meshes → Y-up for Three
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: 0x60b4eb, // MakerDeck sky blue — match mesh card thumbs
      metalness: 0.12,
      roughness: 0.48,
      flatShading: false,
    });
    scene.add(new THREE.Mesh(geometry, material));

    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius || 1;
    controls.target.set(0, 0, 0);
    camera.position.set(radius * 2.1, radius * 1.4, radius * 2.1);
    controls.update();

    status.remove();
    const tip = document.createElement("div");
    tip.className = "viewer-tip";
    tip.textContent = "Drag to orbit · scroll to zoom · right-drag to pan";
    container.appendChild(tip);

    if (noteEl) {
      noteEl.textContent = simplified
        ? "Preview is simplified for smoother orbiting (full file unchanged on disk). Turn on Higher detail if it looks sparse."
        : "";
      noteEl.hidden = !simplified;
    }

    tick();
  } catch (err) {
    status.textContent = `Could not load 3D preview: ${err?.message || err}`;
    status.classList.add("error");
    if (noteEl) {
      noteEl.textContent = "";
      noteEl.hidden = true;
    }
  }
}

export function unmountOrbitViewer() {
  disposeActive();
}

window.PrintShelfViewer = { mountOrbitViewer, unmountOrbitViewer };
