<template>
  <v-row>
    <v-col cols="12" lg="4">
      <v-card>
        <v-card-title class="pa-5 pb-1">New order</v-card-title>
        <v-card-subtitle>Request a quantity of a saved product.</v-card-subtitle>

        <v-card-text>
          <v-form class="d-flex flex-column ga-5" @submit.prevent="submit">
            <v-text-field v-model="name" :disabled="disabled" label="Order name" placeholder="e.g. Vial production run" />

            <v-autocomplete
              v-model="productId"
              :disabled="disabled"
              item-title="name"
              item-value="id"
              :items="products"
              label="Order product"
            />

            <v-autocomplete
              v-model="systemId"
              :disabled="disabled"
              item-title="name"
              item-value="id"
              :items="systems"
              label="Order production line"
            />

            <v-text-field
              v-model="quantity"
              :disabled="disabled"
              label="Quantity (units)"
              min="1"
              step="1"
              type="number"
            />

            <div class="text-body-small text-medium-emphasis">Orders reference the saved product recipe and line composition. Placing an order does not start equipment.</div>
            <v-alert v-if="draftIds.size > 0" density="compact" type="info" variant="tonal">Save or discard your current drafts before placing another order.</v-alert>
            <p v-else-if="validation" class="text-body-small text-medium-emphasis" role="status">{{ validation }}</p>

            <v-btn
              block
              color="primary"
              :disabled="disabled || Boolean(validation)"
              prepend-icon="mdi-clipboard-check-outline"
              type="submit"
            >Review order</v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" lg="8">
      <v-card>
        <div class="d-flex align-center flex-wrap ga-3 pa-5">
          <div><h2 class="text-title-large">Orders</h2><p class="text-body-small text-medium-emphasis">{{ orders.length }} production requests in this repository</p></div>
          <v-spacer />

          <v-text-field
            v-model="search"
            aria-label="Search orders"
            class="order-search"
            clearable
            label="Search orders"
            prepend-inner-icon="mdi-magnify"
          />
        </div>

        <v-divider />

        <v-table v-if="filtered.length > 0" class="order-table">
          <thead><tr><th>Order / product</th><th>Production line</th><th class="text-end">Units</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>

          <tbody>
            <tr v-for="order in filtered" :key="order.model.shell.id">
              <td class="py-4"><strong>{{ order.details.name || label(order.model.shell) }}</strong><div class="text-body-small text-medium-emphasis mt-1">{{ nameOf(order.details.productId) }}</div><div class="text-body-small text-medium-emphasis">{{ date(order.details.createdAt) }}</div></td>
              <td>{{ nameOf(order.details.systemId) }}</td>
              <td class="text-end">{{ order.details.quantity }}</td>
              <td><v-chip size="small" variant="tonal">{{ draftIds.has(order.model.shell.id) ? 'Unsaved draft' : order.details.status || 'Not specified' }}</v-chip></td>

              <td><v-btn
                :aria-label="`Inspect order ${order.details.name}`"
                :disabled="draftIds.has(order.model.shell.id)"
                icon="mdi-open-in-new"
                size="small"
                variant="text"
                @click="$emit('inspect', order.model)"
              /></td>
            </tr>
          </tbody>
        </v-table>

        <v-empty-state v-else icon="mdi-clipboard-text-outline" :text="search ? 'Try a different order or product name.' : 'Choose a saved product and production line, then enter the quantity you need.'" :title="search ? 'No matching orders' : 'Your first order starts here'" />
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
  import type { Model } from './model'
  import { isProduct, kind, label, submodel } from './model'
  import { createOrder, orderDetails, orderError } from './orders'
  const props = defineProps<{ models: Model[], draftIds: Set<string>, disabled: boolean }>()
  const emit = defineEmits<{ create: [model: Model], inspect: [model: Model] }>()
  const pending = ref('')
  const name = ref('')
  const quantity = ref('1')
  const productId = ref('')
  const systemId = ref('')
  const search = ref('')
  const products = computed(() => props.models.filter(model => isProduct(model) && !props.draftIds.has(model.shell.id)).map(model => ({ name: label(model.shell), id: model.shell.id })))
  const systems = computed(() => props.models.filter(model => kind(model) === 'System' && !props.draftIds.has(model.shell.id)).map(model => ({ name: label(model.shell), id: model.shell.id })))
  const input = computed(() => ({ name: name.value, quantity: quantity.value, product: props.models.find(model => model.shell.id === productId.value), system: props.models.find(model => model.shell.id === systemId.value) }))
  const validation = computed(() => orderError(input.value))
  const orders = computed(() => props.models.filter(model => submodel(model, 'OrderInformation')).map(model => ({ model, details: orderDetails(model) })).toSorted((a, b) => String(b.details.createdAt).localeCompare(String(a.details.createdAt))))
  const filtered = computed(() => orders.value.filter(order => `${order.details.name} ${nameOf(order.details.productId)} ${nameOf(order.details.systemId)}`.toLowerCase().includes((search.value || '').toLowerCase())))
  watch(() => pending.value && !props.draftIds.has(pending.value), saved => {
    if (!saved) return
    if (props.models.some(model => model.shell.id === pending.value)) name.value = ''
    pending.value = ''
  })
  function nameOf (id: string) {
    return label(props.models.find(model => model.shell.id === id)?.shell) || id || 'Not specified'
  }
  function date (value: string) {
    return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Date not specified'
  }
  function submit () {
    if (props.disabled || validation.value) return
    const model = createOrder(input.value)
    pending.value = model.shell.id
    emit('create', model)
  }
</script>

<style scoped>
.order-search { flex: 0 1 260px; }
.order-table td { max-width: 280px; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
