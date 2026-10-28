// AG Studio theme for the PayPal dashboard. Every value points at a design token from
// app/globals.css, the same variables the shell's Tailwind classes use, so Studio renders as
// part of the page rather than a component embedded in it: change a token there and the shell,
// widgets, grids and charts all follow.
//
// The dashboard is the dark "control room": its frame redefines those tokens with night-navy
// values (../control-room/control-room.module.css), so this theme is dark too, while the rest of
// the app stays light. Studio, its grids and its charts resolve the variables inside that frame.

import { studioTheme } from 'ag-studio';

const token = (name: string) => `var(--pp-${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

// Studio colours series by position: the first measure (or legend value) of a chart takes colour 1,
// the second colour 2 and so on, and a chart can't pick its own. So the palette starts with the
// guard's verdicts as a traffic light, which the guard charts plot as measures in this order:
// allowed green, held amber, blocked red. Cyan and violet accents follow for everything else.
const SERIES = [
  token('success'),
  token('warning'),
  token('danger'),
  token('chart-3'),
  token('chart-5'),
  token('blue'),
  token('chart-7'),
  token('chart-9'),
  token('chart-6'),
  token('chart-10'),
];

const palette = Object.fromEntries(
  SERIES.map((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]).flat(),
);

export const agStudioPayPalTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: token('font'),
  fontSize: 14,
  textColor: token('ink'),
  foregroundColor: token('ink'),
  subtleTextColor: token('muted'),
  backgroundColor: token('surface'),
  borderColor: token('border'),
  // Sky, not PayPal blue: selected buttons and focus rings need to stand out on the dark surface.
  accentColor: token('sky'),
  iconColor: token('navy'),
  rowHoverColor: token('highlight'),
  // Native scrollbars, inputs and pickers drawn dark.
  browserColorScheme: 'dark',
  // Menus, pickers and tooltips (the filters panel, Edit mode, chart hovers) on the dark surface.
  menuBackgroundColor: token('surface'),
  menuTextColor: token('ink'),
  menuBorder: line('border'),
  menuSeparatorColor: token('border'),
  tooltipBackgroundColor: token('highlight'),
  tooltipTextColor: token('ink'),
  tooltipBorder: line('border'),

  // No frame: the canvas is the page's own background, the control room's night gradient
  // showing through. Each widget is inset 12px inside its grid cell, so 20px of padding puts
  // widget edges on the header's 32px gutter.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: 'transparent',
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: 'transparent',
  studioCanvasGridLineColor: token('border'),
  studioCanvasPadding: 20,
  // Taller rows than the default 16px make room for roomy cards.
  studioCanvasRowHeight: 20,
  studioCanvasFontFamily: token('font'),

  // Widgets are the control room's panels: dark surface, 1px border, 14px radius, generous padding.
  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 14,
  studioWidgetPadding: 18,
  studioWidgetTitleFontFamily: token('font'),
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('navy'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token('muted'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token('muted'),
  studioWidgetResizeBorderColor: token('blue'),
  studioWidgetToolbarBackgroundColor: token('surface'),
  studioWidgetToolbarBorder: line('border'),
  studioWidgetToolbarButtonColor: token('muted'),
  studioWidgetToolbarButtonHoverBackgroundColor: token('highlight'),
  studioWidgetLoadingOverlayBackgroundColor: token('surface'),
  studioWidgetNoDataOverlayBackgroundColor: token('surface'),

  // Edit-mode panels: the same dark surface as the widgets.
  studioPanelContainerBackgroundColor: token('surface'),
  studioPanelContainerBorder: line('border'),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token('border'),
  studioPanelDividerActiveColor: token('blue'),
  studioPanelSectionBorderColor: token('border'),
  studioPanelHeaderFontFamily: token('font'),
  studioPanelHeaderFontWeight: 600,
  studioPanelGroupBackgroundColor: token('canvas'),
  studioPanelGroupTitleBarTextColor: token('ink'),
  studioFormLabelColor: token('muted'),
  studioAiPanelInputMessageBackgroundColor: token('canvas'),
  studioAiPanelButtonHoverBackgroundColor: token('highlight'),
  studioAiPanelRichTextAccentBackgroundColor: token('highlight'),
  studioFieldSelectSelectedBackgroundColor: token('highlight'),
  studioDragAndDropImageBackgroundColor: token('surface'),
  studioDragAndDropImageTextColor: token('ink'),
  studioPanelChevronButtonHoverBackgroundColor: token('highlight'),
  studioPanelChevronButtonHoverColor: token('blue'),
  // Selected toggles: highlight fill, sky text and edge.
  studioToggleButtonActiveBackgroundColor: token('highlight'),
  studioToggleButtonActiveBorderColor: token('sky'),
  studioToggleButtonActiveColor: token('sky'),

  // Grid widgets: muted semibold headers, faint dividers, roomy rows.
  gridFontFamily: token('font'),
  gridFontSize: 14,
  gridCellTextColor: token('ink'),
  gridHeaderBackgroundColor: token('surface'),
  gridHeaderTextColor: token('muted'),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line('gridline'),
  gridHeaderRowBorder: line('border'),
  gridPinnedRowBorder: line('border'),
  gridRowHoverColor: token('highlight'),
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: token('font'),
  chartTextColor: token('ink'),
  chartSubtleTextColor: token('muted'),
  chartAxisLineColor: token('border'),
  chartGridLineColor: token('gridline'),
  chartTooltipBackgroundColor: token('highlight'),
  chartTooltipTextColor: token('ink'),
  chartTooltipSubtleTextColor: token('muted'),
  chartTooltipBorder: line('border'),
  chartCrosshairLabelBackgroundColor: token('highlight'),
  chartCrosshairLabelTextColor: token('ink'),
  ...palette,
});
