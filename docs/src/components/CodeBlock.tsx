import { Box, Flex, Text } from '@chakra-ui/react'
import { Children, type ReactNode } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { CopyButton } from './CopyButton'

type PreProps = {
  children: ReactNode
}

const getCodeNode = (children: ReactNode) => {
  const child = Children.toArray(children)[0] as
    | {
        props?: {
          className?: string
          children?: ReactNode
        }
      }
    | undefined
  return child
}

export function CodeBlock({ children }: PreProps) {
  const codeNode = getCodeNode(children)
  const className = codeNode?.props?.className ?? ''
  const language = className.replace('language-', '') || 'text'
  const content = String(codeNode?.props?.children ?? '').replace(/\n$/, '')
  const style = oneDark

  return (
    <Box borderWidth="1px" borderColor="gray.700" rounded="md" overflow="hidden" my="5" bg="gray.900">
      <Flex
        alignItems="center"
        justifyContent="space-between"
        px="3"
        py="2"
        bg="bg.muted"
        borderBottomWidth="1px"
        borderBottomColor="border"
      >
        <Text fontSize="xs" color="fg.muted" textTransform="uppercase" letterSpacing="0.04em">
          {language}
        </Text>
        <CopyButton value={content} />
      </Flex>
      <Box
        className="docs-code-block"
        m="0"
        px="0"
        py="0"
        overflowX="auto"
        fontSize="sm"
        bg="gray.900"
      >
        <SyntaxHighlighter
          language={language}
          style={style}
          customStyle={{ margin: 0, padding: '1rem', background: 'transparent' }}
          codeTagProps={{ style: { background: 'transparent' } }}
          wrapLongLines
        >
          {content}
        </SyntaxHighlighter>
      </Box>
    </Box>
  )
}
