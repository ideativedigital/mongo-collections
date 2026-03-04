import { Alert, Box } from '@chakra-ui/react'
import type { ReactNode } from 'react'

type CalloutProps = {
  status?: 'info' | 'warning' | 'success' | 'error' | 'neutral'
  children: ReactNode
}

export function Callout({ status = 'info', children }: CalloutProps) {
  return (
    <Alert.Root status={status} my="4" rounded="md">
      <Alert.Indicator />
      <Box>{children}</Box>
    </Alert.Root>
  )
}
