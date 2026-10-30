<template>
  <v-container class="pa-0" fluid>
    <div class="d-flex align-center flex-wrap ga-2 px-3 py-2">
      <v-icon icon="mdi-vector-polyline" size="small" />
      <span class="text-body-2">BPMN notation</span>
      <v-spacer />
      <span class="text-caption text-medium-emphasis">Skill editor:</span>

      <v-btn-toggle
        density="compact"
        mandatory
        :model-value="skillEditor"
        variant="outlined"
        @update:model-value="setSkillEditor($event)"
      >
        <v-btn size="x-small" value="bpmn">BPMN</v-btn>
        <v-btn size="x-small" value="both">Both</v-btn>
        <v-btn size="x-small" value="classic">Classic</v-btn>
      </v-btn-toggle>
    </div>

    <SkillEditor
      v-if="skillEditor !== 'classic' && submodelId && aasId && submodelElementData?.idShort"
      :aas-id="aasId"
      :graph="BpmnFlowGraph"
      :path="submodelElementData.path"
      :skill="submodelElementData.idShort"
      :submodel-id="submodelId"
    />
  </v-container>
</template>

<script lang="ts" setup>
  import SkillEditor from '@/pages/modules/ProcessSequence/skills/SkillEditor.vue'
  import { setSkillEditor, skillEditor } from '@/pages/modules/ProcessSequence/skills/skillEditorSetting'
  import BpmnFlowGraph from '@/pages/modules/ProcessSequenceBpmn/bpmn/BpmnFlowGraph.vue'
  import { useAASStore } from '@/store/AASDataStore'
  import { base64Decode } from '@/utils/EncodeDecodeUtils'

  // One skill of a resource's Skills submodel (ARSO) in the skill editor, its steps in BPMN notation
  // (module ProcessSequenceBpmn). Next to the classic editor (ArsoSkill_v1_0.vue) or instead of it:
  // the toggle stays here, so either can be brought back.
  defineOptions({
    name: 'ArsoSkillBpmn',
    semanticId: 'https://smartproductionlab.aau.dk/skill',
  })

  const props = defineProps({
    submodelElementData: {
      type: Object as any,
      default: {} as any,
    },
  })

  const aasStore = useAASStore()

  const aasId = computed(() => aasStore.getSelectedAAS?.id ?? '')
  // The element's endpoint names its submodel: .../submodels/<base64url id>/submodel-elements/<path>.
  const submodelId = computed(() => {
    const encoded = String(props.submodelElementData?.path ?? '').split('/submodel-elements/', 1)[0]?.split('/submodels/', 2)[1]
    return encoded ? base64Decode(encoded) : ''
  })
</script>
