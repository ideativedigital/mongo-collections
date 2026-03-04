import { Box, Code, HStack, Text } from '@chakra-ui/react'

type ApiSignatureProps = {
  signature: string
  returns?: string
}

export function ApiSignature({ signature, returns }: ApiSignatureProps) {
  return (
    <Box borderWidth="1px" borderColor="whiteAlpha.300" rounded="md" p="3" bg="whiteAlpha.100" my="4">
      <HStack gap="2" wrap="wrap" alignItems="flex-start">
        <Text color="gray.300" fontSize="sm">
          Signature
        </Text>
        <Code colorPalette="blue">{signature}</Code>
        {returns ? (
          <>
            <Text color="gray.300" fontSize="sm">
              returns
            </Text>
            <Code colorPalette="green">{returns}</Code>
          </>
        ) : null}
      </HStack>
    </Box>
  )
}
