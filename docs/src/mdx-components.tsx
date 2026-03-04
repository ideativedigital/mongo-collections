import { Heading, Link, List, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ApiSignature } from './components/ApiSignature'
import { Callout } from './components/Callout'
import { CodeBlock } from './components/CodeBlock'

type ComponentProps = Record<string, unknown>

export const mdxComponents = {
  h1: (props: ComponentProps) => <Heading as="h1" size="xl" mb="4" mt="2" color="fg" {...props} />,
  h2: (props: ComponentProps) => <Heading as="h2" size="lg" mb="3" mt="8" color="fg" {...props} />,
  h3: (props: ComponentProps) => <Heading as="h3" size="md" mb="2" mt="6" color="fg" {...props} />,
  p: (props: ComponentProps) => <Text mb="4" color="fg" lineHeight="tall" {...props} />,
  ul: (props: ComponentProps) => <List.Root mb="4" pl="5" color="fg" {...props} />,
  ol: (props: ComponentProps) => <List.Root as="ol" mb="4" pl="5" color="fg" {...props} />,
  li: (props: ComponentProps) => <List.Item mb="1" {...props} />,
  a: (props: { href?: string } & ComponentProps) => {
    const href = props.href ?? '#'
    if (href.startsWith('http')) {
      return <Link color="blue.fg" href={href} target="_blank" rel="noreferrer" {...props} />
    }
    return (
      <Link asChild color="blue.fg">
        <RouterLink to={href} {...props} />
      </Link>
    )
  },
  pre: (props: ComponentProps) => <CodeBlock>{props.children as ReactNode}</CodeBlock>,
  Callout,
  ApiSignature,
}
