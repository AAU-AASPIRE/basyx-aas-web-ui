/**
 * Capability matching: does a resource offer what a step requires, and with which skill. The skill
 * service answers it (POST /match: modreg.match of iec61499-mgmt-py, the one matcher the line's
 * agents, the plan check and the evaluation use as well); here the types the planner holds and the
 * client that asks it.
 */
import type { Requirement } from '../skills/skillService'
import type { CapabilityRequirement, PlanParameter } from '../types/plan'
import type { Availability, CapabilityDescription } from './capabilities'
import { capabilitySemantic } from '../constants/capabilities'
import { ask, skillServiceUrl } from '../skills/skillService'
import { canonicalMeaning } from './parameterSemantics'
import { childrenOf, semanticId } from './planSources'

export type CapabilityProperty = {
  name: string
  semanticId: string
  unit: string
  dataType: string
  /** A value, a range, or the values it takes (a list: the container types a station holds). */
  kind: 'value' | 'range' | 'values'
  value: string
  min: string
  max: string
  values?: string[]
}
/**
 * How one resource answers a step's requirements. ``availability``: whether every capability it
 * matches with is offered now, or one only after a reconfiguration (its skill is described, not
 * built); ``reconfigure`` names those skills.
 */
export type CapabilityMatch = {
  aasId: string
  status: 'match' | 'mismatch' | 'unknown'
  reasons: string[]
  capabilities: CapabilityDescription[]
  availability: Availability
  reconfigure: string[]
}
/**
 * What the skill service answers for a step's requirements: how each resource matches; the AASs a
 * skill can be planned on (where the capability is offered by no skill yet, then where the required
 * class or one it narrows is offered); and, for one requirement, the capability and the values a
 * plan or a check is asked with (a recipe parameter in place of a required value of its meaning).
 */
export type Matched = { matches: CapabilityMatch[], candidates: string[], requirement: Requirement | null }

/**
 * How the resources answer a step's required capabilities, asked of the skill service: ``parameters``
 * are the recipe's, ``resources`` the AASs asked of (without: every AAS that offers a capability).
 * Raises with the service's reasons, or, when it is not reached, with how to start it.
 */
export async function matchResources (requirements: CapabilityRequirement[], parameters: PlanParameter[] = [], resources?: string[],
  service = skillServiceUrl(), fetcher: typeof fetch = fetch): Promise<Matched> {
  if (requirements.length === 0) {
    return { matches: [], candidates: [], requirement: null }
  }
  return ask<Matched>('/match', {
    requirements: requirements.map(({ name, reference }) => ({ name, reference })),
    parameters: parameters.map(({ name, semanticIds, value, unit, dataType }) => ({ name, semanticIds: semanticIds ?? [], value, unit: unit ?? '', dataType })),
    ...(resources ? { aasIds: resources } : {}),
  }, 'match the resources', service, fetcher)
}

/** An element's unit: its Unit qualifier, else its IEC 61360 data specification's (as the matcher reads it). */
function unitOf (element: Record<string, any>): string {
  return (element.qualifiers ?? []).find((qualifier: Record<string, any>) => qualifier.type === 'Unit')?.value
    ?? (element.embeddedDataSpecifications ?? []).map((spec: Record<string, any>) => spec.dataSpecificationContent?.unit).find(Boolean) ?? ''
}

/**
 * What a capability container states of its properties, as the planner shows them (the skill service
 * matches them): the data element of each property container, a value, a range or a list.
 */
export function readCapabilityProperties (container: Record<string, any>): CapabilityProperty[] {
  return childrenOf(container).filter(set => semanticId(set) === capabilitySemantic('PropertySet')).flatMap(set => childrenOf(set).filter(item => semanticId(item) === capabilitySemantic('PropertyContainer'))).flatMap(item => childrenOf(item)
    .filter(property => ['Property', 'Range', 'SubmodelElementList'].includes(property.modelType))
    .map(property => {
      const kind = property.modelType === 'Range' ? 'range' as const : (property.modelType === 'SubmodelElementList' ? 'values' as const : 'value' as const)
      return {
        name: property.displayName?.find((name: { language: string }) => name.language === 'en')?.text ?? item.displayName?.find((name: { language: string }) => name.language === 'en')?.text ?? item.idShort ?? property.idShort,
        semanticId: canonicalMeaning(property.supplementalSemanticIds?.[0]?.keys?.[0]?.value ?? ''),
        unit: unitOf(property), dataType: String(property.valueType ?? property.valueTypeListElement ?? ''), kind,
        value: kind === 'value' ? String(property.value ?? '') : '', min: String(property.min ?? ''), max: String(property.max ?? ''),
        ...(kind === 'values' ? { values: childrenOf(property).map(entry => String(entry.value ?? '')) } : {}),
      }
    }))
}
