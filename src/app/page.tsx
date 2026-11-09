'use client'

import { useState } from 'react'
import type { CAConfig } from '@/lib/ca/types'
import { Workbench, type LoadRequest } from '@/components/ca/workbench'
import { ResultsTab } from '@/components/ca/results-tab'
import { ModelDocs } from '@/components/ca/model-docs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Recycle } from 'lucide-react'

type TabKey = 'workbench' | 'results' | 'model'

export default function Home() {
  const [tab, setTab] = useState<TabKey>('workbench')
  const [loadRequest, setLoadRequest] = useState<LoadRequest | null>(null)

  const openInWorkbench = (config: CAConfig) => {
    setLoadRequest((prev) => ({ config, version: (prev?.version ?? 0) + 1 }))
    setTab('workbench')
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10">
              <Recycle className="h-4 w-4 text-amber-400" aria-hidden />
            </span>
            <div>
              <h1 className="text-sm font-semibold leading-tight">Recycling CA Lab</h1>
              <p className="text-[11px] leading-tight text-zinc-500">
                three-layer recycling cellular automata · two dynamical layers + one map
              </p>
            </div>
          </div>
          <nav className="ml-auto" aria-label="Main">
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabsList className="bg-zinc-900">
                <TabsTrigger value="workbench" className="text-xs">Workbench</TabsTrigger>
                <TabsTrigger value="results" className="text-xs">Results</TabsTrigger>
                <TabsTrigger value="model" className="text-xs">Model</TabsTrigger>
              </TabsList>
            </Tabs>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsContent value="workbench" className="mt-0">
            <Workbench key={loadRequest?.version ?? 0} loadRequest={loadRequest} />
          </TabsContent>
          <TabsContent value="results" className="mt-0">
            <ResultsTab onOpenInWorkbench={openInWorkbench} />
          </TabsContent>
          <TabsContent value="model" className="mt-0">
            <ModelDocs />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
