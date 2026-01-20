import React, { useEffect, useState } from 'react'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { getRouter } from '@/router'

export default function RouterDevtools() {
  const [router, setRouter] = useState<any | null>(null)

  useEffect(() => {
    let mounted = true
    try {
      const r = getRouter()
      if (mounted) setRouter(r as any)
    } catch (e) {
      // ignore in environments where router isn't available
    }
    return () => {
      mounted = false
    }
  }, [])

  if (!router) return null
  return <TanStackRouterDevtools router={router} position="bottom-left" />
}
