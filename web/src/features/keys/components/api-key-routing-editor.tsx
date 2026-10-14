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
import { useId, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'

import { ROUTING_STRATEGY_LABELS as labels } from '../constants'
import type { ApiKeyFormValues } from '../lib/api-key-form'
import type { KeyRoutingPolicy, RoutingStrategy } from '../types'

const strategies: RoutingStrategy[] = [
  'balanced',
  'cheapest',
  'fastest',
  'most_reliable',
]
const initialPolicy = (): KeyRoutingPolicy => ({
  version: 1,
  default_strategy: 'balanced',
  allowed_strategies: [...strategies],
  allow_fixed_routes: false,
  model_rules: [],
})

type StrategyProps = {
  value: RoutingStrategy
  allowed: RoutingStrategy[]
  onChange: (value: RoutingStrategy) => void
  label: string
}
function StrategySelect(props: StrategyProps) {
  const { t } = useTranslation()
  return (
    <NativeSelect
      aria-label={props.label}
      value={props.value}
      onChange={(event) =>
        props.onChange(event.target.value as RoutingStrategy)
      }
      className='w-full'
    >
      {props.allowed.map((strategy) => (
        <NativeSelectOption key={strategy} value={strategy}>
          {t(labels[strategy])}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
function StrategyPermissions(props: {
  value: RoutingStrategy[]
  onChange: (value: RoutingStrategy[]) => void
  label: string
}) {
  const { t } = useTranslation()
  return (
    <div
      role='group'
      aria-label={props.label}
      className='grid grid-cols-2 gap-3'
    >
      {strategies.map((strategy) => (
        <Label
          key={strategy}
          className='flex items-center gap-2 text-sm font-normal'
        >
          <Checkbox
            checked={props.value.includes(strategy)}
            disabled={
              props.value.length === 1 && props.value.includes(strategy)
            }
            onCheckedChange={(checked) =>
              props.onChange(
                checked
                  ? [...props.value, strategy]
                  : props.value.filter((item) => item !== strategy)
              )
            }
          />
          {t(labels[strategy])}
        </Label>
      ))}
    </div>
  )
}
export function ApiKeyRoutingEditor(props: {
  form: UseFormReturn<ApiKeyFormValues>
  models: string[]
}) {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<KeyRoutingPolicy>(initialPolicy)
  const [restricted, setRestricted] = useState(false)
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [ruleModel, setRuleModel] = useState('')
  const policy = props.form.watch('routing_policy')
  const limited = props.form.watch('model_limits_enabled')
  const limits = props.form.watch('model_limits')
  const models = [
    ...new Set([
      ...props.models.map((model) => model.replace(/^platform-media:/, '')),
      ...limits,
    ]),
  ].sort()
  const ruleModels = restricted ? selectedModels : models
  const editedRule = draft.model_rules.find((rule) => rule.model === ruleModel)
  const effective = editedRule ?? draft
  const begin = () => {
    setDraft(
      structuredClone(
        policy ?? { ...initialPolicy(), allow_fixed_routes: true }
      )
    )
    setRestricted(limited)
    setSelectedModels([...limits])
    setRuleModel('')
    setOpen(true)
  }
  const updateRule = (
    allowed: RoutingStrategy[],
    defaultStrategy: RoutingStrategy
  ) => {
    if (!ruleModel) return
    setDraft({
      ...draft,
      model_rules: [
        ...draft.model_rules.filter((rule) => rule.model !== ruleModel),
        {
          model: ruleModel,
          allowed_strategies: allowed,
          default_strategy: defaultStrategy,
        },
      ],
    })
  }
  const apply = () => {
    props.form.setValue('model_limits_enabled', restricted, {
      shouldDirty: true,
    })
    props.form.setValue('model_limits', selectedModels, { shouldDirty: true })
    props.form.setValue(
      'routing_policy',
      {
        ...draft,
        model_rules: draft.model_rules.filter(
          (rule) => !restricted || selectedModels.includes(rule.model)
        ),
      },
      { shouldDirty: true, shouldValidate: true }
    )
    setOpen(false)
  }
  return (
    <SideDrawerSection>
      <SideDrawerSectionHeader
        title={t('Routing and model permissions')}
        description={t('Choose how this key selects compatible channels.')}
      />
      <Label htmlFor={id}>{t('Default routing strategy')}</Label>
      <NativeSelect
        id={id}
        className='w-full'
        value={policy?.default_strategy ?? ''}
        onChange={(event) => {
          const next = structuredClone(policy ?? initialPolicy())
          next.default_strategy = event.target.value as RoutingStrategy
          props.form.setValue('routing_policy', next, { shouldDirty: true })
        }}
      >
        {!policy && (
          <NativeSelectOption value='' disabled>
            {t('Keep existing routing behavior')}
          </NativeSelectOption>
        )}
        {(policy?.allowed_strategies ?? strategies).map((strategy) => (
          <NativeSelectOption key={strategy} value={strategy}>
            {t(labels[strategy])}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <p className='text-muted-foreground text-xs'>
        {limited
          ? t('{{count}} models allowed', { count: limits.length })
          : t('All available models allowed')}{' '}
        ·{' '}
        {t('{{count}} model strategy rules', {
          count: policy?.model_rules.length ?? 0,
        })}
      </p>
      <Button type='button' variant='outline' onClick={begin}>
        {t('Configure model and strategy permissions')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Model and strategy permissions')}
        description={t('Changes apply to this key after you save the key.')}
        footer={
          <>
            <Button
              type='button'
              variant='outline'
              onClick={() => setOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='button'
              disabled={restricted && selectedModels.length === 0}
              onClick={apply}
            >
              {t('Apply permissions')}
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-6'>
          <div className='space-y-3'>
            <Label className='flex items-center justify-between'>
              {t('Allow selected models only')}
              <Switch checked={restricted} onCheckedChange={setRestricted} />
            </Label>
            {restricted && (
              <MultiSelect
                options={models.map((model) => ({
                  value: model,
                  label: model,
                }))}
                selected={selectedModels}
                onChange={(next) => {
                  setSelectedModels(next)
                  if (!next.includes(ruleModel)) setRuleModel('')
                }}
                placeholder={t('Select at least one model')}
                maxVisibleChips={6}
              />
            )}
            <p className='text-muted-foreground text-xs'>
              {t(
                'Models outside this list are rejected before generation. New models are not automatically included when restricted.'
              )}
            </p>
          </div>
          <div className='space-y-3'>
            <Label>{t('Default allowed strategies')}</Label>
            <StrategyPermissions
              value={draft.allowed_strategies}
              label={t('Default allowed strategies')}
              onChange={(allowed) =>
                setDraft({
                  ...draft,
                  allowed_strategies: allowed,
                  default_strategy: allowed.includes(draft.default_strategy)
                    ? draft.default_strategy
                    : allowed[0],
                })
              }
            />
            <StrategySelect
              label={t('Default routing strategy')}
              value={draft.default_strategy}
              allowed={draft.allowed_strategies}
              onChange={(value) =>
                setDraft({ ...draft, default_strategy: value })
              }
            />
          </div>
          <div className='space-y-3 rounded-lg border p-4'>
            <Label>{t('Per-model strategy overrides')}</Label>
            <p className='text-muted-foreground text-xs'>
              {t(
                'An override replaces the default strategy permissions for this model. Other models inherit the defaults.'
              )}
            </p>
            <MultiSelect
              options={ruleModels.map((model) => ({
                value: model,
                label: model,
              }))}
              selected={ruleModel ? [ruleModel] : []}
              onChange={(next) => setRuleModel(next.at(-1) ?? '')}
              placeholder={t('Choose a model to configure')}
            />
            {ruleModel && (
              <>
                <StrategyPermissions
                  label={t('Allowed strategies for {{model}}', {
                    model: ruleModel,
                  })}
                  value={effective.allowed_strategies}
                  onChange={(allowed) =>
                    updateRule(
                      allowed,
                      allowed.includes(effective.default_strategy)
                        ? effective.default_strategy
                        : allowed[0]
                    )
                  }
                />
                <StrategySelect
                  label={t('Default strategy for {{model}}', {
                    model: ruleModel,
                  })}
                  value={effective.default_strategy}
                  allowed={effective.allowed_strategies}
                  onChange={(value) =>
                    updateRule(effective.allowed_strategies, value)
                  }
                />
                {editedRule && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() =>
                      setDraft({
                        ...draft,
                        model_rules: draft.model_rules.filter(
                          (rule) => rule.model !== ruleModel
                        ),
                      })
                    }
                  >
                    {t('Restore key defaults')}
                  </Button>
                )}
              </>
            )}
            {draft.model_rules
              .filter(
                (rule) => !restricted || selectedModels.includes(rule.model)
              )
              .map((rule) => (
                <div
                  key={rule.model}
                  className='flex items-center justify-between gap-2 text-xs'
                >
                  <span className='min-w-0 break-all'>
                    {rule.model} ·{' '}
                    {rule.allowed_strategies
                      .map((strategy) => t(labels[strategy]))
                      .join(' / ')}
                  </span>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={() => setRuleModel(rule.model)}
                  >
                    {t('Edit')}
                  </Button>
                </div>
              ))}
          </div>
          <div className='space-y-2'>
            <Label className='flex items-center justify-between'>
              {t('Allow fixed-route requests')}
              <Switch
                checked={draft.allow_fixed_routes}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, allow_fixed_routes: checked })
                }
              />
            </Label>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Automatic strategies apply to Chat Completions and media generation. Fixed route_id and native Responses require this permission and do not switch channels.'
              )}
            </p>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Retries use compatible, authorized channels in the selected order. Uncertain submissions are recovered first; policy rejections do not retry.'
            )}
          </p>
        </div>
      </Dialog>
    </SideDrawerSection>
  )
}
