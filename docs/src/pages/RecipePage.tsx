import { Box, Heading, Text } from '@chakra-ui/react'
import { MDXProvider } from '@mdx-js/react'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { DocsLayout } from '../components/DocsLayout'
import { getRecipeBySlug } from '../lib/content'
import { mdxComponents } from '../mdx-components'

export function RecipePage() {
  const { slug } = useParams<{ slug: string }>()
  const recipe = useMemo(() => getRecipeBySlug(slug ?? ''), [slug])

  if (!recipe) {
    return (
      <DocsLayout>
        <Heading size="lg" color="fg" mb="2">
          Recipe not found
        </Heading>
        <Text color="fg.muted">This recipe does not exist. Use the sidebar to open another one.</Text>
      </DocsLayout>
    )
  }

  const RecipeContent = recipe.Component

  return (
    <DocsLayout>
      <Box borderWidth="1px" borderColor="border" rounded="md" p={{ base: '4', lg: '8' }} bg="bg.subtle">
        <Heading as="h1" size="xl" color="fg" mb="2">
          {recipe.frontmatter.title}
        </Heading>
        <Text color="fg.muted" mb="6">
          {recipe.frontmatter.description}
        </Text>
        <MDXProvider components={mdxComponents}>
          <RecipeContent />
        </MDXProvider>
      </Box>
    </DocsLayout>
  )
}
