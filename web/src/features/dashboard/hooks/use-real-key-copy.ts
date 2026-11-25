// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchTokenKey } from '@/features/keys/api'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { handleServerError } from '@/lib/handle-server-error'

/**
 * Copies a snippet built with the real key of one API key. The key is read on
 * demand, passed straight to the clipboard and never kept in state or logs.
 */
export function useRealKeyCopy(keyId?: number) {
  const { t } = useTranslation()
  const [copying, setCopying] = useState(false)
  const { copyToClipboard } = useCopyToClipboard({ notify: false })
  const copy = async (build: (apiKey: string) => string) => {
    if (!keyId || copying) return
    setCopying(true)
    try {
      const result = await fetchTokenKey(keyId)
      const key = result.success && result.data?.key ? result.data.key : ''
      if (!key) {
        handleServerError(result, t('Failed to copy to clipboard'))
        return
      }
      if (await copyToClipboard(build(`sk-${key}`))) {
        toast.success(t('Copied to clipboard'))
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
    } finally {
      setCopying(false)
    }
  }
  return { copy, copying }
}
