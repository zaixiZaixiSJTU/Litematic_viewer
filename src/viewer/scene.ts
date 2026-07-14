import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { LitematicPreview } from "../litematic/parser";
import { blockOpacity, blockParts } from "./block-shapes";

export function mountScene(container: HTMLElement, model: LitematicPreview) {
  if (!model.blocks.length) throw new Error("投影中没有可显示的非空气方块");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10151d);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10000);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false })
    || canvas.getContext("webgl", { antialias: true, alpha: false });
  if (!context) throw new Error("当前系统 WebView 无法创建 WebGL 上下文，请检查显卡驱动或硬件加速设置");
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = model.blocks.length < 50_000;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x25301f, 2.2));
  const light = new THREE.DirectionalLight(0xffffff, 2.4); light.position.set(40, 80, 30); scene.add(light);
  const [min, max] = [model.bounds.min, model.bounds.max];
  const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const span = Math.max(4, max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1);

  type Instance = { position: THREE.Vector3; scale: THREE.Vector3; rotationY: number };
  const groups = new Map<string, { color: number; opacity: number; instances: Instance[] }>();
  for (const block of model.blocks) {
    const opacity = blockOpacity(block.name), key = `${block.color}:${opacity}`;
    let group = groups.get(key);
    if (!group) { group = { color: block.color, opacity, instances: [] }; groups.set(key, group); }
    for (const part of blockParts(block)) group.instances.push({
      position: new THREE.Vector3(block.x + part.offset[0] - center.x, block.y + part.offset[1] - center.y, block.z + part.offset[2] - center.z),
      scale: new THREE.Vector3(...part.scale), rotationY: part.rotationY || 0
    });
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1), matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const { color, opacity, instances } of groups.values()) {
    const material = new THREE.MeshLambertMaterial({ color, opacity, transparent: opacity < 1, depthWrite: opacity >= 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = opacity < 1 ? 1 : 0;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]; quaternion.setFromAxisAngle(yAxis, instance.rotationY);
      matrix.compose(instance.position, quaternion, instance.scale); mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true; scene.add(mesh);
  }
  const gridSize = Math.max(16, Math.ceil(span / 16) * 16);
  const grid = new THREE.GridHelper(gridSize, Math.min(128, gridSize), 0x64748b, 0x273444);
  grid.position.y = min[1] - center.y - 0.51; scene.add(grid);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
  camera.position.set(span * 1.15, span * 0.8, span * 1.15); controls.target.set(0, 0, 0); controls.update();

  let frame = 0;
  const resize = () => { const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(container); else window.addEventListener("resize", resize);
  resize();
  const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); }; render();
  return () => {
    cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener("resize", resize); controls.dispose(); renderer.dispose(); geometry.dispose();
    scene.traverse((object) => { if (object instanceof THREE.Mesh) { const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((m) => m.dispose()); } });
    renderer.domElement.remove();
  };
}
