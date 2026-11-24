<script setup lang="ts">
import { ref,onMounted } from 'vue'
import { t,displayStatus } from '../i18n'
import { workApi,downloadFile } from '../workApi'
import { ElMessage } from 'element-plus'
const emit=defineEmits<{open:[id:string]}>()
const runs=ref<any[]>([]),events=ref<any[]>([]),query=ref(''),hits=ref<any[]>([]),busy=ref(false),total=ref(0)
async function safe(fn:()=>Promise<any>){busy.value=true;try{await fn()}catch(e:any){ElMessage.error(e.response?.data?.message||e.message)}finally{busy.value=false}}
async function refresh(){runs.value=(await workApi.get('/runs')).data;events.value=(await workApi.get('/audit')).data.events}
async function search(){const {data}=await workApi.get('/evidence/search',{params:{q:query.value}});hits.value=data.hits;total.value=data.total}
async function evidence(id:string){downloadFile(`evidence-${id}.json`,(await workApi.get(`/runs/${id}/evidence`)).data)}
onMounted(()=>safe(refresh))
</script>
<template><div class="wb-audit" v-loading="busy"><div class="wb-section-heading"><div><h2>{{t('运行与证据','Runs & evidence')}}</h2><p>{{t('从需求版本追溯到节点尝试、人工决定与恢复引用。','Trace requirements to attempts, human decisions and recovery refs.')}}</p></div><el-button @click="safe(refresh)">{{t('刷新','Refresh')}}</el-button></div>
 <section class="wb-card"><div class="wb-row"><el-input v-model="query" aria-label="Evidence query" :placeholder="t('搜索节点、日志、会话','Search nodes, logs and sessions')" @keyup.enter="safe(search)"/><el-button type="primary" @click="safe(search)">{{t('搜索证据','Search evidence')}}</el-button></div><p v-if="total">{{total}} {{t('条匹配记录','matching records')}}</p><div v-for="(h,i) in hits" :key="i" class="wb-hit"><button class="wb-link" @click="h.runId&&emit('open',h.runId)">{{h.title}} · {{h.source}}</button><p>{{h.text}}</p></div></section>
 <section class="wb-card"><h3>{{t('运行历史','Run history')}}</h3><div class="wb-table-wrap"><table class="wb-table"><thead><tr><th>{{t('工作流','Workflow')}}</th><th>{{t('版本','Version')}}</th><th>{{t('状态','Status')}}</th><th>{{t('开始时间','Started')}}</th><th>{{t('操作','Actions')}}</th></tr></thead><tbody><tr v-for="r in runs" :key="r.id"><td>{{r.planName}}<small>{{r.id}}</small></td><td>{{r.versionTag||'legacy'}}</td><td>{{displayStatus(r.status)}}<small>{{r.mode}}</small></td><td>{{new Date(r.startedAt).toLocaleString()}}</td><td><el-button size="small" @click="emit('open',r.id)">{{t('打开','Open')}}</el-button><el-button size="small" @click="safe(()=>evidence(r.id))">evidence JSON</el-button></td></tr></tbody></table></div></section>
 <section class="wb-card"><h3>{{t('设计审计','Design audit')}}</h3><div v-for="e in [...events].reverse()" :key="e.seq" class="wb-entry"><code>#{{e.seq}}</code><div><b>{{e.action}}</b><small>{{e.message}} · {{e.versionId||e.planId}}</small></div><time>{{new Date(e.time).toLocaleTimeString()}}</time></div></section>
</div></template>
