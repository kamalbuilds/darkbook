"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

const nodes = [
  { id: "trader", label: "Trader", sublabel: "Phantom Wallet", x: 50, y: 50, color: "#34d399" },
  { id: "er", label: "MagicBlock ER", sublabel: "Sub-50ms Matching", x: 250, y: 50, color: "#a78bfa" },
  { id: "pyth", label: "Pyth Lazer", sublabel: "Sub-1ms Oracle", x: 250, y: 200, color: "#22d3ee" },
  { id: "settlement", label: "Settlement", sublabel: "Anchor Program", x: 450, y: 50, color: "#34d399" },
  { id: "position", label: "Position", sublabel: "On-chain PDA", x: 450, y: 200, color: "#f59e0b" },
];

const edges = [
  { from: "trader", to: "er", label: "Place Order (ECIES encrypted)", animated: true },
  { from: "er", to: "settlement", label: "Match proof → Jito bundle", animated: true },
  { from: "pyth", to: "settlement", label: "Mark price feed", animated: false },
  { from: "settlement", to: "position", label: "Create PositionAccount", animated: true },
  { from: "pyth", to: "position", label: "Liquidation oracle", animated: false },
];

export function ArchitectureDiagram() {
  const svgRef = useRef<SVGSVGElement>(null);

  const getCenter = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return { x: 0, y: 0 };
    return { x: node.x + 60, y: node.y + 22 };
  };

  return (
    <section className="py-24 px-6 bg-zinc-950/50 relative overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/60 px-4 py-1.5 text-xs font-mono text-zinc-400 mb-6">
            ARCHITECTURE
          </div>
          <h2 className="font-mono font-bold text-4xl md:text-5xl text-zinc-100 tracking-tight mb-4">
            How DarkBook works
          </h2>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            End-to-end data flow from encrypted order placement to on-chain settlement.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-8 overflow-x-auto"
        >
          <svg
            ref={svgRef}
            viewBox="0 0 560 280"
            className="w-full max-w-3xl mx-auto"
            style={{ minWidth: 480 }}
          >
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#52525b" />
              </marker>
              <marker id="arrowhead-animated" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="#34d399" />
              </marker>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Edges */}
            {edges.map((edge, i) => {
              const from = getCenter(edge.from);
              const to = getCenter(edge.to);
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2 - 15;
              const d = `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;

              return (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke={edge.animated ? "#34d399" : "#3f3f46"}
                    strokeWidth={edge.animated ? "1.5" : "1"}
                    strokeOpacity={edge.animated ? 0.4 : 0.3}
                    markerEnd={edge.animated ? "url(#arrowhead-animated)" : "url(#arrowhead)"}
                  />
                  {edge.animated && (
                    <path
                      d={d}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth="2"
                      strokeOpacity="0.8"
                      strokeDasharray="6 18"
                      markerEnd="url(#arrowhead-animated)"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="24"
                        to="0"
                        dur={`${1.2 + i * 0.2}s`}
                        repeatCount="indefinite"
                      />
                    </path>
                  )}
                  <text
                    x={mx}
                    y={my - 4}
                    textAnchor="middle"
                    fill="#52525b"
                    fontSize="8"
                    fontFamily="monospace"
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((node, i) => (
              <g key={node.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width="120"
                  height="44"
                  rx="8"
                  fill="#18181b"
                  stroke={node.color}
                  strokeWidth="1.5"
                  strokeOpacity="0.5"
                  filter="url(#glow)"
                />
                <text
                  x={node.x + 60}
                  y={node.y + 17}
                  textAnchor="middle"
                  fill={node.color}
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  {node.label}
                </text>
                <text
                  x={node.x + 60}
                  y={node.y + 31}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  {node.sublabel}
                </text>
              </g>
            ))}
          </svg>
        </motion.div>

        {/* Flow description */}
        <div className="mt-10 grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { step: "01", title: "Place", desc: "Encrypted order submitted to ER" },
            { step: "02", title: "Match", desc: "CLOB matching in <50ms on ER" },
            { step: "03", title: "Proof", desc: "Match proof via Jito bundle" },
            { step: "04", title: "Price", desc: "Pyth Lazer mark price verify" },
            { step: "05", title: "Settle", desc: "PositionAccount created on-chain" },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="text-2xl font-mono font-bold text-zinc-700 mb-1">{s.step}</div>
              <div className="text-sm font-mono font-semibold text-zinc-300 mb-1">{s.title}</div>
              <div className="text-xs text-zinc-500">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
