import type { ComponentType } from 'react'

export type RecipeFrontmatter = {
  title: string
  description: string
  category: string
  tags?: string[]
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  updatedAt?: string
}

export type RecipeDoc = {
  slug: string
  frontmatter: RecipeFrontmatter
  Component: ComponentType
}

type RecipeModule = {
  default: ComponentType
  frontmatter: RecipeFrontmatter
}

const modules = import.meta.glob<RecipeModule>('../../content/**/*.mdx', {
  eager: true,
})

const RECIPE_ORDER: string[] = [
  'getting-started',
  'collection-recipes',
  'model-mapping-recipes',
  'substituer-recipes',
  'mongo-resource-recipes',
  'gridfs-recipes',
  'error-handling-recipes',
]

const toSlug = (filePath: string): string => {
  const fileName = filePath.split('/').pop() ?? ''
  return fileName.replace(/\.mdx$/, '')
}

const recipeDocs: RecipeDoc[] = Object.entries(modules)
  .map(([filePath, module]) => ({
    slug: toSlug(filePath),
    frontmatter: module.frontmatter,
    Component: module.default,
  }))
  .sort((a, b) => {
    const ai = RECIPE_ORDER.indexOf(a.slug)
    const bi = RECIPE_ORDER.indexOf(b.slug)
    if (ai === -1 && bi === -1) return a.frontmatter.title.localeCompare(b.frontmatter.title)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

export const getAllRecipes = (): RecipeDoc[] => recipeDocs

export const getRecipeBySlug = (slug: string): RecipeDoc | undefined =>
  recipeDocs.find((recipe) => recipe.slug === slug)

export const getRecipesByCategory = (): Record<string, RecipeDoc[]> =>
  recipeDocs.reduce<Record<string, RecipeDoc[]>>((acc, recipe) => {
    const category = recipe.frontmatter.category
    if (!acc[category]) acc[category] = []
    acc[category].push(recipe)
    return acc
  }, {})
