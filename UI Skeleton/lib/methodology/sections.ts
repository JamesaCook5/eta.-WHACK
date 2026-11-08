/** Methodology chapters, in reading order. Each one is its own page. */
export interface SectionMeta {
  slug: string
  title: string
  /** One line for the page description and the next/previous cards. */
  summary: string
}

export const SECTIONS: SectionMeta[] = [
  { slug: 'overview', title: 'Overview', summary: 'What the project is trying to answer.' },
  { slug: 'data', title: 'Data sources', summary: 'The asteroid catalogue and what we use from it.' },
  { slug: 'resources', title: 'Resource model', summary: 'From a spectral class to tonnes of each element.' },
  { slug: 'process-network', title: 'Process network', summary: 'How ore becomes raw material and then products.' },
  { slug: 'stations', title: 'The stations', summary: 'What a station is and what it does.' },
  { slug: 'placement', title: 'Station placement', summary: 'Where stations go and why more of them helps.' },
  { slug: 'monte-carlo', title: 'Monte Carlo', summary: 'How uncertain compositions turn into ranges.' },
  { slug: 'limits', title: 'Limitations and next steps', summary: 'What the model leaves out and what comes next.' },
]

export const sectionHref = (slug: string) => (slug === 'overview' ? '/methodology' : `/methodology/${slug}`)

export function findSection(slug: string) {
  const index = SECTIONS.findIndex((s) => s.slug === slug)
  return index < 0 ? null : { index, section: SECTIONS[index] }
}
