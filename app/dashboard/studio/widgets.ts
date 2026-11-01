// The dashboard's widgets: Studio's own, plus "Flow through the guard" (./guard-flow.tsx), which
// shows up in Edit mode's widget menu under "Payment guard" so it can be added to any page.

import { createWidgets, type AgRegistry, type AgWidgetDefinition } from 'ag-studio-react';
import type { AgDefaultWidgetDefinition, AgWidgetsConfig } from 'ag-studio';
import type { Translate } from '../translate';
import { GuardFlowWidget } from './guard-flow';

export const GUARD_FLOW = 'guard-flow';

// Its labels in the widget menu and setup are in the app's language (`widgets.*` in the dashboard's
// messages).
const guardFlowWidget = (t: Translate): AgWidgetDefinition<typeof GUARD_FLOW> => ({
  id: GUARD_FLOW,
  label: t('widgets.guardFlow'),
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
        { key: 'categoryKey', label: t('widgets.agentMapping') },
        { key: 'valueKey', label: t('widgets.verdictsMapping') },
      ],
    }),
  defaultSize: { width: 24, height: 18 },
  minSize: { width: 12, height: 12 },
});

// Studio's own widgets plus ours, so the menu and the report may name 'guard-flow'.
interface DashboardRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | ReturnType<typeof guardFlowWidget>)[];
}

// For <AgStudio widgets>, which hands over Studio's default widgets and menu. Its prop is typed for
// the default registry, so the result is handed back as that.
export const dashboardWidgets =
  (t: Translate) =>
  (defaults: AgWidgetsConfig): AgWidgetsConfig =>
    createWidgets<DashboardRegistry>({
      additionalTypes: [guardFlowWidget(t)],
      menu: [...defaults.menu, { label: t('widgets.menuGroup'), widgetIds: [GUARD_FLOW] }],
    }) as unknown as AgWidgetsConfig;
