# Configurator module

Open **Configurator** from the module selector, or `/modules/configurator`. This is a native Vue/Vuetify module discovered by the existing module router; it needs no React runtime or additional drag library.

## Included in this first version

- Product selection, component popup editing, nested component addition, sibling drag ordering with before/after insertion lines in both the list and figure, schematic SVG assembly views and semantic product/process parameter editing.
- New product drafts for vial, prefilled syringe and cartridge, created from the currently loaded server reference family when available, with an offline fallback to the reference AAS environments in `cell/examples/products` in the parent `iec61499-mgmt-py` repository. `templates/*.json` were exported with `example_line.products()`, without publishing. New shells, assets and submodels receive new identifiers; internal references are remapped and existing sequence schemas are preserved.
- A production-line editor with a collapsible capability catalogue, native drag-and-drop, click-to-place alternative, collision feedback and resource inspection links. The table grid comes from the planar table's AAS (below). Modules are square schematic footprints, one flyway wide, not measured equipment outlines.
- Shuttle routing for the planar controller's line mode: lanes, turn spots and the idle area, kept in the line's AAS (below).
- Composition references remain in Hierarchical Structures. Placement changes X/Y/Yaw and RelativeTo in each resource's ModuleBase. Saving targets that coordinate element rather than overwriting the Variables submodel containing live data. Unknown/unresolved members are retained.
- Process AAS assignment browsing and a link to the existing Process Sequence editor. Product recipe authoring remains there; this module does not migrate sequence documents or rewrite Process bindings.
- **Write a Process AAS** (Process assignments tab): the skill service (iec61499-mgmt-py's `modreg serve`, `POST /process/<product>`) builds the product's Process AAS on the selected line from the bindings the Process Sequence editor saved in the recipe, with the plan check's result as its Validation, and publishes it; the catalog is read again. The service's address is the one set in the Process Sequence editor.

## The planar table and shuttle routing

**The table is read, never written.** The board is drawn from the planar table's AAS as `modreg` describes it from the planar controller, which reads it from the PMC: the frame from the table's `Parameters` (`Columns`, `Rows`, `FlywaySize`, as the PMC is set up) and the flyways that are there from its `Variables/Measurements/Coordinates` (`Flyway_<c>_<r>`). A position of the frame without a flyway is shown as such (on the Modules board, a lighter square). A table AAS from before the frame was added is drawn as before, its frame ending at the outermost flyways.

**Shuttle routing** (Production lines, the second view of the board) lays out the planar controller's line mode for the selected line: lanes the shuttles travel on (one-way or two-way), turn spots (where they turn: a flyway's centre, or where four flyways meet; a shuttle turns on the one nearest to it and waits there while another turns) and the idle area (the loading queue, the loading position first). Click slot centres to draw a lane (a corner is added between clicks not in line; click its first slot again to close a loop), a flyway's centre or a corner where four flyways meet to toggle a turn spot, slots in queue order for the idle area. The routing is checked as the controller checks it at its Reset (slot centres on flyways, along rows and columns, no missing flyway crossed, every lane slot leading to every other, a lane slot under every turn spot) and the problems are listed, with a warning when the idle area has fewer slots than the table has shuttles.

