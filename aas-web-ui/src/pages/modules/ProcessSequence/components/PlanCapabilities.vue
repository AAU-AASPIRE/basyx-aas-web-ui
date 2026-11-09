<template>
  <InspectorSection
    collapsible
    color="success"
    help="The skill service matches capability meanings, values, ranges and units across all resources, and says which are offered only after a reconfiguration. Choose one station skill per step. Additional constraints require separate checks."
    :initially-open="false"
    :summary="`${requirements.length} required`"
    title="Capabilities"
  >
    <template #actions>
      <v-btn
        color="blue-darken-2"
        :disabled="loading || requirements.length === 0"
        :loading="loading || matching"
        size="small"
        variant="flat"
        @click="showMatches = true"
      >Match resources</v-btn>
    </template>

    <v-select
      chips
      closable-chips
      density="compact"
      hide-details="auto"
      item-title="title"
      item-value="key"
      :items="options"
      label="Required capabilities"
      :loading="loading"
      :model-value="requirements.map(item => referenceKey(item.reference))"
      multiple
      @update:model-value="setRequirements"
    >
      <template #chip="{ props: chipProps, item }">
        <v-tooltip location="top" max-width="400" :text="item.reference.keys.map(key => key.value).join(' / ')">
          <template #activator="{ props: activator }"><v-chip v-bind="{ ...chipProps, ...activator }" :text="item.name" /></template>
        </v-tooltip>
      </template>
    </v-select>

    <div class="d-flex align-center flex-wrap mt-2 ga-1">
      <v-chip size="x-small" variant="tonal">{{ node.requiredCapabilities === undefined ? 'From process' : 'Step override' }}</v-chip>
      <v-btn v-if="node.requiredCapabilities !== undefined" size="x-small" variant="text" @click="delete node.requiredCapabilities">Use process requirements</v-btn>
    </div>

    <v-alert v-if="requirements.some(requirement => !resolved(requirement))" class="mt-2" density="compact" type="warning">Some requirements could not be resolved.</v-alert>
    <v-alert v-if="error && !showMatches" class="mt-2" density="compact" type="warning">{{ error }}</v-alert>
    <v-btn v-if="error && !showMatches" size="small" variant="text" @click="refresh">Retry capability catalog</v-btn>

    <PlanResourceMatches
      v-model="showMatches"
      :binding="binding"
      :error="matchError || error"
      :loading="matching"
      :matches="matches"
      :resources="resources"
      @assign="assign"
    />
  </InspectorSection>
</template>

<script setup lang="ts">
  import type { CapabilityRequirement, StepNode } from '../types/plan'
  import type { CapabilityDescription } from '../utils/capabilities'
  import type { CapabilityMatch } from '../utils/capabilityMatching'
  import { useAASStore } from '@/store/AASDataStore'
  import { usePlanSources } from '../composables/usePlanSources'
  import { referenceKey } from '../utils/capabilities'
  import { matchResources } from '../utils/capabilityMatching'
  import { realizing } from '../utils/matchAndPlan'
  import { assignSkill } from '../utils/skillAssignment'
  import InspectorSection from './InspectorSection.vue'
  import PlanResourceMatches from './PlanResourceMatches.vue'

  const props = defineProps<{ resources: { id: string, name: string }[], inherited: CapabilityRequirement[] }>()
  const node = defineModel<StepNode>({ required: true })
  const aasStore = useAASStore()
  const { loadCapabilities, loadSkills } = usePlanSources()
  const catalog = ref<CapabilityDescription[]>([])
  const loading = ref(false)
  const error = ref('')
  const binding = ref(false)
  const showMatches = ref(false)
  /** How the resources answer the step, as the skill service last said; why it did not, if it did not. */
  const matches = ref<CapabilityMatch[]>([])
  const matching = ref(false)
  const matchError = ref('')
  let generation = 0
  let asked = 0
  const requirements = computed(() => node.value.requiredCapabilities ?? props.inherited)
  const owners = computed(() => [...new Set([String(aasStore.getSelectedAAS?.id ?? ''), node.value.process?.source.aasId ?? '', ...props.resources.map(resource => resource.id)])].filter(Boolean))
  const options = computed(() => {
    const selected = new Map(requirements.value.map(item => [referenceKey(item.reference), item]))
    const requiredOwners = new Set([String(aasStore.getSelectedAAS?.id ?? ''), node.value.process?.source.aasId])
    for (const item of catalog.value.filter(item => item.role === 'Required' && requiredOwners.has(item.aasId))) {
      selected.set(referenceKey(item.reference), item)
    }
    return [...selected].map(([key, item]) => ({ ...item, key, title: item.name }))
  })

  watch(owners, refresh, { immediate: true })
  watch(() => [node.value.id, node.value.process], () => {
    showMatches.value = false
  })
  // While the matches are shown they follow the step's requirements, its recipe and the resources.
  watch([showMatches, requirements, () => node.value.process?.parameters, () => props.resources], ([open]) => {
    if (open) {
      void match()
    }
  }, { deep: true })
  onBeforeUnmount(() => {
    generation++
    asked++
  })

  /** Ask the skill service how the resources answer the step; only the last question's answer is kept. */
  async function match (): Promise<void> {
    const ticket = ++asked
    matching.value = true
    matchError.value = ''
    try {
      const found = await matchResources(requirements.value, node.value.process?.parameters ?? [], props.resources.map(resource => resource.id))
      if (ticket === asked) {
        matches.value = found.matches
      }
    } catch (error_) {
      if (ticket === asked) {
        matches.value = []
        matchError.value = `Matching needs the skill service. ${error_ instanceof Error ? error_.message : String(error_)}`
      }
    } finally {
      if (ticket === asked) {
        matching.value = false
      }
    }
  }

  function resolved (requirement: CapabilityRequirement): boolean {
    return requirement.reference.type === 'ExternalReference'
      || catalog.value.some(item => referenceKey(item.reference) === referenceKey(requirement.reference))
  }

  async function assign (match: CapabilityMatch): Promise<void> {
    const selectedNode = node.value
    const selectedProcess = selectedNode.process
    binding.value = true
    error.value = ''
    try {
      const skills = await loadSkills(match.aasId)
      if (node.value !== selectedNode || node.value.process !== selectedProcess) return
      const skill = realizing(match, skills)
      if (!skill) {
        error.value = 'No single skill is linked to all matching capabilities. Select and verify a skill explicitly.'
        return
      }
      node.value.resourceAasId = match.aasId
      assignSkill(node.value, skill)
      node.value.executionMode = 'station'
      showMatches.value = false
    } catch {
      error.value = 'The station skill could not be loaded.'
    } finally {
      binding.value = false
    }
  }

  function setRequirements (keys: string[]): void {
    node.value.requiredCapabilities = keys.flatMap(key => {
      const item = options.value.find(item => item.key === key)
      return item ? [{ name: item.name, reference: structuredClone(toRaw(item.reference)) }] : []
    })
  }

  async function refresh (): Promise<void> {
    const ticket = ++generation
    loading.value = true
    error.value = ''
    const results = await Promise.allSettled(owners.value.map(id => loadCapabilities(id)))
    if (ticket !== generation) {
      return
    }
    catalog.value = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    if (results.some(result => result.status === 'rejected')) {
      error.value = 'Some capability descriptions could not be loaded. Candidate results may be incomplete.'
    }
    loading.value = false
  }
</script>
