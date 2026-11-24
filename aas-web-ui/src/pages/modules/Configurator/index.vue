<template>
  <v-defaults-provider :defaults="{ VTextField: { variant: 'outlined', density: 'compact', hideDetails: 'auto' }, VAutocomplete: { variant: 'outlined', density: 'compact', hideDetails: 'auto' }, VSelect: { variant: 'outlined', density: 'compact', hideDetails: 'auto' }, VCard: { rounded: 'lg', flat: true, border: true }, VBtn: { rounded: 'lg' } }">
    <v-container class="configurator pa-4 pa-md-6" fluid>
      <div class="d-flex align-center ga-3 mb-4 flex-wrap">
        <div><h1 class="text-headline-medium">Configurator</h1><p class="text-body-medium">Configure products, arrange your line and place production orders.</p></div>
        <v-spacer />
        <v-chip v-if="dirty" size="small" variant="tonal">{{ changed.length }} unsaved {{ changed.length === 1 ? 'model' : 'models' }}</v-chip>
        <v-btn :disabled="working" prepend-icon="mdi-refresh" variant="text" @click="reload">{{ dirty ? 'Discard drafts and reload' : 'Refresh catalog' }}</v-btn>
        <v-btn color="primary" :disabled="working || !dirty || !editable || needsReload" @click="review = true">Review and save</v-btn>
      </div>

      <v-progress-linear v-if="working" class="mb-3" indeterminate />

      <v-alert
        v-if="error"
        class="mb-3"
        closable
        density="compact"
        type="warning"
        variant="tonal"
        @click:close="error = ''"
      >{{ error }}</v-alert>

      <v-alert
        v-if="notice"
        class="mb-3"
        closable
        density="compact"
        type="success"
        variant="tonal"
        @click:close="notice = ''"
      >{{ notice }}</v-alert>

      <v-alert v-if="!editable" class="mb-3" density="compact" type="info">Read-only access. Enable editing in the Web UI configuration to change AAS models.</v-alert>
      <v-tabs v-model="tab" class="workspace-tabs mb-5" color="primary"><v-tab prepend-icon="mdi-package-variant-closed" value="products">Products</v-tab><v-tab prepend-icon="mdi-floor-plan" value="lines">Production lines</v-tab><v-tab prepend-icon="mdi-link-variant" value="processes">Process assignments</v-tab><v-tab prepend-icon="mdi-clipboard-text-outline" value="orders">Orders</v-tab></v-tabs>

      <template v-if="tab === 'products'">
        <div class="selection-toolbar d-flex ga-3 align-center flex-wrap pa-4 mb-5">
          <v-autocomplete
            v-model="productId"
            :disabled="working || dirty"
            item-title="name"
            item-value="id"
            :items="products.map(item => ({ name: label(item.shell), id: item.shell.id }))"
            label="Product AAS"
          />

          <v-btn :disabled="working || dirty || !editable || !environment.getAllowUploading" prepend-icon="mdi-plus" @click="newDialog = true">New product</v-btn>
          <v-btn :disabled="!product || dirty || working" variant="text" @click="openSequence">Process sequence</v-btn>
        </div>

        <ProductEditor
          v-if="product"
          :key="product.shell.id"
          :model-value="product"
          :readonly="!editable || working || needsReload"
          @change="markChanged(product!.shell.id)"
          @update:model-value="replace"
        />

        <v-empty-state v-else icon="mdi-package-variant-closed" text="Select a product or create one from the lab’s vial, syringe or cartridge reference model." title="Product configuration" />
      </template>

      <template v-else-if="tab === 'lines'">
        <div class="selection-toolbar d-flex ga-3 align-center flex-wrap pa-4 mb-5">
          <v-autocomplete
            v-model="systemId"
            :disabled="working || dirty"
            item-title="name"
            item-value="id"
            :items="systems.map(item => ({ name: label(item.shell), id: item.shell.id }))"
            label="Production system AAS"
          />

          <v-btn :disabled="working || dirty || !editable || !environment.getAllowUploading || tables.length === 0" prepend-icon="mdi-plus" @click="createSystemDialog = true">New production line</v-btn>
          <v-btn :disabled="working || dirty || !editable || !system" prepend-icon="mdi-database-clock-outline" variant="text" @click="recordHistory">Record coordinate history</v-btn>
        </div>

        <LineEditor
          v-if="system"
          :key="system.shell.id"
          v-model="models"
          :readonly="!editable || working || needsReload"
          :system="system"
          @change="markChanged(...$event)"
          @inspect="inspect"
        />

        <v-empty-state v-else icon="mdi-factory" text="Select a production system with a hierarchy of resource asset references." title="Production line configuration" />
      </template>

      <OrdersPanel
        v-else-if="tab === 'orders'"
        :disabled="working || dirty || needsReload || !editable || !environment.getAllowUploading"
        :draft-ids="editedIds"
        :models="models"
        @create="addOrder"
        @inspect="inspect"
      />

      <ProcessAssignments
        v-else
        v-model:product-id="productId"
        v-model:system-id="systemId"
        :dirty="dirty"
        :editable="editable"
        :needs-reload="needsReload"
        :processes="processes"
        :products="products"
        :systems="systems"
        :uploading="environment.getAllowUploading"
        :working="working"
        :writing="writing"
        @inspect="inspect"
        @write="writeProcessAas"
      />

      <CreateSystemDialog v-model="createSystemDialog" :existing-ids="models.map(model => model.shell.id)" :tables="tables" @create="addSystem" />

      <v-dialog v-model="newDialog" max-width="600">
        <v-card title="Create product AAS">
          <v-card-text>
            <v-select
              v-model="family"
              item-title="name"
              item-value="id"
              :items="families"
              label="Reference product family"
            />

            <v-text-field v-model="newName" label="Product name" />
            <v-text-field v-model="newId" hint="A globally unique identifier for the new product. Existing models are never replaced." label="AAS identifier" persistent-hint />
            <p class="mt-4 text-body-small">Starts with the reference family’s components, parameters, capability requirements and recipe. Review the draft before publishing.</p>
          </v-card-text>

          <v-card-actions><v-btn @click="newDialog = false">Cancel</v-btn><v-spacer /><v-btn :disabled="!newName.trim() || !newId.trim()" @click="create">Create draft</v-btn></v-card-actions>
        </v-card>
      </v-dialog>

      <v-dialog v-model="review" max-width="640" :persistent="working">
        <v-card :title="orderDraft ? 'Place production order' : 'Publish AAS changes'">
          <v-card-text><div v-if="orderDraft" class="mb-4 pa-4 bg-surface-light rounded-lg">
                         <div class="text-title-medium">{{ orderDetails(orderDraft!).name }}</div>
                         <p class="mt-2">{{ orderDetails(orderDraft!).quantity }} units of {{ label(models.find(item => item.shell.id === orderDetails(orderDraft!).productId)?.shell) }}</p>
                         <p>Line: {{ label(models.find(item => item.shell.id === orderDetails(orderDraft!).systemId)?.shell) }}</p>
                         <p class="text-body-small mt-3">The order will be saved with status Created. Equipment execution is handled separately.</p>
                       </div>

            <p v-else class="mb-3">{{ changed.length }} AAS model(s) will be updated in the selected infrastructure. Changes to module placement are shared by every line referencing that resource.</p>
            <v-list-item v-for="model in changed" :key="model.shell.id" :subtitle="model.shell.id" :title="label(model.shell)" />
            <p class="mt-3 text-body-small">Existing recipe and skill documents are preserved. Product or line changes may require revalidation of Process AAS bindings. Saving does not deploy or run the equipment.</p>
          </v-card-text>

          <v-card-actions><v-btn :disabled="working" @click="cancelReview">Cancel</v-btn><v-spacer /><v-btn color="primary" :loading="working" @click="save">{{ orderDraft ? 'Place order' : 'Save and read back' }}</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
    </v-container>
  </v-defaults-provider>
