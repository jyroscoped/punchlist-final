import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float gridLine(vec2 uv, float scale, float weight) {
    vec2 grid = abs(fract(uv * scale - 0.5) - 0.5) / fwidth(uv * scale);
    float line = min(grid.x, grid.y);
    return 1.0 - min(line / weight, 1.0);
  }

  void main() {
    vec2 uv = vUv;
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 p = (uv - 0.5) * aspect;
    vec2 mouse = (uPointer - 0.5) * aspect;

    float drift = noise(p * 2.8 + vec2(uTime * 0.025, -uTime * 0.018));
    float fineGrid = gridLine(uv + drift * 0.004, 17.0, 1.0);
    float majorGrid = gridLine(uv, 4.25, 1.2);

    float pointerGlow = exp(-7.0 * length(p - mouse));
    float sweep = smoothstep(0.18, 0.0, abs(uv.y - fract(uTime * 0.025)));
    float grain = hash(gl_FragCoord.xy + floor(uTime * 2.0)) - 0.5;

    vec3 base = vec3(0.035, 0.115, 0.185);
    vec3 cyan = vec3(0.22, 0.72, 0.74);
    vec3 paper = vec3(0.78, 0.86, 0.88);

    vec3 color = base;
    color += cyan * fineGrid * 0.05;
    color += paper * majorGrid * 0.045;
    color += cyan * pointerGlow * 0.12;
    color += cyan * sweep * 0.025;
    color += grain * 0.012;

    float vignette = smoothstep(0.9, 0.22, length(vUv - 0.5));
    color *= 0.82 + vignette * 0.18;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function initBlueprintScene(canvas, { forceReduced = false } = {}) {
  if (!canvas) return () => {};

  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = forceReduced || reduceQuery.matches;
  let visible = true;
  let disposed = false;
  let startTime = performance.now();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
  } catch (error) {
    canvas.hidden = true;
    console.warn("WebGL is unavailable; the blueprint fallback remains visible.", error);
    return () => {};
  }

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2(0.68, 0.35) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const pointerGoal = new THREE.Vector2(0.68, 0.35);
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateLoop();
  }, { threshold: 0.02 });

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(rect.width, rect.height, false);
    uniforms.uResolution.value.set(rect.width * renderer.getPixelRatio(), rect.height * renderer.getPixelRatio());
    render(reduced ? 2.4 : (performance.now() - startTime) / 1000);
  };

  const render = (time) => {
    if (disposed) return;
    uniforms.uTime.value = time;
    uniforms.uPointer.value.lerp(pointerGoal, 0.06);
    renderer.render(scene, camera);
  };

  const animate = (time) => render((time - startTime) / 1000);

  const updateLoop = () => {
    const shouldAnimate = visible && !document.hidden && !reduced && !disposed;
    renderer.setAnimationLoop(shouldAnimate ? animate : null);
    if (!shouldAnimate) render(reduced ? 2.4 : (performance.now() - startTime) / 1000);
  };

  const onPointerMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointerGoal.set(
      THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1),
      THREE.MathUtils.clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
    );
  };

  const onVisibility = () => updateLoop();
  const onMotionChange = (event) => {
    reduced = forceReduced || event.matches;
    updateLoop();
  };

  observer.observe(canvas);
  window.addEventListener("resize", resize, { passive: true });
  canvas.parentElement?.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  reduceQuery.addEventListener("change", onMotionChange);
  resize();
  updateLoop();

  return () => {
    disposed = true;
    renderer.setAnimationLoop(null);
    observer.disconnect();
    window.removeEventListener("resize", resize);
    canvas.parentElement?.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("visibilitychange", onVisibility);
    reduceQuery.removeEventListener("change", onMotionChange);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  };
}
