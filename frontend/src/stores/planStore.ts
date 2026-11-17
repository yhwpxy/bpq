import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api'
import { createEmptyPlan, autoLayout as layout } from '../../../shared/plan.js'
import { validatePlanSchema } from '../../../shared/schema.js'
import type { Plan, ValidationIssue } from '../types'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const DRAFT_KEY = 'vto.plan.draft.v1'
export const usePlanStore = defineStore('plan', () => {
  const plan = ref<Plan>(createEmptyPlan() as Plan)
  const dirty = ref(false)
  const savedAt = ref('')
  const selectedId = ref('')
  const issues = ref<ValidationIssue[]>([])
  const past = ref<Plan[]>([])
  const future = ref<Plan[]>([])
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  const nodes = computed(() => plan.value.nodes)
  const edges = computed(() => plan.value.edges)
  const meta = computed(() => plan.value.meta || {})
  const selectedNode = computed(() => nodes.value.find(n => n.id === selectedId.value))
  function writeDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ plan: plan.value, dirty: dirty.value, savedAt: savedAt.value })) } catch { /* Private mode or quota: server saving remains available. */ } }
  function setDirty() { dirty.value = true; clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 250) }
  function commit(next: Plan, record = true) {
    if (record) { past.value.push(clone(plan.value)); if (past.value.length > 80) past.value.shift(); future.value = [] }
    plan.value = clone(next); issues.value = []; setDirty()
  }
  function mutate(fn: (p: Plan) => void) { const next = clone(plan.value); fn(next); commit(next) }
  function replace(next: Plan, clean = false) { commit(next); selectedId.value = ''; if (clean) { dirty.value = false; savedAt.value = next.updatedAt; writeDraft() } }
  function undo() { if (!past.value.length) return; future.value.push(clone(plan.value)); plan.value = past.value.pop()!; issues.value = []; setDirty() }
  function redo() { if (!future.value.length) return; past.value.push(clone(plan.value)); plan.value = future.value.pop()!; issues.value = []; setDirty() }
  async function save() {
    const version = JSON.stringify(plan.value)
    const { data } = await api.post('/plans', clone(plan.value))
    if (JSON.stringify(plan.value) === version) { plan.value.id = data.id; plan.value.updatedAt = data.updatedAt; dirty.value = false; savedAt.value = data.updatedAt; writeDraft() }
    return data.id as string
  }
  async function load(id: string) { const { data } = await api.get(`/plans/${encodeURIComponent(id)}`); assertSchema(data); replace(data, true) }
  function assertSchema(value: unknown) { const errors = validatePlanSchema(value); if (errors.length) throw new Error(`方案格式错误：${errors[0].message}`) }
  async function importPlan(value: unknown) { assertSchema(value); const { data } = await api.post('/plans', value); replace({ ...(value as Plan), id: data.id, updatedAt: data.updatedAt }, true) }
  function exportPlan() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan.value, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `${plan.value.name || '编排方案'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function autoLayout() { const next = clone(plan.value); const result = layout(next); commit((result || next) as Plan) }
  function restoreDraft() {
    try { const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return false; const data = JSON.parse(raw); assertSchema(data.plan); plan.value = data.plan; dirty.value = Boolean(data.dirty); savedAt.value = data.savedAt || ''; return true }
    catch { localStorage.removeItem(DRAFT_KEY); return false }
  }
  function reset() { replace(createEmptyPlan() as Plan) }
  return { plan, nodes, edges, meta, dirty, savedAt, selectedId, selectedNode, issues, past, future, mutate, commit, replace, setDirty, save, load, importPlan, exportPlan, autoLayout, restoreDraft, undo, redo, reset, writeDraft }
})
