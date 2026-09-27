/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import {
  buildCCSwitchURL,
  ccSwitchServerAddress,
  loadCCSwitchModels,
} from '../../lib/cc-switch'

const APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: 'My Claude',
    modelFields: [
      { key: 'model', labelKey: 'Primary Model', required: true },
      { key: 'haikuModel', labelKey: 'Haiku Model', required: false },
      { key: 'sonnetModel', labelKey: 'Sonnet Model', required: false },
      { key: 'opusModel', labelKey: 'Opus Model', required: false },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'My Codex',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'My Gemini',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
} as const

type AppType = keyof typeof APP_CONFIGS

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenId: number
  tokenKey: string
}

export function CCSwitchDialog(props: Props) {
  const { t } = useTranslation()
  const [app, setApp] = useState<AppType>('claude')
  const [name, setName] = useState<string>(APP_CONFIGS.claude.defaultName)
  const [models, setModels] = useState<Record<string, string>>({})

  const modelQuery = useQuery({
    queryKey: ['ccswitch-models', props.tokenId],
    queryFn: ({ signal }) => loadCCSwitchModels(props.tokenKey, signal),
    enabled: props.open && Boolean(props.tokenKey),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
  })

  const modelOptions = useMemo(
    () =>
      (modelQuery.data ?? [])
        .filter((model) => model.apps.includes(app))
        .map((model) => ({ value: model.id, label: model.id })),
    [modelQuery.data, app]
  )
  const canImport =
    modelQuery.isSuccess &&
    !modelQuery.isFetching &&
    Boolean(models.model) &&
    Boolean(name.trim()) &&
    Object.values(models)
      .filter(Boolean)
      .every((model) => modelOptions.some((option) => option.value === model))

  useEffect(() => {
    if (props.open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModels({})

      setApp('claude')

      setName(APP_CONFIGS.claude.defaultName)
    }
  }, [props.open])

  const currentConfig = APP_CONFIGS[app]

  const handleAppChange = (val: string) => {
    const appVal = val as AppType
    setApp(appVal)
    setName(APP_CONFIGS[appVal].defaultName)
    setModels({})
  }

  const handleSubmit = () => {
    if (!models.model) {
      toast.warning(t('Please select a primary model'))
      return
    }
    if (!canImport) return
    const url = buildCCSwitchURL(app, name.trim(), models, props.tokenKey)
    window.open(url, '_blank')
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import to CC Switch')}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName={
        currentConfig.modelFields.length === 1 ? 'space-y-4 pb-52' : 'space-y-4'
      }
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canImport}>
            {t('Open CC Switch')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='text-muted-foreground text-sm break-all'>
          {t('API Endpoint')}: {ccSwitchServerAddress()}
          {app === 'codex' ? '/v1' : ''}
        </div>
        <div className='space-y-2'>
          <Label>{t('Application')}</Label>
          <RadioGroup
            value={app}
            onValueChange={handleAppChange}
            className='flex gap-4'
          >
            {(
              Object.entries(APP_CONFIGS) as [
                AppType,
                (typeof APP_CONFIGS)[AppType],
              ][]
            ).map(([key, cfg]) => (
              <div key={key} className='flex items-center gap-2'>
                <RadioGroupItem value={key} id={`app-${key}`} />
                <Label htmlFor={`app-${key}`} className='cursor-pointer'>
                  {cfg.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='cc-switch-name'>{t('Name')}</Label>
          <ComboboxInput
            id='cc-switch-name'
            options={[]}
            value={name}
            onValueChange={setName}
            placeholder={currentConfig.defaultName}
            emptyText=''
            allowCustomValue
          />
        </div>

        {modelQuery.isFetching && (
          <LoadingState
            inline
            message={t('Verifying API key and available models...')}
          />
        )}
        {modelQuery.isError && (
          <ErrorState
            className='min-h-0'
            description={t(modelQuery.error.message)}
            onRetry={() => {
              void modelQuery.refetch()
            }}
          />
        )}
        {modelQuery.isSuccess &&
          !modelQuery.isFetching &&
          modelOptions.length === 0 && (
            <p className='text-muted-foreground text-sm'>
              {t(
                'No compatible models are available for this application and API key.'
              )}
            </p>
          )}
        {currentConfig.modelFields.map((field) => (
          <div key={field.key} className='space-y-2'>
            <Label htmlFor={`cc-switch-${field.key}`} required={field.required}>
              {t(field.labelKey)}
            </Label>
            <ComboboxInput
              id={`cc-switch-${field.key}`}
              options={modelOptions}
              value={models[field.key] || ''}
              onValueChange={(v) =>
                setModels((prev) => ({ ...prev, [field.key]: v }))
              }
              placeholder={t('Select or enter model name')}
              emptyText={t('No models found')}
            />
          </div>
        ))}
        <p className='text-muted-foreground text-sm'>
          {t(
            'After importing on your computer, enable this provider in CC Switch. Re-import after replacing an API key.'
          )}
        </p>
      </div>
    </Dialog>
  )
}
