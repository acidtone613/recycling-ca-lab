'use client'

// Run log — every run is persisted as a JSON stamp (config hash, seed, rules,
// topology, collision, final statistics, cycle length), exportable as JSON.
// The difference between "a demo" and "an experiment".

import type { RunSummary } from '@/lib/ca/types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Camera, Download, Stamp, Trash2 } from 'lucide-react'

export interface LogEntry extends RunSummary {
  stampedAt: string
}

// 'running' is NOT dead: automatic stamps fire only on terminal/censored
// outcomes, but the manual "Stamp this run" button can stamp a mid-run
// engine — those entries carry outcome 'running' and get the amber badge.
const OUTCOME_BADGE: Record<string, string> = {
  running: 'text-amber-300',
  extinct: 'text-red-400',
  cycle: 'text-emerald-300',
  censored: 'text-zinc-300',
}

export function RunLog({
  entries, onStamp, onClear, onExportJson, onExportPng, canStamp,
}: {
  entries: LogEntry[]
  onStamp: () => void
  onClear: () => void
  onExportJson: () => void
  onExportPng: () => void
  canStamp: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Run log — {entries.length} stamp{entries.length === 1 ? '' : 's'}
        </p>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onStamp} disabled={!canStamp}>
            <Stamp className="h-3 w-3" /> Stamp this run
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onExportPng}>
            <Camera className="h-3 w-3" /> Snapshot PNG
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onExportJson} disabled={!entries.length}>
            <Download className="h-3 w-3" /> Export JSON
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-red-400 hover:text-red-300"
            onClick={onClear} disabled={!entries.length}>
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-zinc-800">
        <ScrollArea className="max-h-56">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">#</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Rules (L1 | L2)</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Coupling</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Seed</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Steps</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Outcome</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Cycle</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">L1 / L2 final</TableHead>
                <TableHead className="h-8 text-[10px] uppercase text-zinc-500">Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-xs text-zinc-600">
                    No stamps yet — runs are stamped automatically when they reach extinction, a
                    cycle, or the step cap (or press “Stamp this run”).
                  </TableCell>
                </TableRow>
              )}
              {entries.map((e, i) => (
                <TableRow key={`${e.configHash}-${e.stampedAt}-${i}`}>
                  <TableCell className="py-1.5 font-mono text-[11px] text-zinc-500">{entries.length - i}</TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px]">
                    <span className="text-amber-300">{e.config.rule1}</span>
                    <span className="text-zinc-600"> | </span>
                    <span className="text-teal-300">{e.config.rule2}</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-[11px] text-zinc-400">
                    {e.config.direction === 'none'
                      ? 'off'
                      : `${e.config.topology === 'nearest_empty' ? 'nearest' : e.config.topology.replace('_', ' ')} · ${e.config.collision}`}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px] text-zinc-400">{e.config.seed}</TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px] text-zinc-400">{e.stepsRun}</TableCell>
                  <TableCell className={cn('py-1.5 font-mono text-[11px]', OUTCOME_BADGE[e.outcome])}>
                    {e.outcome === 'censored' ? 'active@cap' : e.outcome}
                    {e.extinctStep !== null ? ` @${e.extinctStep}` : ''}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px] text-zinc-400">
                    {e.cycleJ ? e.cycleJ.length : '—'}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px] text-zinc-400">
                    {e.finalCount1} / {e.finalCount2}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-[10px] text-zinc-600">{e.configHash.slice(0, 8)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  )
}
