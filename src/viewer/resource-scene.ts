import { Structure, StructureRenderer } from "deepslate";
import { mat4 } from "gl-matrix";
import type { LitematicPreview } from "../litematic/parser";
import type { ClientResources } from "./resource-pack";

export function mountResourceScene(container: HTMLElement, model: LitematicPreview, resources: ClientResources) {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%"; canvas.style.height = "100%"; canvas.style.display = "block";
  container.appendChild(canvas);
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: false });
  if (!gl) { canvas.remove(); throw new Error("当前系统 WebView 无法创建 WebGL 上下文"); }

  const min = model.bounds.min, max = model.bounds.max;
  const size: [number, number, number] = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
  const structure = new Structure(size);
  for (const block of model.blocks) structure.addBlock(
    [block.x - min[0], block.y - min[1], block.z - min[2]], block.name, { ...block.properties }
  );
  const renderer = new StructureRenderer(gl, structure, resources, { chunkSize: 8, useInvisibleBlockBuffer: false });
  const span = Math.max(...size, 4), target: [number, number, number] = [size[0] / 2, size[1] / 2, size[2] / 2];
  let yaw = -0.75, pitch = 0.58, distance = span * 1.55, dragging = false, lastX = 0, lastY = 0, frame = 0;

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2), width = Math.max(1, Math.floor(container.clientWidth * ratio)), height = Math.max(1, Math.floor(container.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; renderer.setViewport(0, 0, width, height); }
  };
  const draw = () => {
    frame = requestAnimationFrame(draw); resize();
    gl.clearColor(0.063, 0.082, 0.114, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const view = mat4.create();
    mat4.translate(view, view, [0, 0, -distance]); mat4.rotateX(view, view, pitch); mat4.rotateY(view, view, yaw); mat4.translate(view, view, [-target[0], -target[1], -target[2]]);
    renderer.drawStructure(view); renderer.drawGrid(view);
  };
  const pointerDown = (event: PointerEvent) => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); };
  const pointerMove = (event: PointerEvent) => { if (!dragging) return; yaw += (event.clientX - lastX) * 0.008; pitch = Math.max(-1.45, Math.min(1.45, pitch + (event.clientY - lastY) * 0.008)); lastX = event.clientX; lastY = event.clientY; };
  const pointerUp = () => { dragging = false; };
  const wheel = (event: WheelEvent) => { event.preventDefault(); distance = Math.max(1.5, Math.min(span * 12, distance * Math.exp(event.deltaY * 0.001))); };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerUp); canvas.addEventListener("wheel", wheel, { passive: false });
  draw();
  return () => {
    cancelAnimationFrame(frame); canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerUp); canvas.removeEventListener("wheel", wheel);
    gl.getExtension("WEBGL_lose_context")?.loseContext(); canvas.remove();
  };
}
