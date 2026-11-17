import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, errorMessage } from '../api'
import { SETTLED_STATUSES } from '../../../shared/constants.js'
import { usePlanStore } from './planStore'
import type { LogEntry, NodeRunState } from '../types'
const RUN_KEY = 'vto.run.v1'
export const useRunStore = defineStore('run', () => {
  const runId = ref(''), planId = ref(''), status = ref('IDLE'), error = ref('')
  const nodeStates = ref<Record<string, NodeRunState>>({})
  const logs = ref<LogEntry[]>([])
  const startedAt = ref<string | null>(null), finishedAt = ref<string | null>(null)
  const active = computed(() => ['VALIDATING', 'RUNNING'].includes(status.value))
  const progress = computed(() => { const states = Object.values(nodeStates.value); return states.length ? Math.round(states.filter(s => (SETTLED_STATUSES as readonly string[]).includes(s.status)).length / states.length * 100) : 0 })
  let timer: ReturnType<typeof setTimeout> | undefined
  let epoch = 0
  let pollingEpoch: number | null = null
  function remember() { try { const saved = JSON.parse(localStorage.getItem(RUN_KEY) || '{}'); const runs = saved.runs || {}; runs[planId.value] = runId.value; localStorage.setItem(RUN_KEY, JSON.stringify({ runs, runId: runId.value, planId: planId.value })) } catch {} }
  function reset() { epoch++; clearTimeout(timer); runId.value = ''; planId.value = ''; status.value = 'IDLE'; nodeStates.value = {}; logs.value = []; error.value = ''; startedAt.value = null; finishedAt.value = null }
  async function start() {
    reset(); status.value = 'VALIDATING'
    const plan = usePlanStore()
    try { const id = await plan.save(); const { data } = await api.post(`/plans/${encodeURIComponent(id)}/execute`); runId.value = data.runId; planId.value = id; status.value = 'RUNNING'; remember(); await poll() }
    catch (e: any) { status.value = 'IDLE'; error.value = errorMessage(e); if (Array.isArray(e.response?.data?.details)) plan.issues = e.response.data.details; throw e }
  }
  async function poll() {
    if (!runId.value || pollingEpoch === epoch) return
    const current = epoch; pollingEpoch = current; clearTimeout(timer)
    try {
      const since = logs.value.at(-1)?.seq || 0
      const { data } = await api.get(`/runs/${encodeURIComponent(runId.value)}`, { params: { since } })
      if (current !== epoch) return
      status.value = data.status; nodeStates.value = data.nodeStates; startedAt.value = data.startedAt; finishedAt.value = data.finishedAt; error.value = data.error || ''
      const known = new Set(logs.value.map(l => l.seq)); logs.value.push(...data.logs.filter((l: LogEntry) => !known.has(l.seq))); logs.value.sort((a,b) => a.seq-b.seq)
    } catch(e: any) { if (current !== epoch) return; error.value = errorMessage(e); if (e.response?.status === 404) status.value = 'IDLE' }
    finally { if (pollingEpoch === current) pollingEpoch = null; if (current === epoch && active.value) timer = setTimeout(poll, 500) }
  }
  async function stop() { if (!runId.value) return; await api.post(`/runs/${encodeURIComponent(runId.value)}/cancel`); await poll() }
  async function restore() {
    try { const raw = localStorage.getItem(RUN_KEY); if (!raw) return; const data = JSON.parse(raw); const id = usePlanStore().plan.id; const previous = data.runs?.[id] || (data.planId === id ? data.runId : ''); if (!previous) return; runId.value = previous; planId.value = id; status.value = 'RUNNING'; await poll() } catch { reset() }
  }
  function dispose() { clearTimeout(timer); epoch++ }
  return { runId, planId, status, error, nodeStates, logs, startedAt, finishedAt, active, progress, start, stop, poll, restore, reset, dispose }
})
