// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// New file: turn the account's API management key on or off, reset it and
// show it once. The key only reaches the /v1/keys endpoints listed here.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'
import { portalPublicApiOrigin } from '@/lib/portal-runtime'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  deleteManagementKey,
  getManagementKeyStatus,
  rotateManagementKey,
} from '../../api'

const STATUS_QUERY_KEY = ['management-key-status']

function formatTime(value: string | null, fallback: string): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : fallback
}

export function ManagementKeyDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [freshKey, setFreshKey] = useState('')
  const [confirmation, setConfirmation] = useState<'reset' | 'close' | null>(
    null
  )
  // However the dialog closes, the one-time key is gone when it reopens.
  const [wasOpen, setWasOpen] = useState(props.open)
  if (props.open !== wasOpen) {
    setWasOpen(props.open)
    if (!props.open) setFreshKey('')
  }
  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async () => requireServerSuccess(await getManagementKeyStatus()),
    enabled: props.open,
    staleTime: 0,
  })
  const rotate = useMutation({
    mutationFn: async () => requireServerSuccess(await rotateManagementKey()),
    onSuccess: (result) => {
      setFreshKey(result.data?.key || '')
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    },
    onError: (error) =>
      handleServerError(error, t('Failed to generate the management key')),
  })
  const revoke = useMutation({
    mutationFn: async () => requireServerSuccess(await deleteManagementKey()),
    onSuccess: () => {
      setFreshKey('')
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    },
    onError: (error) =>
      handleServerError(error, t('Failed to close the management key')),
  })
  const endpoints: Array<[string, string]> = [
    ['GET /v1/keys', t('List keys')],
    ['POST /v1/keys', t('Create a key')],
    ['GET /v1/keys/{id}', t('View a key')],
    ['POST /v1/keys/{id}', t('Change a key')],
    ['DELETE /v1/keys/{id}', t('Delete a key')],
    ['GET /v1/keys/available-routes', t('Models and routes a key can use')],
  ]
  const pending = rotate.isPending || revoke.isPending
  const current = status.data?.data
  const enabled = current?.enabled === true
  const base = `${portalPublicApiOrigin()}/v1`
  const curl = `curl -s "${base}/keys" \\\n  -H "Authorization: Bearer $MANAGEMENT_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"ci-bot","quota":{"unlimited":false,"limit":100}}'`

  const close = (open: boolean) => {
    if (!open) props.onOpenChange(false)
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={close}
        title={t('Manage keys via API')}
        description={t(
          'One management key lets your own server-side programs create, view, change and delete the API keys of this account. Never give it to AI tools or put it in browser code.'
        )}
        contentClassName='sm:max-w-xl'
        footer={<Button onClick={() => close(false)}>{t('Close')}</Button>}
      >
        <div className='flex flex-col gap-4'>
          {status.isPending && <LoadingState inline />}
          {status.isError && (
            <ErrorState
              className='min-h-0'
              title={t('Failed to load the management key')}
              onRetry={() => void status.refetch()}
            />
          )}
          {current && (
            <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3'>
              <div className='min-w-0'>
                <Label htmlFor='management-key-switch'>
                  {t('API management key')}
                </Label>
                <p className='text-muted-foreground mt-1 text-xs break-all'>
                  {enabled
                    ? t('{{key}} · created {{created}} · last used {{used}}', {
                        key: current.masked_key,
                        created: formatTime(current.created_at, '—'),
                        used: formatTime(current.last_used_at, t('Never')),
                      })
                    : t('Off. No management key exists for this account.')}
                </p>
              </div>
              <div className='flex items-center gap-2'>
                {enabled && (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={pending}
                    onClick={() => setConfirmation('reset')}
                  >
                    {t('Reset key')}
                  </Button>
                )}
                <Switch
                  id='management-key-switch'
                  checked={enabled}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    checked ? rotate.mutate() : setConfirmation('close')
                  }
                />
              </div>
            </div>
          )}
          {freshKey && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='fresh-management-key'>
                {t('Copy it now; this key is shown only once')}
              </Label>
              <div className='flex gap-2'>
                <Input
                  id='fresh-management-key'
                  value={freshKey}
                  readOnly
                  autoComplete='off'
                  className='font-mono text-xs'
                />
                <CopyButton
                  value={freshKey}
                  variant='outline'
                  aria-label={t('Copy management key')}
                />
              </div>
            </div>
          )}
          <Alert variant='destructive'>
            <AlertTitle>{t('What this key can do')}</AlertTitle>
            <AlertDescription>
              {t(
                'Whoever holds it can create keys, change their quota, IP whitelist, expiry and routing, and delete keys of this account. It cannot call models, read the balance or recharge. Keep it out of code repositories and reset it at once if it leaks.'
              )}
            </AlertDescription>
          </Alert>
          <section aria-labelledby='management-key-endpoints'>
            <h4
              id='management-key-endpoints'
              className='mb-2 text-sm font-medium'
            >
              {t('Endpoints it can call')}
            </h4>
            <ul className='grid gap-1'>
              {endpoints.map(([endpoint, label]) => (
                <li
                  key={endpoint}
                  className='flex flex-wrap items-center gap-x-3 text-xs'
                >
                  <code className='font-mono'>{endpoint}</code>
                  <span className='text-muted-foreground'>{label}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className='overflow-hidden rounded-lg border'>
            <div className='bg-muted/30 flex items-center justify-between gap-2 border-b px-3 py-1.5'>
              <span className='text-xs font-medium'>
                {t('Example: create a key')}
              </span>
              <CopyButton
                value={curl}
                size='sm'
                aria-label={t('Copy example')}
              />
            </div>
            <pre className='overflow-auto p-3 text-xs leading-5'>
              <code>{curl}</code>
            </pre>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
        title={
          confirmation === 'close'
            ? t('Turn off the management key?')
            : t('Reset the management key?')
        }
        desc={t(
          'The current management key stops working at once, and scripts using it will fail.'
        )}
        confirmText={confirmation === 'close' ? t('Turn off') : t('Reset key')}
        destructive
        isLoading={pending}
        handleConfirm={() => {
          if (confirmation === 'close') revoke.mutate()
          else rotate.mutate()
          setConfirmation(null)
        }}
      />
    </>
  )
}
