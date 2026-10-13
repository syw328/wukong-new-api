// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { createFileRoute } from '@tanstack/react-router'

import { ApiDocsPage } from '@/features/api-docs'

export const Route = createFileRoute('/docs/')({ component: ApiDocsPage })
