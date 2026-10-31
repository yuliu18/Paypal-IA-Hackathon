// The dashboard's widgets: Studio's own, plus "Flow through the guard" (./guard-flow.tsx), which
// shows up in Edit mode's widget menu under "Payment guard" so it can be added to any page.

import { createWidgets, type AgRegistry, type AgWidgetDefinition } from 'ag-studio-react';
import type { AgDefaultWidgetDefinition, AgWidgetsConfig } from 'ag-studio';
import { GuardFlowWidget } from './guard-flow';

export const GUARD_FLOW = 'guard-flow';

const guardFlow: AgWidgetDefinition<typeof GUARD_FLOW> = {
  id: GUARD_FLOW,
  label: 'Flow through the guard',
  comp: GuardFlowWidget,
  dataMapping: {
    // Who made the calls, and three measures in this order: passed, held, stopped.
    categoryKey: { type: 'field', supportedRoles: ['category'], required: true, intent: 'category' },
    valueKey: { type: 'fieldset', supportedRoles: ['numeric'], required: true, intent: 'value' },
  },
  form: (params) =>
    params.createDefaults({
      supportsCrossHighlight: false,
      dataMappingItems: [
        { key: 'categoryKey', label: 'Agent' },
        { key: 'valueKey', label: 'Passed, held, stopped' },
      ],
    }),
  defaultSize: { width: 24, height: 18 },
  minSize: { width: 12, height: 12 },
};

// Studio's own widgets plus ours, so the menu and the report may name 'guard-flow'.
interface DashboardRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | typeof guardFlow)[];
}

// For <AgStudio widgets>, which hands over Studio's default widgets and menu. Its prop is typed for
// the default registry, so the result is handed back as that.
export const dashboardWidgets = (defaults: AgWidgetsConfig): AgWidgetsConfig =>
  createWidgets<DashboardRegistry>({
    additionalTypes: [guardFlow],
    menu: [...defaults.menu, { label: 'Payment guard', widgetIds: [GUARD_FLOW] }],
  }) as unknown as AgWidgetsConfig;
