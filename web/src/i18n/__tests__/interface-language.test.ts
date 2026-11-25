// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { afterEach, expect, it } from 'vitest'

import { createInterfaceLanguageDetector } from '../languages'

function mountPortalRuntime() {
  const runtime = document.createElement('script')
  runtime.type = 'application/json'
  runtime.id = 'platform-portal-runtime'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.body.append(runtime)
}

afterEach(() => {
  document.querySelector('#platform-portal-runtime')?.remove()
  window.localStorage.clear()
})

it('a mounted portal visitor without a saved choice starts in Simplified Chinese even with an English browser', () => {
  mountPortalRuntime()
  expect(navigator.language).toBe('en-US')
  expect(createInterfaceLanguageDetector().detect()).toBe('zhCN')
})

it('a saved portal language choice wins over the Simplified Chinese default', () => {
  mountPortalRuntime()
  window.localStorage.setItem('newapi:portal:i18nextLng', 'en')
  expect(createInterfaceLanguageDetector().detect()).toBe('en')
})

it('a standalone New API keeps browser language detection', () => {
  expect(createInterfaceLanguageDetector().detect()).toBe('en-US')
})
