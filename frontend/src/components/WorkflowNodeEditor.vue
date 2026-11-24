<script setup lang="ts">
import { watch, ref } from 'vue'
import { t } from '../i18n'
import { ElMessage } from 'element-plus'
const props = defineProps<{ node: any; capabilities: any[]; groups: any[]; readonly?: boolean }>()
const emit = defineEmits<{ patch:[props:any]; remove:[] }>()
const draft = ref<any>({}), arrays = ref<Record<string,string>>({})
watch(() => props.node, n => { draft.value = n ? JSON.parse(JSON.stringify(n.props)) : {}; arrays.value = Object.fromEntries(['inputContract','outputContract','args'].map(k=>[k,JSON.stringify(n?.props[k] || [],null,2)])) }, { immediate:true, deep:true })
function save() { try { for(const key of Object.keys(arrays.value)) draft.value[key]=JSON.parse(arrays.value[key]); emit('patch',JSON.parse(JSON.stringify(draft.value))) } catch { ElMessage.error(t('契约或参数不是合法 JSON','Invalid contract or arguments JSON')) } }
function cap(id:string) { draft.value.capabilityId=id;draft.value.executorKind=props.capabilities.find(c=>c.id===id)?.kind || 'tool' }
function parent(id:string) { const g=props.groups.find(g=>g.id===id);draft.value.parentId=id;draft.value.depth=g?.kind==='task'?2:1;draft.value.phaseId=g?.kind==='task'?g.parentId:id }
</script>
<template><div v-if="node" class="wb-node-editor"><div class="wb-eyebrow">{{node.type}} {{node.props.control ? ` / ${node.props.control}`:''}}</div><code class="wb-id">{{node.id}}</code>
 <el-form label-position="top" :disabled="readonly">
  <el-form-item :label="t('节点名称','Node name')"><el-input v-model="draft.name" aria-label="Workflow node name" maxlength="50"/></el-form-item>
  <el-form-item :label="t('规划理由','Planning rationale')"><el-input v-model="draft.planningRationale" type="textarea" :rows="3" aria-label="Planning rationale"/></el-form-item>
  <label>{{t('层级归属','Parent container')}}<select aria-label="Parent container" :value="draft.parentId" :disabled="readonly" @change="parent(($event.target as HTMLSelectElement).value)"><option v-for="g in groups" :value="g.id">{{g.title}}</option></select></label>
  <label v-if="['tool','agent'].includes(draft.executorKind)">{{t('执行能力','Capability')}}<select aria-label="Node capability" :value="draft.capabilityId" :disabled="readonly" @change="cap(($event.target as HTMLSelectElement).value)"><option v-for="c in capabilities" :value="c.id">{{c.name}} · {{c.enabled ? c.circuit : 'disabled'}}</option></select></label>
  <label>{{t('执行角色','Executor role')}}<select v-model="draft.assignedRole" :disabled="readonly"><option v-for="role in ['lead','worker','evaluator','specialist']">{{role}}</option></select></label>
  <el-form-item :label="t('关联 FR','FR references')"><el-input :model-value="(draft.requirementRefs||[]).join(', ')" @update:model-value="draft.requirementRefs=$event.split(/[,，\s]+/).filter(Boolean)" aria-label="Node FR refs"/></el-form-item>
  <el-form-item :label="t('关联 AC','AC references')"><el-input :model-value="(draft.acceptanceRefs||[]).join(', ')" @update:model-value="draft.acceptanceRefs=$event.split(/[,，\s]+/).filter(Boolean)" aria-label="Node AC refs"/></el-form-item>
  <el-form-item :label="t('写入范围','Write scope')"><el-input :model-value="(draft.fileScope||[]).join(', ')" @update:model-value="draft.fileScope=$event.split(/[,，\s]+/).filter(Boolean)" aria-label="Node file scope"/></el-form-item>
  <el-form-item v-if="node.type==='condition'" :label="t('条件表达式','Condition expression')"><el-input v-model="draft.expression" aria-label="Condition expression"/></el-form-item>
  <template v-if="node.type==='task'"><el-checkbox v-if="draft.control==='gate'" v-model="draft.demonstrationGate">{{t('仅演示门禁（不认证业务）','Demonstration gate only')}}</el-checkbox><el-form-item :label="t('执行命令','Executable')"><el-input v-model="draft.command" aria-label="Node executable"/></el-form-item><label>{{t('参数 JSON 数组','Arguments JSON array')}}<textarea v-model="arrays.args" aria-label="Node arguments" :disabled="readonly"/></label><el-form-item :label="t('自动重试次数','Automatic retries')"><el-input-number v-model="draft.retry" :min="0" :max="3"/></el-form-item><el-form-item v-if="draft.capabilityId==='simulated'" :label="t('模拟时长 ms','Simulation duration ms')"><el-input-number v-model="draft.duration" :min="0" :max="60000"/></el-form-item></template>
  <label>{{t('输入契约 JSON','Input contract JSON')}}<textarea v-model="arrays.inputContract" aria-label="Node input contract" :disabled="readonly" rows="4"/></label>
  <label>{{t('输出契约 JSON','Output contract JSON')}}<textarea v-model="arrays.outputContract" aria-label="Node output contract" :disabled="readonly" rows="4"/></label>
  <el-form-item :label="t('任务说明','Task prompt')"><el-input v-model="draft.prompt" type="textarea" :rows="3"/></el-form-item>
  <div class="wb-row"><el-button type="primary" @click="save">{{t('应用节点修改','Apply node changes')}}</el-button><el-button type="danger" plain @click="emit('remove')">{{t('删除节点','Remove node')}}</el-button></div>
 </el-form>
</div><el-empty v-else :description="t('选择任务查看契约与理由','Select a task to inspect its contract')" :image-size="64"/></template>
