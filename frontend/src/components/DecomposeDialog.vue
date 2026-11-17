<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, errorMessage } from '../api'
import { LOGIN_SPEC } from '../../../shared/example.js'
import { NODE_TYPES, NODE_TYPE_LABELS } from '../../../shared/constants.js'
import { taskSpecToPlan } from '../../../shared/plan.js'
import type { Plan, Task, TaskSpec } from '../types'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; generated: [plan: Plan] }>()
type InputMode = 'structured' | 'natural'
const step = ref(0), text = ref(''), busy = ref(false), parseError = ref(''), fileName = ref('')
const mode = ref<InputMode>('structured'), resultOrigin = ref<InputMode>('structured'), naturalText = ref('')
const aiAvailable = ref(false), checkingAi = ref(false), aiStatusMessage = ref('正在检查 AI 配置…')
let requestEpoch = 0, statusEpoch = 0
let requestController: AbortController | undefined, statusController: AbortController | undefined
const inputFile = ref<HTMLInputElement>()
const spec = ref<TaskSpec | null>(null)
type Row = Task & { selected: boolean; removed?: boolean }
const rows = ref<Row[]>([])
const visibleRows = computed(() => rows.value.filter(r => !r.removed))
const chosenCount = computed(() => rows.value.filter(r => r.selected).length)
const bytes = computed(() => new TextEncoder().encode(text.value).length)
const naturalBytes = computed(() => new TextEncoder().encode(naturalText.value).length)
const sourceName = ref('')
function cancelRequest() { requestEpoch++; requestController?.abort(); requestController=undefined; busy.value=false }
function cancelStatus() { statusEpoch++; statusController?.abort(); statusController=undefined; checkingAi.value=false }
watch(() => props.modelValue, (open) => {
 cancelRequest()
 if (open) { step.value=0; parseError.value=''; void checkAiAvailability() }
 else cancelStatus()
})
watch(mode, () => { cancelRequest(); parseError.value='' })
onBeforeUnmount(() => { cancelRequest(); cancelStatus() })
function setVisible(value:boolean) { if(!value) { cancelRequest(); cancelStatus() } emit('update:modelValue',value) }
function close() { setVisible(false) }
async function checkAiAvailability() {
 cancelStatus(); const current=statusEpoch; const controller=new AbortController(); statusController=controller
 checkingAi.value=true; aiAvailable.value=false; aiStatusMessage.value='正在检查 AI 配置…'
 try {
  const {data}=await api.get('/decompose-nl/status',{signal:controller.signal})
  if(current!==statusEpoch || !props.modelValue)return
  aiAvailable.value=data?.enabled===true
  aiStatusMessage.value=aiAvailable.value ? 'AI 配置已就绪' : data?.message || 'AI 服务未配置，请在服务端设置模型连接。'
 } catch(e:any) {
  if(current!==statusEpoch || controller.signal.aborted)return
  aiStatusMessage.value=`无法检查 AI 配置：${errorMessage(e)}`
 } finally { if(current===statusEpoch) { checkingAi.value=false; statusController=undefined } }
}
function applyTaskSpec(taskSpec:TaskSpec, origin:InputMode) {
 if(!taskSpec || typeof taskSpec.source!=='string' || !Array.isArray(taskSpec.tasks))throw new Error('服务返回的任务清单不完整，请重试。')
 const nextRows=taskSpec.tasks.map((task:Task)=>({ ...task, dependsOn:[...task.dependsOn], selected:true }))
 spec.value=taskSpec; sourceName.value=taskSpec.source; rows.value=nextRows; resultOrigin.value=origin; step.value=1
}
function loadExample() { text.value = LOGIN_SPEC; fileName.value='附录 A · 用户登录功能'; parseError.value='' }
async function upload(e: Event) {
 const target = e.target as HTMLInputElement, file = target.files?.[0]; target.value=''; if(!file)return
 if(!/\.(md|txt)$/i.test(file.name)) { ElMessage.error('请选择 .md 或 .txt 文件'); return }
 if(file.size>200*1024) { ElMessage.error('规格文件不能超过 200 KB'); return }
 try { text.value = await file.text(); fileName.value=file.name; parseError.value='' } catch { ElMessage.error('文件读取失败，请重新选择') }
}
async function parse() {
 if(busy.value)return
 parseError.value=''
 const origin=mode.value, input=origin==='natural'?naturalText.value:text.value
 if(!input.trim()) { parseError.value=origin==='natural'?'请描述你希望完成的需求。':'请粘贴规格文本，或上传 .md / .txt 文件。'; return }
 if(new TextEncoder().encode(input).length>200*1024) { parseError.value='规格文本超过 200 KB，请精简后再分解。'; return }
 if(origin==='natural' && !aiAvailable.value) { parseError.value=aiStatusMessage.value; return }
 cancelRequest(); const current=requestEpoch; const controller=new AbortController(); requestController=controller; busy.value=true
 try {
  const {data}=origin==='natural'
   ? await api.post('/decompose-nl',{text:input},{signal:controller.signal,timeout:60000})
   : await api.post('/decompose',{text:input,format:'auto'},{signal:controller.signal})
  if(current!==requestEpoch || controller.signal.aborted || !props.modelValue)return
  if(data?.ok!==true)throw new Error('服务返回的任务清单不完整，请重试。')
  applyTaskSpec(data.taskSpec,origin)
 } catch(e:any) {
  if(current!==requestEpoch || controller.signal.aborted)return
  parseError.value=origin==='natural' && e.code==='ECONNABORTED' ? 'AI 分解等待超时，请稍后重试。' : errorMessage(e)
  if(origin==='natural' && e.response?.data?.code===50301) { aiAvailable.value=false; aiStatusMessage.value=errorMessage(e) }
 } finally { if(current===requestEpoch) { busy.value=false; requestController=undefined } }
}
function add() {
 let count=1;while(rows.value.some(r=>r.key===`new.${count}`))count++
 const previous=rows.value.filter(r=>r.selected&&r.type!=='end').at(-1)
 rows.value.push({key:`new.${count}`,name:'新任务',type:'task',dependsOn:previous?[previous.key]:[],parallelGroup:null,selected:true})
}
function remove(row:Row) { row.selected=false;row.removed=true }
function generate() {
 try { const plan=taskSpecToPlan({...spec.value,source:sourceName.value,tasks:rows.value.map(({removed,...row})=>row)}) as Plan;emit('generated',plan);close() }
 catch(e:any){parseError.value=e.message;ElMessage.error(e.message)}
}
function dependencies(row:Row,event:Event) { row.dependsOn=(event.target as HTMLInputElement).value.split(/[,，\s]+/).filter(Boolean) }
</script>
<template>
 <el-dialog :model-value="modelValue" @update:model-value="setVisible" width="min(1100px,94vw)" :close-on-click-modal="false" class="decompose-dialog" destroy-on-close>
  <template #header><div class="dialog-kicker">SPECIFICATION TO WORKFLOW</div><h2>从设计规格，开始编排</h2><p class="dialog-description">从结构化规格或自然语言需求，生成可编辑的任务清单。</p></template>
  <div class="step-track"><div :class="{active:step===0,done:step===1}"><span>01</span>导入规格</div><i></i><div :class="{active:step===1}"><span>02</span>确认任务清单</div></div>
  <div v-if="step===0" class="spec-input-step">
   <div class="decompose-mode-tabs" role="tablist" aria-label="规格输入方式">
    <button id="structured-input-tab" role="tab" :aria-selected="mode==='structured'" aria-controls="structured-input-panel" :class="{active:mode==='structured'}" @click="mode='structured'"><AppIcon name="task" :size="16"/><span>结构化规格<small>Markdown / 编号</small></span></button>
    <button id="natural-input-tab" role="tab" :aria-selected="mode==='natural'" aria-controls="natural-input-panel" :class="{active:mode==='natural'}" @click="mode='natural'"><AppIcon name="spark" :size="16"/><span>自然语言<small>AI 理解与分解</small></span></button>
   </div>
   <div v-if="mode==='structured'" id="structured-input-panel" role="tabpanel" aria-labelledby="structured-input-tab">
   <div class="field-heading"><label for="spec-text">设计规格文本</label><div><el-button text size="small" :disabled="busy" @click="loadExample">填入登录示例</el-button><el-button size="small" :disabled="busy" @click="inputFile?.click()"><AppIcon name="upload" :size="14"/>上传文件</el-button></div></div>
   <textarea id="spec-text" v-model="text" :disabled="busy" class="spec-textarea" spellcheck="false" placeholder="# 功能名称&#10;## 1 输入校验&#10;- 并行：校验用户名格式&#10;- 校验密码非空&#10;&#10;粘贴 Markdown 标题或中文编号格式的规格…"></textarea>
   <div class="input-meta"><span>{{fileName || '自动识别 Markdown 标题 / 中文编号'}}</span><span :class="{'text-danger':bytes>200*1024}">{{(bytes/1024).toFixed(1)}} / 200 KB</span></div>
   <div class="rule-preview"><AppIcon name="info" :size="16"/><span>“并行”生成并行组，“判断”生成条件，“等待”生成延时。分支后缀支持（通过时）和（未通过时）。</span></div>
   </div>
   <div v-else id="natural-input-panel" role="tabpanel" aria-labelledby="natural-input-tab">
    <div class="field-heading"><label for="nl-text">用自己的话描述需求</label><span class="ai-config-badge" :class="{ready:aiAvailable}" role="status"><i></i>{{checkingAi?'检查配置中':aiAvailable?'AI 已配置':'AI 暂不可用'}}</span></div>
    <textarea id="nl-text" v-model="naturalText" class="spec-textarea natural-textarea" :disabled="busy" :aria-busy="busy" aria-describedby="ai-network-notice ai-availability" placeholder="例如：帮我做一个登录功能，用户能输入账号密码，后端要校验，成功跳转首页，失败提示错误。&#10;&#10;可以说明处理顺序、并行步骤和不同情况，无需 Markdown 标题。"></textarea>
    <div class="input-meta"><span>支持普通中文或英文描述</span><span :class="{'text-danger':naturalBytes>200*1024}">{{(naturalBytes/1024).toFixed(1)}} / 200 KB</span></div>
    <div id="ai-network-notice" class="rule-preview ai-network-notice"><AppIcon name="info" :size="16"/><span>点击「AI 分解」会将这段需求发送至服务端配置的模型服务。结果会先进入确认表，由你检查后生成画布；任务仍按现有引擎模拟执行。</span></div>
    <div v-if="!aiAvailable" id="ai-availability" class="ai-availability" aria-live="polite"><span>{{aiStatusMessage}}</span><el-button text size="small" :loading="checkingAi" @click="checkAiAvailability">重新检查</el-button></div>
    <div v-else id="ai-availability" class="ai-request-hint" aria-live="polite">{{busy?'正在理解需求并校验任务关系，可切换模式或关闭窗口取消等待。':'模型连接仅保存在服务端，浏览器不需要填写 API Key。'}}</div>
   </div>
  </div>
  <div v-else>
   <div class="preview-heading"><div><el-tag effect="light">{{resultOrigin==='natural'?'AI 分解结果':(spec?.detectedFormat==='markdown'?'Markdown':'中文编号')+' 已识别'}}</el-tag><span class="muted">已选 {{chosenCount}} / {{visibleRows.length}} 项 · 修改即时用于生成画布</span></div><el-button size="small" @click="add"><AppIcon name="plus" :size="14"/>添加任务</el-button></div>
   <div class="preview-name"><label>方案名称</label><el-input v-model="sourceName" maxlength="50"/></div>
   <div class="task-table-wrap"><table class="task-table"><thead><tr><th class="check-col">选</th><th>编号</th><th style="width:24%">任务名称</th><th>类型</th><th>前置依赖</th><th>并行组</th><th>分支</th><th></th></tr></thead><tbody>
    <tr v-for="row in visibleRows" :key="row.key" :class="{excluded:!row.selected}">
     <td><el-checkbox v-model="row.selected" :aria-label="`选择 ${row.name}`"/></td><td class="mono task-key">{{row.key}}</td>
     <td><el-input v-model="row.name" size="small" maxlength="50" :aria-label="`${row.key} 名称`"/><el-input v-if="row.type==='condition'" v-model="row.expression" size="small" placeholder="passed == true" class="expression-input" :aria-label="`${row.key} 表达式`"/><el-input v-if="row.type==='task' && row.output" v-model="row.output" size="small" placeholder="输出变量" class="expression-input" :aria-label="`${row.key} 输出变量`"/></td>
     <td><el-select v-model="row.type" size="small" :aria-label="`${row.key} 类型`" style="width:94px"><el-option v-for="t in NODE_TYPES" :key="t" :label="NODE_TYPE_LABELS[t as keyof typeof NODE_TYPE_LABELS]" :value="t"/></el-select></td>
     <td><input class="dependency-input mono" :value="row.dependsOn.join(', ')" @change="dependencies(row,$event)" :aria-label="`${row.key} 依赖`" placeholder="无"/></td>
     <td><el-tag v-if="row.parallelGroup" size="small" effect="plain">G{{row.parallelGroup}}</el-tag><span v-else class="muted">—</span></td>
     <td><el-select v-model="row.branch" size="small" clearable placeholder="—" :aria-label="`${row.key} 分支`" style="width:80px"><el-option label="true" value="true"/><el-option label="false" value="false"/></el-select></td>
     <td><button class="icon-button danger-hover" @click="remove(row)" :aria-label="`删除 ${row.name}`"><AppIcon name="trash" :size="15"/></button></td>
    </tr>
   </tbody></table></div>
   <div class="rule-preview"><AppIcon name="info" :size="16"/><span>依赖使用任务编号，以逗号分隔。取消或删除任务会接续其前置依赖；条件任务须保留 true / false 两个分支。</span></div>
  </div>
  <el-alert v-if="parseError" :title="parseError" type="error" :closable="false" show-icon class="parse-error"/>
  <template #footer><div class="dialog-footer"><span class="muted">{{(step===1?resultOrigin:mode)==='natural'?'AI 分解 · 需要联网':'规则分解 · 无需联网'}}</span><div><el-button @click="step===1 ? (step=0,parseError='') : close()">{{step===1?'上一步':'取消'}}</el-button><el-button v-if="step===0" type="primary" :loading="busy" :disabled="mode==='natural' && (!aiAvailable || checkingAi)" @click="parse"><AppIcon name="spark" :size="16"/>{{mode==='natural'?(busy?'AI 分解中…':'AI 分解'):'开始分解'}}</el-button><el-button v-else type="primary" @click="generate"><AppIcon name="layout" :size="16"/>确认并生成画布</el-button></div></div></template>
  <input ref="inputFile" type="file" accept=".md,.txt" hidden @change="upload"/>
 </el-dialog>
</template>