The routing is the line's, not the planar table's (`modreg` writes the table's AAS again from the controller): it is saved in the line's `Parameters` submodel (ARSO Parameters, created with the first routing) as the collection `PlanarRouting`:

```
PlanarRouting   SubmodelElementCollection
  Lanes         SubmodelElementList, a collection per lane: Name (xs:string), OneWay (xs:boolean), Points
  TurnSpots     SubmodelElementList of points
  IdleArea      SubmodelElementList of points
a point         SubmodelElementCollection: X, Y (xs:double, mm in the table's coordinates)
```

The semantic IDs are `https://smartproductionlab.aau.dk/semantics/PlanarRouting`, `…/PlanarRouting/Lane` and `…/PlanarRouting/Point`. The controller reads the collection's value (`$value`, e.g. `{"Lanes": [{"Name": "loop", "OneWay": "true", "Points": [{"X": "180", "Y": "180"}, …]}], …}`) at startup with `MODE=line`, and again at every Reset, and `LINE_LAYOUT` set to its URL, which the editor shows (`…/submodels/<Parameters>/submodel-elements/PlanarRouting/$value`). A routing saved in the first form (the controller's JSON in a `Value` property) is read, and saved again as the collection. **Free routing** removes it (the controller's free mode). Saving does not restart the controller: it reads the routing again at every Reset of the table, so a saved change is taken by pressing Reset (a routing it cannot take fails the Reset with ErrorID 31, the reason in `PlanarTable/Equipment/LineLayoutProblem`). Unit coverage is in `tests/pages/configuratorRouting.test.ts`.

## Repository behavior

Uses configured infrastructure, authenticated request handling, and `allow-editing` / `allow-uploading` feature controls. No hardcoded repository URL in application code. All changes are drafts until **Review and save**. New products use POST with identifier preflight. Existing models are reread and compared to baselines before writing. Only changed documents are saved, followed by readback. This is optimistic conflict detection, not an atomic transaction: a repository write failure reports partial progress and requires reload. Leaving a dirty module prompts before discarding drafts.

Placement changes modify shared resource AASs; they affect every line referencing that resource. They do not command the controller or deploy skills. Revalidate existing Process AASs after changing a product or line. The separate process validator remains authoritative.

## Current boundaries

- Line configuration opens existing System AASs and creates new ones referencing an existing planar table. OPC UA deployment is not included; Process AASs are written by the skill service (above).
- Supports the reference planar table's regular square flyway lattice, with coordinates measured from its corner. Module placement is currently a top view for ModuleBase directly relative to that table. Resources with other coordinate chains remain in the composition but are not projected onto the board. Table and shuttle assets are not offered as perimeter stations.
- Product visuals are schematic. Reference models contain process-related diameters, not full component geometry. No new geometry submodel is invented. Added components do not automatically gain recipe steps or capability requirements.
- Product quantity edits do not imply a new recipe. Recipe quantity references and units must remain consistent; the parameter editor synchronizes referenced material amounts when editing a shared product fact.
- Creating products and lines currently requires a separate submodel repository endpoint, rather than the AAS superpath transport.

## Verification

Run with the repository's supported Node version and pnpm:

```sh
pnpm exec eslint src/pages/modules/Configurator tests/pages/configurator*.test.ts scripts/check-configurator.mjs --max-warnings=0
pnpm exec vitest run tests/pages/configurator.test.ts tests/pages/configuratorRepository.test.ts
pnpm run type-check
```

`node scripts/check-configurator.mjs` exercises the current local UI at port 5180 and reads reference models from port 8081. Override `CONFIGURATOR_UI` and `CONFIGURATOR_REPOSITORY` if needed. All browser repository writes are intercepted in memory; nothing is published to the live repository. Enable editing/uploading in the test UI. The browser check requires Chrome and writes its screenshot to the OS temporary directory.

`node scripts/check-configurator-contracts.mjs` creates all three product families from the live server references and adds nested components, exporting only to the OS temporary directory. Then run `scripts/check-configurator-contracts.py` with the parent repository's Python environment to validate all five submodels and the complete Product with the actual `aas-model` classes. This check does not write to the server.

Drag operations update local drafts immediately, with edited model IDs tracked explicitly; full AAS document comparisons run at save time. Perimeter zones show valid/occupied hover feedback. Colors follow the active BaSyx Vuetify theme, with a dark physical magnet surface.

## Orders

The Orders tab creates production requests using the original configurator's application-owned `production-order/1.0` contract. Select a saved product with a complete recipe, a saved line and a positive integer quantity. Review the request, then **Place order** to POST the OrderInformation submodel and ProductionOrder instance AAS, followed by readback. Existing orders appear in a searchable table with their stored status and an AAS inspection link. Canceling review returns to the form without publishing.

OrderInformation contains Schema, OrderId, Name, Quantity (`xs:positiveInteger`), CreatedAt (`xs:dateTime`), Status (`Created`) and model references named Product, ProductionSystem, ProductionSequence and SystemComposition. The referenced product and line are reread before submission; changes require refreshing and reviewing again. Editing and uploading permissions apply. Save or discard configuration drafts before ordering.

Orders reference mutable saved models, not immutable snapshots. This is the existing application's request contract, not an IDTA order template or OPC UA execution API. A production service must support this contract to consume requests; the UI neither starts equipment nor invents execution status.

The browser check now covers order validation, publishing/readback, repository refresh and narrow-screen layout with all writes intercepted. Unit coverage is in `tests/pages/configuratorOrders.test.ts` and the repository tests.

Adding product components uses a three-step wizard: name and representation, quantity and unit, then parent placement with a summary. Back retains the entered values; Cancel discards the wizard without changing the AAS. Existing component details remain directly editable, including linked quantity parameters. Components enter the local product draft only on **Add to assembly**, and are published through **Review and save**.

Components can be deleted from the list or their details dialog. Confirmation names the component and includes its nested subtree. Deletion removes corresponding ProcessBoM material uses and hierarchy relationships; other dependent references within the product block the operation without modifying the draft. Recipe steps and external catalog assets are preserved. Review Process Sequence and any external process assignments after changing the bill of material. Deletions persist only through Review and save.

The configurator reads and writes the selected AAS repository directly, including identifier preflight and readback. It does not require registry descriptors for newly created shells. Expected repository 404 responses during identifier preflight mean the new IDs are unused; they are suppressed in the UI, although browser developer tools may still show those HTTP responses.

The component list and exploded view display the stored assembly order in reverse, so the base is at the bottom (vial, liquid, stopper, cap from bottom to top). Nested parts appear above their parent. Viewing does not change the AAS or production recipe. Drag before/after positions are translated back into the stored order so edits match their visual placement.
