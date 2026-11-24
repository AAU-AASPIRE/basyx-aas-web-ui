<template>
  <v-row>
    <v-col cols="12" md="3">
      <v-card border flat>
        <v-card-title class="d-flex align-center">Components<v-spacer /><v-btn :disabled="readonly" size="small" variant="text" @click="add">Add</v-btn></v-card-title>

        <ol aria-label="Assembly order" class="component-list">
          <li
            v-for="(part, index) in items"
            :key="part.path.join('.')"
            class="component-row"
            :class="{ 'insert-before': over === part.path.join('.') && edge === 'before', 'insert-after': over === part.path.join('.') && edge === 'after', 'is-dragging': dragging === part.path.join('.') }"
            :draggable="!readonly"
            @dragend="dragging = ''; over = ''"
            @dragleave="over = ''"
            @dragover="hover($event, part)"
            @dragstart="drag($event, part)"
            @drop.stop.prevent="reorder($event, part)"
          >
            <v-icon class="drag-handle" icon="mdi-drag-vertical" size="small" />
            <button class="component-label" @click="edit(part)"><strong>{{ '> '.repeat(part.depth) }}{{ label(part.node) }}</strong><small>{{ field(part.node, 'Quantity')?.value }} {{ field(part.node, 'QuantityUnit')?.value }}</small></button>

            <v-btn
              :aria-label="`Move ${label(part.node)} up`"
              :disabled="readonly || index === 0"
              icon="mdi-arrow-up"
              size="x-small"
              variant="text"
              @click.stop="moveUp(part, index)"
            />

            <v-btn
              :aria-label="`Delete ${label(part.node)}`"
              :disabled="readonly"
              icon="mdi-trash-can-outline"
              size="x-small"
              variant="text"
              @click.stop="deleting = part"
            />
          </li>
        </ol>
      </v-card>

      <p class="text-body-small mt-2">The assembly builds from bottom to top. Drag siblings to reorder the illustration. Recipe execution order stays in Process Sequence.</p>
    </v-col>

    <v-col cols="12" md="9"><v-card border flat><v-card-subtitle class="pt-4">Assembly explorer · schematic, not to scale</v-card-subtitle><ProductAssembly :model="model" :readonly="readonly" @reorder="move" @select="edit" /></v-card></v-col>

    <v-col cols="12">
      <v-expansion-panels><v-expansion-panel title="Product and process parameters"><v-expansion-panel-text>
        <v-row><v-col v-for="(parameter, index) in parameters" :key="index" cols="12" md="4">
          <v-text-field
            density="compact"
            :label="`${label(parameter)}${unit(parameter) ? ` (${unit(parameter)})` : ''}`"
            :model-value="parameter.value"
            :readonly="readonly"
            @change="changeParameter(parameter, $event.target.value)"
          />
        </v-col></v-row>
      </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
    </v-col>
  </v-row>

  <v-alert
    v-if="error"
    class="my-3"
    closable
    type="warning"
    @click:close="error = ''"
  >{{ error }}</v-alert>

  <v-dialog v-model="dialog" max-width="620">
    <v-card :title="adding ? titles[step] : 'Component details'">
      <v-card-subtitle v-if="adding">Add component &middot; Step {{ step + 1 }} of 3</v-card-subtitle>

      <ol v-if="adding" aria-label="Component setup progress" class="wizard-progress px-6 pt-5 pb-2">
        <li v-for="(title, index) in ['Component', 'Parameters', 'Assembly']" :key="title" :aria-current="step === index ? 'step' : undefined" :class="{ active: step === index, complete: step > index }"><span>{{ index + 1 }}</span>{{ title }}</li>
      </ol>

      <v-card-text>
        <v-form class="d-flex flex-column ga-5" @submit.prevent="advance">
          <template v-if="!adding || step === 0">
            <p v-if="adding" class="text-body-small text-medium-emphasis">Choose a name and the symbol shown in the assembly explorer.</p>
            <v-text-field v-model="name" label="Component name" :readonly="readonly" />
            <v-select v-if="adding" v-model="representation" :items="['Vial', 'Barrel', 'Cartridge', 'Liquid', 'Stopper', 'Cap', 'Component']" label="Component type" />
          </template>

          <template v-if="!adding || step === 1">
            <p v-if="adding" class="text-body-small text-medium-emphasis">Set the amount of this component used in one product.</p>

            <v-text-field
              v-model="quantity"
              label="Quantity"
              min="0"
              :readonly="readonly"
              step="any"
              type="number"
            />

            <v-text-field v-model="quantityUnit" label="Unit" :readonly="readonly || Boolean(quantityParameter)" />
            <p v-if="quantityParameter" class="text-body-small">Quantity is linked to {{ label(quantityParameter) }} and updates that product parameter.</p>
            <p v-if="!validQuantity" class="text-body-small text-error" role="status">Enter a positive quantity and a unit.</p>
          </template>

          <template v-if="adding && step === 2">
            <div class="pa-4 rounded-lg bg-surface-light">
              <div class="text-title-medium">{{ name }}</div>
              <p class="text-body-medium mt-1">{{ quantity }} {{ quantityUnit }} &middot; {{ representation }}</p>
            </div>

            <v-select
              v-model="parent"
              item-title="name"
              item-value="path"
              :items="parents"
              label="Parent component"
            />

            <p class="text-body-small text-medium-emphasis">Nested components appear directly above their parent. You can drag them into a different order within that group later.</p>
            <p class="text-body-small text-medium-emphasis">This adds a bill-of-material component. Assign any production steps in the Process Sequence editor.</p>
          </template>

          <p v-if="!adding" class="text-body-small text-medium-emphasis">The component identity is preserved so process material references remain valid.</p>
          <button class="d-none" tabindex="-1" type="submit">Continue</button>
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 ga-2">
        <v-btn @click="dialog = false">Cancel</v-btn>
        <v-btn v-if="!adding && selected" color="error" :disabled="readonly" @click="deleting = selected">Delete component</v-btn>
        <v-spacer />
        <v-btn v-if="adding && step > 0" @click="step--">Back</v-btn>

        <v-btn
          v-if="adding && step < 2"
          color="primary"
          :disabled="readonly || !canAdvance"
          variant="flat"
          @click="advance"
        >Next</v-btn>

        <v-btn
          v-else
          color="primary"
          :disabled="readonly || !name.trim() || !validQuantity"
          variant="flat"
          @click="apply"
        >{{ adding ? 'Add to assembly' : 'Apply' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog max-width="480" :model-value="Boolean(deleting)" @update:model-value="!$event && (deleting = undefined)">
    <v-card title="Delete component?">
      <v-card-text>
        <p><strong>{{ label(deleting?.node) }}</strong> will be removed from this product{{ descendants ? ` together with ${descendants} nested component(s)` : '' }}.</p>
        <p class="mt-3 text-body-small text-medium-emphasis">Its process material uses will also be removed. Recipe steps stay in place; review them in Process Sequence. Changes remain in your draft until you save.</p>

        <v-alert
          v-if="deleteError"
          class="mt-3"
          density="compact"
          type="error"
          variant="tonal"
        >{{ deleteError }}</v-alert>
      </v-card-text>

      <v-card-actions><v-btn @click="deleting = undefined">Keep component</v-btn><v-spacer /><v-btn color="error" :disabled="readonly" variant="flat" @click="deleteComponent">Delete from product</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import type { Element, Model, Part } from './model'
  import { assemblyParts, children, entry, field, label, newPart, properties, removePart, resolve, semantic, setParameter, submodel, walk } from './model'
  import ProductAssembly from './ProductAssembly.vue'
  const model = defineModel<Model>({ required: true })
  const props = defineProps<{ readonly: boolean }>()
  const emit = defineEmits<{ change: [] }>()
  const dragging = ref('')
  const over = ref('')
  const edge = ref<'before' | 'after'>('before')
  const items = computed(() => assemblyParts(model.value))
  const parameters = computed(() => {
    const seen = new Set<string>()
    return properties(model.value).filter(item => {
      const meaning = semantic(item)
      if (!meaning.startsWith('https://smartproductionlab.aau.dk/semantics/') || seen.has(meaning)) return false
      seen.add(meaning)
      return true
    })
  })
  const parents = computed(() => [{ name: 'Product', path: '' }, ...items.value.map(part => ({ name: label(part.node), path: part.path.join('.') }))])
  const dialog = ref(false)
  const adding = ref(false)
  const step = ref(0)
  const titles = ['Choose a component', 'Set its parameters', 'Place in the assembly']
  const selected = ref<Part>()
  const deleting = ref<Part>()
  const deleteError = ref('')
  const descendants = computed(() => deleting.value ? walk(deleting.value.node).filter(node => node.modelType === 'Entity').length - 1 : 0)
  watch(deleting, () => {
    deleteError.value = ''
  })
  const name = ref('')
  const quantity = ref('1')
  const quantityUnit = ref('piece')
  const representation = ref('Component')
  const parent = ref('')
  const error = ref('')
  const validQuantity = computed(() => quantity.value.trim() !== '' && Number.isFinite(Number(quantity.value)) && Number(quantity.value) > 0 && quantityUnit.value.trim() !== '')
  const canAdvance = computed(() => step.value === 0 ? Boolean(name.value.trim()) : validQuantity.value)
  const quantityParameter = computed(() => {
    if (adding.value || !selected.value) return
    const use = walk(submodel(model.value, 'ProcessParameters')).find(node => resolve(model.value, field(node, 'MaterialReference')?.value) === selected.value?.node && field(node, 'QuantityParameterReference'))
    return resolve(model.value, field(use, 'QuantityParameterReference')?.value)
  })
  const unit = (node: Element) => node.qualifiers?.find((item: Element) => item.type === 'Unit')?.value ?? ''
  function edit (part: Part) {
    if (dragging.value) return
    selected.value = part
    adding.value = false
    name.value = label(part.node)
    quantity.value = field(part.node, 'Quantity')?.value ?? '1'
    quantityUnit.value = field(part.node, 'QuantityUnit')?.value ?? 'piece'
    dialog.value = true
  }
  function add () {
    if (props.readonly) return
    step.value = 0
    representation.value = 'Component'
    selected.value = undefined
    adding.value = true
    name.value = ''
    quantity.value = '1'
    quantityUnit.value = 'piece'
    parent.value = ''
    dialog.value = true
  }
  function advance () {
    if (props.readonly) return
    if (adding.value && step.value < 2) {
      if (canAdvance.value) step.value++
    } else apply()
  }
  function apply () {
    if (props.readonly || (adding.value && step.value !== 2)) return
    if (!name.value.trim() || !quantity.value.trim() || !Number.isFinite(Number(quantity.value)) || Number(quantity.value) <= 0 || !quantityUnit.value.trim()) {
      error.value = 'Enter a name, a positive quantity and a unit.'
      return
    }
    const property = (idShort: string, value: string, valueType = 'xs:string') => ({ modelType: 'Property', idShort, value, valueType, semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: `https://smartproductionlab.aau.dk/semantics/${idShort}` }] } })
    if (adding.value) {
      const root = parent.value ? items.value.find(part => part.path.join('.') === parent.value)?.node : entry(model.value)
      if (!root) return
      root.statements ??= []
      root.statements.push(newPart(representation.value, name.value, quantity.value, quantityUnit.value))
    } else if (selected.value) {
      const node = selected.value.node
      if (quantityParameter.value) setParameter(model.value, quantityParameter.value, quantity.value)
      node.displayName = [{ language: 'en', text: name.value }]
      for (const next of [property('Quantity', quantity.value, 'xs:double'), property('QuantityUnit', quantityUnit.value)]) {
        const old = field(node, next.idShort)
        if (old) old.value = next.value
        else (node.statements ??= []).push(next)
      }
    }
    dialog.value = false
    emit('change')
  }
  function deleteComponent () {
    if (props.readonly || !deleting.value) return
    try {
      model.value = removePart(model.value, deleting.value.path)
      deleting.value = undefined
      selected.value = undefined
      dialog.value = false
      emit('change')
    } catch (error_) {
      deleteError.value = error_ instanceof Error ? error_.message : String(error_)
    }
  }
  function changeParameter (node: Element, value: string) {
    try {
      setParameter(model.value, node, value)
      emit('change')
    } catch (error_) {
      error.value = String(error_)
    }
  }
  function drag (event: DragEvent, part: Part) {
    dragging.value = part.path.join('.')
    event.dataTransfer?.setData('application/x-configurator-part', dragging.value)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
  function move (source: Part | undefined, target: Part, position: 'before' | 'after' = 'before') {
    if (props.readonly || !source || source === target || source.path.slice(0, -1).join('.') !== target.path.slice(0, -1).join('.')) return
    const root = source.depth === 0 ? entry(model.value) : items.value.find(item => item.path.join('.') === source.path.slice(0, -1).join('.'))?.node
    if (!root) return
    const members = children(root)
    const from = members.indexOf(source.node)
    if (from === -1 || !members.includes(target.node)) return
    members.splice(from, 1)
    const to = members.indexOf(target.node) + (position === 'before' ? 1 : 0)
    members.splice(to, 0, source.node)
    emit('change')
  }
  function hover (event: DragEvent, part: Part) {
    const source = items.value.find(item => item.path.join('.') === dragging.value)
    if (props.readonly || !source || source === part || source.path.slice(0, -1).join('.') !== part.path.slice(0, -1).join('.')) return
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    edge.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    over.value = part.path.join('.')
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }
  function reorder (event: DragEvent, target: Part) {
    move(items.value.find(item => item.path.join('.') === (event.dataTransfer?.getData('application/x-configurator-part') || dragging.value)), target, edge.value)
    dragging.value = ''
    over.value = ''
  }
  function moveUp (part: Part, index: number) {
    if (items.value[index - 1]) move(part, items.value[index - 1]!)
  }
</script>

<style scoped>
.wizard-progress { display: flex; list-style: none; gap: 12px; }
.wizard-progress li { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 13px; color: rgba(var(--v-theme-on-surface), .6); }
.wizard-progress span { display: grid; place-items: center; width: 26px; height: 26px; flex-shrink: 0; border: 1px solid rgba(var(--v-border-color), .3); border-radius: 50%; }
.wizard-progress .active { color: rgb(var(--v-theme-primary)); font-weight: 600; }
.wizard-progress .active span { background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); border-color: transparent; }
.wizard-progress .complete span { background: rgba(var(--v-theme-primary), .12); color: rgb(var(--v-theme-primary)); }

.component-list { list-style: none; padding: 0 8px 8px; }
.component-row { position: relative; display: flex; align-items: center; gap: 8px; border: 2px solid transparent; border-radius: 6px; padding: 10px 4px; cursor: grab; }
.component-row.insert-before::before, .component-row.insert-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 3px; border-radius: 2px; background: rgb(var(--v-theme-primary)); z-index: 2; }
.component-row.insert-before::before { top: -3px; }
.component-row.insert-after::after { bottom: -3px; }
.component-row.is-dragging { opacity: .5; }
.component-row:hover { background: rgba(var(--v-theme-on-surface), .035); }
.component-label { border: 0; background: transparent; padding: 6px; border-radius: 6px; font: inherit; cursor: pointer; min-width: 0; flex: 1; text-align: start; color: inherit; }
.component-label strong, .component-label small { display: block; }
.component-label small { opacity: .65; margin-top: 4px; }
.drag-handle { opacity: .5; }
</style>