</template>

<script setup lang="ts">
  import type { Model } from './model'
  import { onBeforeRouteLeave, useRouter } from 'vue-router'
  import { useEnvStore } from '@/store/EnvironmentStore'
  import { useInfrastructureStore } from '@/store/InfrastructureStore'
  import { processLine, writeProcess } from '../ProcessSequence/skills/skillService'
  import CreateSystemDialog from './CreateSystemDialog.vue'
  import LineEditor from './LineEditor.vue'
  import { asset, children, clone, coordinate, entry, families, isProduct, kind, label, newProduct, submodel } from './model'
  import { orderDetails } from './orders'
  import OrdersPanel from './OrdersPanel.vue'
  import ProcessAssignments from './ProcessAssignments.vue'
  import ProductEditor from './ProductEditor.vue'
  import { useRepository } from './useRepository'
  defineOptions({ inheritAttrs: false, moduleTitle: 'Configurator', isDesktopModule: true, isOnlyVisibleWithSelectedAas: false, preserveRouteQuery: true })
  const repository = useRepository()
  const environment = useEnvStore()
  const infrastructure = useInfrastructureStore()
  const router = useRouter()
  const models = ref<Model[]>([])
  const baselines = shallowRef<Model[]>([])
  const editedIds = ref(new Set<string>())
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  const needsReload = ref(false)
  const tab = ref('products')
  const productId = ref('')
  const systemId = ref('')
  const newDialog = ref(false)
  const createSystemDialog = ref(false)
  const review = ref(false)
  const family = ref('vial')
  const newName = ref('')
  const newId = ref(`urn:uuid:${crypto.randomUUID()}`)
  const writing = ref(false)
  const working = computed(() => busy.value || writing.value)
  const tables = computed(() => models.value.filter(model => coordinate(model, 'TableBase')))
  let generation = 0
  const editable = computed(() => environment.getAllowEditing)
  const products = computed(() => models.value.filter(isProduct))
  const systems = computed(() => models.value.filter(model => kind(model) === 'System'))
  const processes = computed(() => models.value.filter(model => submodel(model, 'ProcessInformation')))
  const product = computed(() => products.value.find(model => model.shell.id === productId.value))
  const system = computed(() => systems.value.find(model => model.shell.id === systemId.value))
  const changed = computed(() => models.value.filter(model => editedIds.value.has(model.shell.id)))
  const orderDraft = computed(() => changed.value.length === 1 && submodel(changed.value[0]!, 'OrderInformation') ? changed.value[0] : undefined)
  function markChanged (...ids: string[]) {
    for (const id of ids) editedIds.value.add(id)
  }
  function addSystem (model: Model) {
    models.value.push(model)
    systemId.value = model.shell.id
    markChanged(model.shell.id)
  }
  function addOrder (model: Model) {
    if (working.value || dirty.value || !editable.value || !environment.getAllowUploading) return
    models.value.push(model)
    markChanged(model.shell.id)
    review.value = true
  }
  const dirty = computed(() => changed.value.length > 0)
  onBeforeRouteLeave(() => !working.value && (!dirty.value || window.confirm('Leave and discard unsaved configurator changes?')))
  watch(() => [infrastructure.getSelectedInfrastructure?.id, infrastructure.getAASRepoURL, infrastructure.getSubmodelRepoURL], () => {
    models.value = []
    baselines.value = []
    editedIds.value.clear()
    newDialog.value = false
    createSystemDialog.value = false
    review.value = false
    void refresh()
  }, { immediate: true })
  onBeforeUnmount(() => generation++)
  async function refresh () {
    const ticket = ++generation
    busy.value = true
    error.value = ''
    try {
      const result = await repository.catalog()
      if (ticket !== generation) return
      models.value = clone(result.models)
      baselines.value = result.models
      editedIds.value.clear()
      needsReload.value = false
      if (!products.value.some(model => model.shell.id === productId.value)) productId.value = products.value[0]?.shell.id ?? ''
      if (!systems.value.some(model => model.shell.id === systemId.value)) systemId.value = systems.value[0]?.shell.id ?? ''
      if (result.failures.length > 0) error.value = `Could not load: ${result.failures.join(', ')}. Those models are not available for editing.`
    } catch (error_) {
      if (ticket === generation) error.value = String(error_)
    } finally {
      if (ticket === generation) busy.value = false
    }
  }
  function reload () {
    if (!dirty.value || window.confirm('Discard unsaved configurator changes?')) void refresh()
  }
  function replace (model: Model) {
    models.value = models.value.map(old => old.shell.id === model.shell.id ? model : old)
  }
  function create () {
    try {
      if (models.value.some(model => model.shell.id === newId.value.trim())) throw new Error('That AAS identifier already exists.')
      const referenceName = { vial: 'Vial2mLAAS', syringe: 'PrefilledSyringe1mLAAS', cartridge: 'Cartridge3mLAAS' }[family.value]
      const reference = baselines.value.find(item => item.shell.idShort === referenceName && isProduct(item))
      const model = newProduct(family.value, newName.value, newId.value.trim(), reference)
      models.value.push(model)
      markChanged(model.shell.id)
      productId.value = model.shell.id
      newDialog.value = false
      newId.value = `urn:uuid:${crypto.randomUUID()}`
    } catch (error_) {
      error.value = String(error_)
    }
  }
  function cancelReview () {
    if (orderDraft.value) {
      const id = orderDraft.value.shell.id
      models.value = models.value.filter(model => model.shell.id !== id)
      editedIds.value.delete(id)
    }
    review.value = false
  }
  async function save () {
    const ticket = generation
    busy.value = true
    notice.value = ''
    error.value = ''
    try {
      const draft = clone(changed.value)
      const fresh = draft.filter(model => !baselines.value.some(old => old.shell.id === model.shell.id))
      const saved = await repository.save(draft, clone(baselines.value), fresh.length > 0)
      if (ticket !== generation) return
      for (const model of saved) {
        replace(clone(model))
        editedIds.value.delete(model.shell.id)
        baselines.value = [...baselines.value.filter(old => old.shell.id !== model.shell.id), clone(model)]
      }
      notice.value = 'Saved and read back from the AAS repository.'
    } catch (error_) {
      if (ticket === generation) {
        error.value = String(error_)
        needsReload.value = true
      }
    } finally {
      if (ticket === generation) {
        busy.value = false
        review.value = false
      }
    }
  }
  async function recordHistory () {
    if (working.value || dirty.value || !editable.value || !system.value) return
    const ticket = generation
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
      const assets = new Set(children(entry(system.value)).map(node => node.globalAssetId))
      const count = await repository.recordCoordinates(models.value.filter(model => assets.has(asset(model))))
      if (ticket !== generation) return
      await refresh()
      notice.value = `Recorded ${count} coordinate points in InfluxDB.`
    } catch (error_) {
      if (ticket === generation) {
        error.value = String(error_); needsReload.value = true
      }
    } finally {
      if (ticket === generation) busy.value = false
    }
  }
  async function inspect (model: Model) {
    try {
      await router.push({ path: '/aasviewer', query: { aas: await repository.getAasEndpointById(model.shell.id) } })
    } catch (error_) {
      error.value = String(error_)
    }
  }
  /** Have the skill service write the selected product's Process AAS on the selected line, then read the catalog again. */
  async function writeProcessAas () {
    if (working.value || dirty.value || needsReload.value || !editable.value || !environment.getAllowUploading || !productId.value || !systemId.value) return
    const ticket = generation
    writing.value = true
    error.value = ''
    notice.value = ''
    try {
      const written = await writeProcess(productId.value, { line: systemId.value })
      if (ticket !== generation) return
      await refresh()
      notice.value = processLine(written)
    } catch (error_) {
      if (ticket === generation) error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      writing.value = false
    }
  }
  async function openSequence () {
    if (!product.value) return
    try {
      await router.push({ path: '/modules/processsequence', query: { aas: await repository.getAasEndpointById(product.value.shell.id) } })
    } catch (error_) {
      error.value = String(error_)
    }
  }
</script>

<style scoped>
.configurator { max-width: 1600px; margin-inline: auto; }
.workspace-tabs { border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.selection-toolbar { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; background: rgb(var(--v-theme-surface)); }
.selection-toolbar :deep(.v-autocomplete) { flex: 1 1 260px; }
.configurator :deep(.v-card-text > .v-input + .v-input) { margin-top: 18px; }
</style>
