// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { useRoutingOptions } from '@/features/platform-models/api'

import { ROUTING_STRATEGY_LABELS as labels } from '../constants'
import { routingStrategies, changeRoutingStrategy } from '../lib/routing-policy'
import type { KeyRoutingPolicy, RoutingStrategy } from '../types'

export function StrategySelect(props: {
  value: RoutingStrategy
  onChange: (value: RoutingStrategy) => void
  label: string
}) {
  const { t } = useTranslation()
  return (
    <NativeSelect
      className='w-full'
      aria-label={props.label}
      value={props.value}
      onChange={(event) =>
        props.onChange(event.target.value as RoutingStrategy)
      }
    >
      {routingStrategies.map((value) => (
        <NativeSelectOption key={value} value={value}>
          {t(labels[value])}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
export function RoutingAdvanced(props: {
  policy: KeyRoutingPolicy
  onChange: (policy: KeyRoutingPolicy) => void
  permissionsOnly?: boolean
  fixedOnly?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Collapsible className='rounded-xl border p-4'>
      <CollapsibleTrigger className='w-full text-left text-sm font-medium'>
        {t('Advanced routing permissions')}
      </CollapsibleTrigger>
      <CollapsibleContent className='space-y-4 pt-4'>
        {!props.fixedOnly && (
          <Label className='flex items-center justify-between gap-4'>
            {t('Allow callers to switch strategy')}
            <Switch
              checked={props.policy.allowed_strategies.length > 1}
              onCheckedChange={(checked) =>
                props.onChange({
                  ...props.policy,
                  version: 2,
                  mode: props.policy.mode || 'automatic',
                  allowed_strategies: checked
                    ? [...routingStrategies]
                    : [props.policy.default_strategy],
                })
              }
            />
          </Label>
        )}
        {!props.fixedOnly && props.policy.allowed_strategies.length > 1 && (
          <div className='grid grid-cols-2 gap-3'>
            {routingStrategies.map((value) => (
              <Label key={value} className='flex items-center gap-2 text-xs'>
                <Checkbox
                  checked={props.policy.allowed_strategies.includes(value)}
                  disabled={value === props.policy.default_strategy}
                  onCheckedChange={(checked) =>
                    props.onChange({
                      ...props.policy,
                      allowed_strategies: checked
                        ? [...props.policy.allowed_strategies, value]
                        : props.policy.allowed_strategies.filter(
                            (item) => item !== value
                          ),
                    })
                  }
                />
                {t(labels[value])}
              </Label>
            ))}
          </div>
        )}
        {!props.permissionsOnly && (
          <>
            <Label className='flex items-center justify-between gap-4'>
              {t('Allow fixed-route requests')}
              <Switch
                checked={props.policy.allow_fixed_routes}
                onCheckedChange={(checked) =>
                  props.onChange({
                    ...props.policy,
                    allow_fixed_routes: checked,
                  })
                }
              />
            </Label>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Fixed routes and native Responses still obey your selected models and routes. They do not switch routes.'
              )}
            </p>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
export function ModelRoutingRule(props: {
  policy: KeyRoutingPolicy
  model: string
  onChange: (policy: KeyRoutingPolicy) => void
}) {
  const { t } = useTranslation()
  const query = useRoutingOptions(
    props.policy.mode === 'custom' ? props.model : ''
  )
  const rule = props.policy.model_rules.find(
    (item) => item.model === props.model
  )
  const effective = rule || {
    model: props.model,
    default_strategy: props.policy.default_strategy,
    allowed_strategies: props.policy.allowed_strategies,
  }
  function update(next: typeof effective) {
    props.onChange({
      ...props.policy,
      version: 2,
      mode: props.policy.mode || 'automatic',
      model_rules: [
        ...props.policy.model_rules.filter(
          (item) => item.model !== props.model
        ),
        next,
      ],
    })
  }
  const manual = rule?.route_order === 'manual'
  const ids = rule?.route_ids || []
  function move(index: number, offset: number) {
    const next = [...ids]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    update({ ...effective, route_ids: next })
  }
  return (
    <section className='space-y-4 rounded-xl border p-4'>
      <h3 className='font-semibold break-all'>
        {query.data?.model.name || props.model}
      </h3>
      {props.policy.mode === 'custom' && (
        <Label className='flex items-center justify-between'>
          {t('Use manual route order')}
          <Switch
            checked={manual}
            onCheckedChange={(checked) =>
              update({
                ...effective,
                route_order: checked ? 'manual' : 'strategy',
              })
            }
          />
        </Label>
      )}
      {!manual && (
        <StrategySelect
          label={t('Default strategy for {{model}}', { model: props.model })}
          value={effective.default_strategy}
          onChange={(strategy) => {
            const next = changeRoutingStrategy(
              { ...props.policy, ...effective },
              strategy
            )
            update({
              ...effective,
              default_strategy: next.default_strategy,
              allowed_strategies: next.allowed_strategies,
            })
          }}
        />
      )}
      {manual && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Try these routes in order. Unavailable routes are skipped; requests cannot change this order.'
          )}
        </p>
      )}
      {ids.map((id, index) => {
        const route = query.data?.routes.find((item) => item.id === id)
        return (
          <div
            key={id}
            className='bg-muted/40 flex items-center gap-3 rounded-lg p-3 text-sm'
          >
            <span className='text-muted-foreground'>{index + 1}</span>
            <span className='min-w-0 flex-1 break-words'>
              {route ? `${route.provider} · ${route.sku}` : id}
            </span>
            {manual && (
              <>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={index === 0}
                  aria-label={t('Move route up {{index}}', {
                    index: index + 1,
                  })}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={index === ids.length - 1}
                  aria-label={t('Move route down {{index}}', {
                    index: index + 1,
                  })}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
              </>
            )}
          </div>
        )
      })}
      {!manual && (
        <RoutingAdvanced
          permissionsOnly
          policy={{ ...props.policy, ...effective }}
          onChange={(next) =>
            update({
              ...effective,
              default_strategy: next.default_strategy,
              allowed_strategies: next.allowed_strategies,
            })
          }
        />
      )}
      {props.policy.mode !== 'custom' && rule && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() =>
            props.onChange({
              ...props.policy,
              model_rules: props.policy.model_rules.filter(
                (item) => item.model !== props.model
              ),
            })
          }
        >
          {t('Restore key defaults')}
        </Button>
      )}
    </section>
  )
}
