/**
 * The first two levels of the process network for one ore, exactly as they are in
 * Asteroid_Chemical_DAG-2.json. Nodes are materials, edges are processes.
 *
 *   leach_olivine           ore_olivine → mixed_chloride_leachate + silica_leach_residue + leach_refractory_residue
 *   MRE_olivine             ore_olivine → MRE_mixed_metal_candidate + O2_MRE_candidate + MRE_slag
 *   oxidise_dissolved_iron  mixed_chloride_leachate → oxidised_leachate
 *   dissolve_silica_in_alkali silica_leach_residue → sodium_silicate_liquor + silica_purification_reject
 *   assay_refinery_residue  leach_refractory_residue → precious_metal_residue_candidate
 *
 * Dotted stubs mark the materials that feed further processes.
 */

const R = 34
const Y = [52, 200, 348]

const NODES = {
  olivine: { x: 320, y: Y[0], lines: ['Olivine'], more: false },
  liquor: { x: 150, y: Y[1], lines: ['Metal', 'liquor'], more: false },
  residue: { x: 290, y: Y[1], lines: ['Silica', 'residue'], more: false },
  leftover: { x: 430, y: Y[1], lines: ['Leftover', 'residue'], more: false },
  oxidised: { x: 120, y: Y[2], lines: ['Oxidised', 'liquor'], more: true },
  silicate: { x: 260, y: Y[2], lines: ['Sodium', 'silicate'], more: true },
  reject: { x: 370, y: Y[2], lines: ['Silica', 'reject'], more: false },
  precious: { x: 480, y: Y[2], lines: ['Precious', 'metals'], more: false },
} as const

type Id = keyof typeof NODES

const PROCESSES: { name: string; from: Id; to: Id[]; at: [number, number]; anchor: 'start' | 'end' }[] = [
  { name: 'Leach with acid', from: 'olivine', to: ['liquor', 'residue', 'leftover'], at: [240, 112], anchor: 'end' },
  { name: 'Oxidise iron', from: 'liquor', to: ['oxidised'], at: [148, 280], anchor: 'start' },
  { name: 'Dissolve', from: 'residue', to: ['silicate', 'reject'], at: [342, 280], anchor: 'start' },
  { name: 'Assay', from: 'leftover', to: ['precious'], at: [466, 278], anchor: 'start' },
]

/** The ore's other first process, cut short. */
const OTHER = { name: 'Melt and electrolyse', to: { x: 560, y: Y[1] } }

function edge(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  return { x1: a.x + ux * (R + 3), y1: a.y + uy * (R + 3), x2: b.x - ux * (R + 6), y2: b.y - uy * (R + 6) }
}

export function ChainDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 640 440"
        className="mx-auto block h-auto w-full max-w-[38rem] min-w-[30rem]"
        role="img"
        aria-label="The first two levels for olivine. Leaching with acid gives a metal liquor, a silica residue and a leftover residue; it can also be melted and electrolysed. The liquor is oxidised, the silica residue is dissolved into sodium silicate and a reject, and the leftover is assayed for precious metals. The oxidised liquor and the sodium silicate go on to further steps."
        style={{ fontFamily: 'var(--font-inter), sans-serif' }}
      >
        <defs>
          <marker id="dag-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#ffffff" />
          </marker>
        </defs>

        {PROCESSES.map((p) => (
          <g key={p.name}>
            {p.to.map((t) => (
              <line key={t} {...edge(NODES[p.from], NODES[t])} stroke="#ffffff" strokeWidth="1.6" markerEnd="url(#dag-head)" />
            ))}
            <text x={p.at[0]} y={p.at[1]} textAnchor={p.anchor} fontSize="13.5" fontStyle="italic" fill="#ffffff">
              {p.name}
            </text>
          </g>
        ))}

        <line {...edge(NODES.olivine, OTHER.to)} x2={OTHER.to.x - 16} y2={OTHER.to.y - 12} stroke="#ffffff" strokeWidth="1.6" markerEnd="url(#dag-head)" />
        <text x={OTHER.to.x - 4} y={OTHER.to.y + 8} fontSize="22" fill="#ffffff">
          …
        </text>
        <text x="426" y="104" fontSize="13.5" fontStyle="italic" fill="#ffffff">
          {OTHER.name}
        </text>

        {/* Where the graph carries on. */}
        {(Object.keys(NODES) as Id[])
          .filter((id) => NODES[id].more)
          .map((id) => {
            const n = NODES[id]
            return <line key={id} x1={n.x} y1={n.y + R + 4} x2={n.x} y2={n.y + R + 40} stroke="#ffffff" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" />
          })}

        {(Object.keys(NODES) as Id[]).map((id) => {
          const n = NODES[id]
          const ore = id === 'olivine'
          return (
            <g key={id}>
              <circle cx={n.x} cy={n.y} r={R} fill={ore ? '#2a2014' : '#0f1621'} stroke={ore ? '#f2b866' : '#ffffff'} strokeWidth={ore ? 2.5 : 1.5} />
              {n.lines.map((line, j) => (
                <text
                  key={line}
                  x={n.x}
                  y={n.y + 5 + (j - (n.lines.length - 1) / 2) * 15}
                  textAnchor="middle"
                  fontSize={line.length > 7 ? 11.5 : 13}
                  fontWeight="500"
                  fill="#fff"
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })}

        <text x="630" y="424" textAnchor="end" fontSize="13" fill="#ffffff">
          …and on, up to 125 steps deep
        </text>
      </svg>
    </div>
  )
}
