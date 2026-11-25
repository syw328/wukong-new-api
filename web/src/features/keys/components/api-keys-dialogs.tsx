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
import { useEffect, useState } from 'react'

import type { KeyRoutePreset } from '../lib'
import { ApiKeysDeleteDialog } from './api-keys-delete-dialog'
import { ApiKeysMutateDrawer } from './api-keys-mutate-drawer'
import { useApiKeys } from './api-keys-provider'
import { CCSwitchDialog } from './dialogs/cc-switch-dialog'

export function ApiKeysDialogs(props: {
  // From a model price page link; opens the create drawer once with it.
  routePreset?: KeyRoutePreset
  onRoutePresetOpened?: () => void
}) {
  const { open, setOpen, currentRow, resolvedKey } = useApiKeys()
  const [createPreset, setCreatePreset] = useState<KeyRoutePreset>()
  const presetModel = props.routePreset?.model
  const presetRouteId = props.routePreset?.routeId
  const onRoutePresetOpened = props.onRoutePresetOpened

  useEffect(() => {
    if (!presetModel || !presetRouteId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreatePreset({ model: presetModel, routeId: presetRouteId })
    setOpen('create')
    onRoutePresetOpened?.()
  }, [presetModel, presetRouteId, setOpen, onRoutePresetOpened])

  return (
    <>
      <ApiKeysMutateDrawer
        open={open === 'create' || open === 'update'}
        onOpenChange={(isOpen) => {
          if (isOpen) return
          setOpen(null)
          setCreatePreset(undefined)
        }}
        currentRow={open === 'update' ? currentRow || undefined : undefined}
        routePreset={open === 'create' ? createPreset : undefined}
      />
      <ApiKeysDeleteDialog />
      <CCSwitchDialog
        open={open === 'cc-switch'}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        tokenKey={resolvedKey}
        tokenId={currentRow?.id ?? 0}
      />
    </>
  )
}
