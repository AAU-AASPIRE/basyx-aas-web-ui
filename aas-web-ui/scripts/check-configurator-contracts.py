"""Validate check-configurator-contracts.mjs output with the server's aas-model environment."""
import json
import os
from aas_model._serde import parse_submodel_dict
from aas_model.product_template.asset import BillOfMaterial, Product
from aas_model.submodel_templates.product.process_parameters import ProcessParameters
from aas_model.submodel_templates.product.production_sequence import ProductionSequence
from aas_pydantic.submodel_templates.capability_description import CapabilityDescription
from aas_pydantic.submodel_templates.nameplate import Nameplate

with open(os.path.join(os.environ['TEMP'], 'configurator-product-contracts.json'), encoding='utf-8') as stream:
    models = json.load(stream)
types = {t.__name__: t for t in [ProcessParameters, ProductionSequence, CapabilityDescription, Nameplate]}
types['HierarchicalStructures'] = BillOfMaterial
fields = {'Nameplate': 'nameplate', 'HierarchicalStructures': 'hierarchical_structures', 'ProcessParameters': 'process_parameters', 'CapabilityDescription': 'capability_description', 'ProductionSequence': 'production_sequence'}
for model in models:
    values = {}
    for sm in model['submodels']:
        parsed = parse_submodel_dict(sm, types[sm['idShort']])
        values[fields[sm['idShort']]] = parsed
        if sm['idShort'] == 'HierarchicalStructures':
            added = [p for p in parsed.EntryNode.Node.values() if p.id_short.startswith('Stopper_')]
            assert len(added) == 1
            assert len(added[0].Node) == 1
    Product(id=model['shell']['id'], id_short=model['shell']['idShort'], **values)
    print('Backend Product validated all five submodels, including added and nested parts:', model['shell']['id'])
