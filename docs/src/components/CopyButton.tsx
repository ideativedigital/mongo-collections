import { Button } from '@chakra-ui/react'
import { useState } from 'react'

type CopyButtonProps = {
  value: string
}

export function CopyButton({ value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Button
      size="xs"
      variant="outline"
      onClick={onCopy}
      aria-label="Copy code block"
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}
