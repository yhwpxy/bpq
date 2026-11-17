<script setup lang="ts">
import { computed } from 'vue'
import { usePlanStore } from '../stores/planStore'
import { useRunStore } from '../stores/runStore'
import { NODE_TYPE_LABELS, NODE_TYPE_COLORS } from '../../../shared/constants.js'
import AppIcon from './AppIcon.vue'
const emit=defineEmits<{focus:[id:string];remove:[];collapse:[]}>()
const store=usePlanStore(), run=useRunStore()
const node=computed(()=>store.selectedNode)
function prop(key:string,value:any){if(run.active||!node.value)return;store.mutate(p=>{const n=p.nodes.find(n=>n.id===node.value!.id);if(n){if(key==='name'&&n.type!=='task'&&!value)delete n.props.name;else n.props[key]=value}})}
function meta(key:string,value:any){if(run.active)return;store.mutate(p=>{p.meta={...p.meta,[key]:value}})}
</script>
<template>
 <aside class="property-panel side-panel">
  <div class="panel-heading"><span>属性设置</span><button class="icon-button" title="收起属性面板" @click="emit('collapse')"><AppIcon name="chevron" :size="15"/></button></div>
  <div class="property-body">
   <template v-if="node">
    <div class="node-property-title"><div class="node-icon" :style="{color:NODE_TYPE_COLORS[node.type],background:NODE_TYPE_COLORS[node.type]+'12'}"><AppIcon :name="node.type"/></div><div><h3>{{NODE_TYPE_LABELS[node.type]}}</h3><span class="mono small muted">{{node.id}}</span></div></div>
    <el-form label-position="top" :disabled="run.active">
     <el-form-item v-if="node.type!=='task'" label="显示名称"><el-input :model-value="node.props.name || ''" @update:model-value="prop('name',$event)" maxlength="50" :placeholder="NODE_TYPE_LABELS[node.type]"/></el-form-item>
     <template v-if="node.type==='task'">
      <el-form-item label="任务名称"><el-input :model-value="node.props.name" @update:model-value="prop('name',$event)" maxlength="50" show-word-limit /></el-form-item>
      <el-form-item label="模拟耗时（ms）"><el-input-number :model-value="node.props.duration" @update:model-value="prop('duration',$event)" :min="0" :max="60000" :step="100" controls-position="right"/></el-form-item>
      <div class="form-pair"><el-form-item label="重试次数"><el-input-number :model-value="node.props.retry" @update:model-value="prop('retry',$event)" :min="0" :max="3" controls-position="right"/></el-form-item><el-form-item label="失败概率"><el-input-number :model-value="node.props.failRate" @update:model-value="prop('failRate',$event)" :min="0" :max="1" :step="0.1" :precision="1" controls-position="right"/></el-form-item></div>
      <el-form-item label="输出变量（可选）"><el-input :model-value="node.props.output || ''" @update:model-value="prop('output',$event)" placeholder="例如 passed"/><span class="field-help">任务成功后，将此变量设为 true。</span></el-form-item>
     </template>
     <el-form-item v-if="node.type==='condition'" label="条件表达式"><el-input :model-value="node.props.expression" @update:model-value="prop('expression',$event)" type="textarea" :rows="3" placeholder="passed == true"/><span class="field-help">支持比较、逻辑运算和括号。分别从 T / F 端口连接分支。</span></el-form-item>
     <el-form-item v-if="node.type==='delay'" label="等待时长（ms）"><el-input-number :model-value="node.props.wait" @update:model-value="prop('wait',$event)" :min="0" :max="60000" :step="100" controls-position="right"/></el-form-item>
     <div v-if="node.type==='start'||node.type==='end'" class="node-note">{{node.type==='start'?'流程从此处开始，每个方案只能有一个开始节点。':'所有流程在此汇合，每个方案只能有一个结束节点。'}}</div>
    </el-form>
    <div class="coordinate-row"><span>位置</span><code>X {{node.x}} / Y {{node.y}}</code></div>
    <el-button class="remove-node" :disabled="run.active" @click="emit('remove')"><AppIcon name="trash" :size="15"/>删除节点</el-button>
   </template>
   <template v-else>
    <div class="inspector-empty"><div class="inspector-symbol"><AppIcon name="condition" :size="30"/></div><h3>让每一步都有迹可循</h3><p>选择画布上的节点，<br/>查看与调整它的属性。</p></div>
   </template>
   <div class="section-divider"></div>
   <div class="section-label">运行设置 <span>PLAN</span></div>
   <el-form label-position="top" :disabled="run.active">
    <el-form-item label="最大并发数"><el-input-number :model-value="store.meta.maxConcurrency ?? 3" @update:model-value="meta('maxConcurrency',$event)" :min="1" :max="100" controls-position="right"/><span class="field-help">独立任务可同时运行，默认 3 个。</span></el-form-item>
    <div class="switch-field"><div>失败后继续<span>忽略上游失败，执行就绪节点</span></div><el-switch :model-value="Boolean(store.meta.continueOnError)" @update:model-value="meta('continueOnError',$event)"/></div>
    <el-form-item label="方案描述"><el-input :model-value="store.meta.description || ''" @update:model-value="meta('description',$event)" type="textarea" :rows="2" placeholder="为这份编排补充说明…"/></el-form-item>
   </el-form>
   <div v-if="store.issues.length" class="validation-issues"><h4>发现 {{store.issues.length}} 个问题</h4><button v-for="(issue,index) in store.issues" :key="index" @click="issue.nodeId && emit('focus',issue.nodeId)"><span>{{issue.rule}}</span>{{issue.message}}</button></div>
  </div>
 </aside>
</template>
