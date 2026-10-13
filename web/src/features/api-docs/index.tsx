// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useLocation, useNavigate } from '@tanstack/react-router'

import { PublicLayout } from '@/components/layout'

import { DocsWorkspace } from './workspace'

import '@/styles/api-docs.css'

export function ApiDocsPage() {
  const hash = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  let modelId = ''
  try {
    if (hash.startsWith('model/')) modelId = decodeURIComponent(hash.slice(6))
  } catch {
    modelId = hash.slice(6)
  }
  return (
    <PublicLayout showMainContainer={false}>
      <DocsWorkspace
        modelId={modelId}
        onSelect={(id) => {
          void navigate({
            to: '/docs',
            hash: id ? `model/${encodeURIComponent(id)}` : '',
            resetScroll: true,
          })
        }}
      />
    </PublicLayout>
  )
}
