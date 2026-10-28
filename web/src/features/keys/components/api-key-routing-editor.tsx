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
import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { ROUTING_STRATEGY_LABELS as labels } from '../constants'
import type { ApiKeyFormValues } from '../lib/api-key-form'
import {
  newRoutingPolicy,
  changeRoutingStrategy,
  routingStrategies,
  routingDescriptions,
  routingDraftValid,
} from '../lib/routing-policy'
import type { KeyRoutingPolicy, RoutingStrategy } from '../types'
import { KeyRoutePicker } from './key-route-picker'
import { ModelRoutingRule, RoutingAdvanced } from './key-routing-settings'

import '@/styles/platform-market.css'
import '@/styles/key-routing.css'

export function ApiKeyRoutingEditor(props: {
  form: UseFormReturn<ApiKeyFormValues>
  models: string[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [initialDraft, setInitialDraft] = useState('')
  const [draft, setDraft] = useState<KeyRoutingPolicy>(newRoutingPolicy)
  const [restricted, setRestricted] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [active, setActive] = useState('')
  const policy = props.form.watch('routing_policy')
  const limited = props.form.watch('model_limits_enabled')
  const limits = props.form.watch('model_limits')
  const custom = policy?.mode === 'custom'
  const selectedMode = custom ? 'custom' : policy?.default_strategy
  function begin(makeCustom = false) {
    const next = structuredClone(
      policy || {
        ...newRoutingPolicy(),
        allowed_strategies: [...routingStrategies],
        allow_fixed_routes: true,
      }
    )
    if (makeCustom && next.mode !== 'custom') {
      next.version = 2
      next.mode = 'custom'
      next.model_rules = []
    }
    setInitialDraft(JSON.stringify(next))
    setDraft(next)
    setRestricted(makeCustom || limited)
    setSelected([...limits])
    setActive(limits[0] || '')
    setStep(1)
    setOpen(true)
  }
  function choose(strategy: RoutingStrategy) {
    const next = changeRoutingStrategy(policy || newRoutingPolicy(), strategy)
    next.mode = 'automatic'
    if (custom) next.model_rules = []
    props.form.setValue('routing_policy', next, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }
  function apply() {
    props.form.setValue('model_limits_enabled', restricted, {
      shouldDirty: true,
    })
    props.form.setValue('model_limits', selected, { shouldDirty: true })
    if (
      policy ||
      JSON.stringify(draft) !== initialDraft ||
      draft.mode === 'custom'
    ) {
      props.form.setValue(
        'routing_policy',
        {
          ...draft,
          model_rules: draft.model_rules.filter(
            (rule) => !restricted || selected.includes(rule.model)
          ),
        },
        { shouldDirty: true, shouldValidate: true }
      )
    }
    setOpen(false)
  }
  const valid = routingDraftValid(draft, restricted, selected)
  return (
    <SideDrawerSection>
      <SideDrawerSectionHeader
        title={t('Routing strategy')}
        description={t(
          'Choose a default. Customize models and routes when you need more control.'
        )}
      />
      <div
        className='key-strategy-grid'
        role='group'
        aria-label={t('Routing strategy')}
      >
        {[...routingStrategies, 'custom' as const].map((value) => (
          <Button
            key={value}
            type='button'
            variant='outline'
            className='key-strategy-card'
            aria-pressed={selectedMode === value}
            onClick={() => (value === 'custom' ? begin(true) : choose(value))}
          >
            <span className='key-strategy-indicator' aria-hidden />
            <span>
              <strong>
                {t(value === 'custom' ? 'Custom routes' : labels[value])}
              </strong>
              <small>{t(routingDescriptions[value])}</small>
            </span>
          </Button>
        ))}
      </div>
      {!policy && (
        <p className='text-muted-foreground text-xs'>
          {t('Keep existing routing behavior')}
        </p>
      )}
      <div className='key-routing-summary'>
        <span>
          {limited
            ? t('{{count}} models allowed', { count: limits.length })
            : t('All available models allowed')}
        </span>
        <span>
          {custom
            ? t('{{count}} routes selected', {
                count: policy.model_rules.reduce(
                  (sum, rule) => sum + (rule.route_ids?.length || 0),
                  0
                ),
              })
            : t('{{count}} model strategy rules', {
                count: policy?.model_rules.length || 0,
              })}
        </span>
        <Button type='button' variant='link' onClick={() => begin(custom)}>
          {t('Configure models and routes')}
        </Button>
      </div>
      {custom && (
        <div className='grid gap-2'>
          {policy.model_rules.map((rule) => (
            <div
              key={rule.model}
              className='flex flex-wrap justify-between gap-2 rounded-lg border px-3 py-2 text-xs'
            >
              <strong className='break-all'>{rule.model}</strong>
              <span>
                {t('{{count}} routes selected', {
                  count: rule.route_ids?.length || 0,
                })}{' '}
                ·{' '}
                {t(
                  rule.route_order === 'manual'
                    ? 'Use manual route order'
                    : labels[rule.default_strategy]
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t(
          draft.mode === 'custom' ? 'Custom model routing' : 'Model permissions'
        )}
        description={t(
          'Apply configuration, then save the key to activate changes.'
        )}
        contentClassName='key-routing-dialog'
        bodyClassName='key-routing-dialog-body'
        footer={
          <>
            <span className='text-muted-foreground mr-auto text-xs'>
              {t('{{count}} models selected', { count: selected.length })}
              {!valid && ` · ${t('Select at least one route for each model')}`}
            </span>
            <Button
              type='button'
              variant='outline'
              onClick={() => (step === 2 ? setStep(1) : setOpen(false))}
            >
              {t(step === 2 ? 'Back' : 'Cancel')}
            </Button>
            {step === 1 && draft.mode === 'custom' ? (
              <Button
                type='button'
                disabled={!valid}
                onClick={() => setStep(2)}
              >
                {t('Next: routing order')}
              </Button>
            ) : (
              <Button type='button' disabled={!valid} onClick={apply}>
                {t('Apply configuration')}
              </Button>
            )}
          </>
        }
      >
        {draft.mode === 'custom' && (
          <div className='key-routing-steps'>
            <span data-active={step === 1}>1. {t('Models and routes')}</span>
            <span data-active={step === 2}>2. {t('Routing order')}</span>
          </div>
        )}
        {draft.mode !== 'custom' && (
          <Label className='mb-5 flex items-center justify-between'>
            {t('Allow selected models only')}
            <Switch checked={restricted} onCheckedChange={setRestricted} />
          </Label>
        )}
        {step === 1 && (restricted || draft.mode === 'custom') && (
          <KeyRoutePicker
            policy={draft}
            models={selected}
            eligible={props.models.map((model) =>
              model.replace(/^platform-media:/, '')
            )}
            activeModel={active}
            onActiveModel={setActive}
            onChange={(next, models) => {
              setDraft(next)
              setSelected(models)
            }}
          />
        )}
        {step === 2 && (
          <div className='grid gap-4 lg:grid-cols-2'>
            {selected.map((model) => (
              <ModelRoutingRule
                key={model}
                model={model}
                policy={draft}
                onChange={setDraft}
              />
            ))}
          </div>
        )}
        {draft.mode !== 'custom' &&
          draft.model_rules
            .filter((rule) => !restricted || selected.includes(rule.model))
            .map((rule) => (
              <ModelRoutingRule
                key={rule.model}
                model={rule.model}
                policy={draft}
                onChange={setDraft}
              />
            ))}
        {(draft.mode !== 'custom' || step === 2) && (
          <div className='mt-5'>
            <RoutingAdvanced
              fixedOnly={draft.mode === 'custom'}
              policy={draft}
              onChange={setDraft}
            />
          </div>
        )}
        <p className='text-muted-foreground mt-4 text-xs'>
          {t(
            'Unavailable routes are skipped. If no selected route works, the request fails without using an unselected route.'
          )}
        </p>
      </Dialog>
    </SideDrawerSection>
  )
}
