declare module '*.mdx' {
  import type { ComponentType } from 'react'
  import type { RecipeFrontmatter } from '../lib/content'

  const frontmatter: RecipeFrontmatter
  const Component: ComponentType
  export { frontmatter }
  export default Component
}
