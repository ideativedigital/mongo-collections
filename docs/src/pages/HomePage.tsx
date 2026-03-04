import { Box, Heading, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { DocsLayout } from '../components/DocsLayout'
import { RecipeCard } from '../components/RecipeCard'
import { getAllRecipes } from '../lib/content'

export function HomePage() {
  const recipes = getAllRecipes()

  return (
    <DocsLayout>
      <Stack gap="6">
        <Box>
          <Heading as="h1" size="2xl" color="fg" mb="2">
            mongo-collections recipes
          </Heading>
          <Text color="fg.muted" maxW="3xl">
            Practical recipes showing how to use every part of the library, with copy-ready snippets.
          </Text>
        </Box>
        <SimpleGrid columns={{ base: 1, xl: 2 }} gap="4">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.slug} recipe={recipe} />
          ))}
        </SimpleGrid>
      </Stack>
    </DocsLayout>
  )
}
