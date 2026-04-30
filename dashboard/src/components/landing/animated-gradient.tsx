"use client";

import { useEffect, useRef } from "react";

export function AnimatedGradientMesh() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let t = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const orbs = [
      { x: 0.2, y: 0.3, r: 0.45, color: "34, 197, 94", speed: 0.0003, phase: 0 },
      { x: 0.8, y: 0.6, r: 0.4, color: "139, 92, 246", speed: 0.0004, phase: 2 },
      { x: 0.5, y: 0.8, r: 0.35, color: "6, 182, 212", speed: 0.00025, phase: 4 },
      { x: 0.1, y: 0.7, r: 0.3, color: "16, 185, 129", speed: 0.00035, phase: 1 },
    ];

    const draw = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgb(9, 9, 11)";
      ctx.fillRect(0, 0, w, h);

      orbs.forEach((orb) => {
        const cx = (orb.x + Math.sin(t * orb.speed * 1000 + orb.phase) * 0.15) * w;
        const cy = (orb.y + Math.cos(t * orb.speed * 1000 + orb.phase * 1.3) * 0.1) * h;
        const radius = orb.r * Math.min(w, h);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, `rgba(${orb.color}, 0.18)`);
        grad.addColorStop(0.5, `rgba(${orb.color}, 0.06)`);
        grad.addColorStop(1, `rgba(${orb.color}, 0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      });

      // Mesh grid lines
      ctx.strokeStyle = "rgba(52, 211, 153, 0.03)";
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      t++;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ opacity: 1 }}
    />
  );
}
