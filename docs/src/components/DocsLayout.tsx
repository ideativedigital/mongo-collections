import { Box, Container, Heading, HStack, Link, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { getRecipesByCategory } from '../lib/content'

type DocsLayoutProps = {
  children: ReactNode
}

export function DocsLayout({ children }: DocsLayoutProps) {
  const categories = getRecipesByCategory()

  return (
    <Container maxW="8xl" py="8" color="fg" bg="bg" minH="100vh">
      <HStack alignItems="flex-start" gap="6">
        <Box
          as="aside"
          w={{ base: 'full', lg: '300px' }}
          borderWidth="1px"
          borderColor="border"
          rounded="md"
          p="4"
          bg="bg.subtle"
          position={{ lg: 'sticky' }}
          top="4"
          alignSelf="flex-start"
        >
          <Stack gap="4">
            <Stack gap="1">
              <Heading as="h2" size="md" color="fg">
                mongo-collections docs
              </Heading>
              <Text color="fg.muted" fontSize="sm">
                Recipe-first guides with copyable snippets
              </Text>
            </Stack>
            <Link asChild color="blue.fg" fontWeight="medium">
              <RouterLink to="/recipes">All recipes</RouterLink>
            </Link>
            {Object.entries(categories).map(([category, recipes]) => (
              <Box key={category}>
                <Text fontSize="sm" color="fg.muted" mb="2">
                  {category}
                </Text>
                <Stack gap="1">
                  {recipes.map((recipe) => (
                    <Link key={recipe.slug} asChild color="fg" fontSize="sm">
                      <RouterLink to={`/recipe/${recipe.slug}`}>{recipe.frontmatter.title}</RouterLink>
                    </Link>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>

        <Box as="main" flex="1" minW="0">
          {children}
        </Box>
      </HStack>
    </Container>
  )
}
