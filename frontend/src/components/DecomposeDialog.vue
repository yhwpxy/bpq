<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, errorMessage } from '../api'
import { LOGIN_SPEC } from '../../../shared/example.js'
import { NODE_TYPES, NODE_TYPE_LABELS } from '../../../shared/constants.js'
import { taskSpecToPlan } from '../../../shared/plan.js'
import type { Plan, Task, TaskSpec } from '../types'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; generated: [plan: Plan] }>()
const step = ref(0), text = ref(''), busy = ref(false), parseError = ref(''), fileName = ref('')
const inputFile = ref<HTMLInputElement>()
const spec = ref<TaskSpec | null>(null)
type Row = Task & { selected: boolean; removed?: boolean }
const rows = ref<Row[]>([])
const visibleRows = computed(() => rows.value.filter(r => !r.removed))
const chosenCount = computed(() => rows.value.filter(r => r.selected).length)
const bytes = computed(() => new TextEncoder().encode(text.value).length)
const sourceName = ref('')
watch(() => props.modelValue, (open) => { if (open) { step.value=0; parseError.value='' } })
function close() { emit('update:modelValue',false) }
function loadExample() { text.value = LOGIN_SPEC; fileName.value='附录 A · 用户登录功能'; parseError.value='' }
async function upload(e: Event) {
 const target = e.target as HTMLInputElement, file = target.files?.[0]; target.value=''; if(!file)return
 if(!/\.(md|txt)$/i.test(file.name)) { ElMessage.error('请选择 .md 或 .txt 文件'); return }
 if(file.size>200*1024) { ElMessage.error('规格文件不能超过 200 KB'); return }
 try { text.value = await file.text(); fileName.value=file.name; parseError.value='' } catch { ElMessage.error('文件读取失败，请重新选择') }
}
async function parse() {
 parseError.value=''
 if (!text.value.trim()) { parseError.value='请粘贴规格文本，或上传 .md / .txt 文件。'; return }
 if (bytes.value > 200*1024) { parseError.value='规格文本超过 200 KB，请精简后再分解。'; return }
 busy.value=true
 try { const {data}=await api.post('/decompose',{text:text.value,format:'auto'}); spec.value=data.taskSpec; sourceName.value=data.taskSpec.source; rows.value=data.taskSpec.tasks.map((t:Task)=>({...t,dependsOn:[...t.dependsOn],selected:true})); step.value=1 }
 catch(e:any) { parseError.value=errorMessage(e) }
 finally { busy.value=false }
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
 <el-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue',$event)" width="min(1100px,94vw)" :close-on-click-modal="false" class="decompose-dialog" destroy-on-close>
  <template #header><div class="dialog-kicker">SPECIFICATION TO WORKFLOW</div><h2>从设计规格，开始编排</h2><p class="dialog-description">用清晰的规则，把文字变成可以执行的任务。</p></template>
  <div class="step-track"><div :class="{active:step===0,done:step===1}"><span>01</span>导入规格</div><i></i><div :class="{active:step===1}"><span>02</span>确认任务清单</div></div>
  <div v-if="step===0" class="spec-input-step">
   <div class="field-heading"><label for="spec-text">设计规格文本</label><div><el-button text size="small" @click="loadExample">填入登录示例</el-button><el-button size="small" @click="inputFile?.click()"><AppIcon name="upload" :size="14"/>上传文件</el-button></div></div>
   <textarea id="spec-text" v-model="text" class="spec-textarea" spellcheck="false" placeholder="# 功能名称&#10;## 1 输入校验&#10;- 并行：校验用户名格式&#10;- 校验密码非空&#10;&#10;粘贴 Markdown 标题或中文编号格式的规格…"></textarea>
   <div class="input-meta"><span>{{fileName || '自动识别 Markdown 标题 / 中文编号'}}</span><span :class="{'text-danger':bytes>200*1024}">{{(bytes/1024).toFixed(1)}} / 200 KB</span></div>
   <div class="rule-preview"><AppIcon name="info" :size="16"/><span>“并行”生成并行组，“判断”生成条件，“等待”生成延时。分支后缀支持（通过时）和（未通过时）。</span></div>
  </div>
  <div v-else>
   <div class="preview-heading"><div><el-tag effect="light">{{spec?.detectedFormat==='markdown'?'Markdown':'中文编号'}} 已识别</el-tag><span class="muted">已选 {{chosenCount}} / {{visibleRows.length}} 项 · 修改即时用于生成画布</span></div><el-button size="small" @click="add"><AppIcon name="plus" :size="14"/>添加任务</el-button></div>
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
  <template #footer><div class="dialog-footer"><span class="muted">规则分解 · 无需联网</span><div><el-button @click="step===1 ? (step=0,parseError='') : close()">{{step===1?'上一步':'取消'}}</el-button><el-button v-if="step===0" type="primary" :loading="busy" @click="parse"><AppIcon name="spark" :size="16"/>开始分解</el-button><el-button v-else type="primary" @click="generate"><AppIcon name="layout" :size="16"/>确认并生成画布</el-button></div></div></template>
  <input ref="inputFile" type="file" accept=".md,.txt" hidden @change="upload"/>
 </el-dialog>
</template>
