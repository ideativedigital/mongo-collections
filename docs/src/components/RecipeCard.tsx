import { Badge, HStack, LinkBox, LinkOverlay, Stack, Text } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import type { RecipeDoc } from '../lib/content'

type RecipeCardProps = {
  recipe: RecipeDoc
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  return (
    <LinkBox
      as="article"
      borderWidth="1px"
      borderColor="border"
      rounded="md"
      bg="bg.subtle"
      p="4"
    >
      <Stack gap="3">
        <Stack gap="1">
          <LinkOverlay asChild>
            <RouterLink to={`/recipe/${recipe.slug}`}>
              <Text fontSize="lg" fontWeight="semibold" color="fg">
                {recipe.frontmatter.title}
              </Text>
            </RouterLink>
          </LinkOverlay>
          <Text color="fg.muted">{recipe.frontmatter.description}</Text>
        </Stack>
        <HStack wrap="wrap" gap="2">
          <Badge colorPalette="blue">{recipe.frontmatter.category}</Badge>
          {recipe.frontmatter.difficulty ? (
            <Badge colorPalette="purple">{recipe.frontmatter.difficulty}</Badge>
          ) : null}
          {(recipe.frontmatter.tags ?? []).map((tag) => (
            <Badge key={tag} colorPalette="teal" variant="subtle">
              {tag}
            </Badge>
          ))}
        </HStack>
      </Stack>
    </LinkBox>
  )
}
